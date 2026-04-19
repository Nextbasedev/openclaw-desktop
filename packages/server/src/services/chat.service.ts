import { EventEmitter } from "node:events"
import {
  createChatSession,
  deleteChatSession,
  sendChatMessage,
  getChatHistory,
  openChatEventStream,
  type ChatStreamEvent,
} from "middleware"
import { prependSkillContext, clearSessionTracking } from "./skill-runtime.service.js"
import { getDb } from "../db/connection.js"
import { getAppSetting } from "../db/helpers.js"

export const chatEvents = new EventEmitter()
chatEvents.setMaxListeners(100)

const localToGatewayKey = new Map<string, string>()

function persistGatewayKey(localKey: string, gwKey: string) {
  localToGatewayKey.set(localKey, gwKey)
  try {
    getDb()
      .prepare(
        "UPDATE session_mappings SET session_id = ? WHERE session_key = ?",
      )
      .run(gwKey, localKey)
  } catch {}
}

function loadGatewayKey(localKey: string): string | undefined {
  const cached = localToGatewayKey.get(localKey)
  if (cached) return cached
  try {
    const row = getDb()
      .prepare(
        "SELECT session_id FROM session_mappings WHERE session_key = ?",
      )
      .get(localKey) as { session_id: string | null } | undefined
    if (row?.session_id) {
      localToGatewayKey.set(localKey, row.session_id)
      return row.session_id
    }
  } catch {}
  return undefined
}

function wrapGatewayError(error: unknown): never {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes("enoent") ||
      msg.includes("token is missing") ||
      msg.includes("websocket") ||
      msg.includes("timeout") ||
      msg.includes("connect")
    ) {
      throw new Error(
        "Gateway not connected. Start the OpenClaw Gateway first.",
      )
    }
  }
  throw error
}

const activeStreams = new Map<
  string,
  { close: () => void }
>()

const MAX_ATTACHMENTS = 10
const MAX_SINGLE_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024

type Attachment = {
  name: string
  mimeType: string
  content?: string
  encoding?: "utf-8" | "base64"
  size?: number
}

function validateAttachments(
  attachments: unknown[] | undefined,
): Attachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined

  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(
      `Too many attachments: ${attachments.length} (max ${MAX_ATTACHMENTS})`,
    )
  }

  let totalBytes = 0
  const validated: Attachment[] = []

  for (const raw of attachments) {
    const att = raw as Attachment
    const size = att.size ?? (att.content ? Buffer.byteLength(att.content) : 0)

    if (size > MAX_SINGLE_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment "${att.name}" exceeds 50 MB limit`,
      )
    }
    totalBytes += size
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Total attachment size exceeds 100 MB limit")
    }
    validated.push({
      name: att.name,
      mimeType: att.mimeType,
      content: att.content,
      encoding: att.encoding,
      size: att.size,
    })
  }

  return validated
}

export async function chatCreateSession(input: {
  label?: string
  model?: string
  agentId?: string
  verboseLevel?: string
}) {
  try {
    return await createChatSession({
      agentId: input.agentId,
      label: input.label,
      model: input.model,
      verboseLevel: input.verboseLevel,
    })
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function chatDeleteSession(input: {
  sessionKey: string
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  const existing = activeStreams.get(gwKey)
  if (existing) {
    existing.close()
    activeStreams.delete(gwKey)
  }
  clearSessionTracking(input.sessionKey)
  try {
    const result = await deleteChatSession(gwKey)
    localToGatewayKey.delete(input.sessionKey)
    return result
  } catch (error) {
    wrapGatewayError(error)
  }
}

function resolveGatewayKey(localKey: string): string {
  return loadGatewayKey(localKey) ?? localKey
}

async function ensureGatewaySession(localKey: string): Promise<string> {
  const existing = loadGatewayKey(localKey)
  if (existing) return existing

  const model = getAppSetting(getDb(), "onboarding.model.ref") ?? undefined
  try {
    const created = await createChatSession({
      agentId: "main",
      label: localKey,
      model,
    })
    persistGatewayKey(localKey, created.sessionKey)
    return created.sessionKey
  } catch {
    persistGatewayKey(localKey, localKey)
    return localKey
  }
}

export async function chatSend(input: {
  sessionKey: string
  text: string
  timeoutMs?: number
  attachments?: unknown[]
}) {
  const validatedAttachments = validateAttachments(input.attachments)
  const gwKey = await ensureGatewaySession(input.sessionKey)

  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: input.text,
      timeoutMs: input.timeoutMs,
      attachments: validatedAttachments,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(gwKey, input.sessionKey)

  return result
}

export async function chatStop(input: { sessionKey: string }) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  const stream = activeStreams.get(gwKey)
  if (stream) {
    stream.close()
    activeStreams.delete(gwKey)
  }
  chatEvents.emit(`chat:event:${input.sessionKey}`, {
    type: "chat.status",
    sessionKey: input.sessionKey,
    state: "done",
    label: "stopped",
  } satisfies ChatStreamEvent)
  return { stopped: true, sessionKey: input.sessionKey }
}

export async function chatHistory(input: { sessionKey: string }) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  try {
    return await getChatHistory(gwKey)
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function chatEditAndResend(input: {
  sessionKey: string
  messageId: string
  text: string
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: input.text,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(gwKey, input.sessionKey)

  return {
    ...result,
    editedMessageId: input.messageId,
    action: "edit_and_resend",
  }
}

export async function chatRegenerate(input: {
  sessionKey: string
  messageId: string
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: "",
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(gwKey, input.sessionKey)

  return {
    ...result,
    regeneratedMessageId: input.messageId,
    action: "regenerate",
  }
}

function startEventStream(gwKey: string, localKey: string) {
  const existing = activeStreams.get(gwKey)
  if (existing) {
    existing.close()
    activeStreams.delete(gwKey)
  }

  openChatEventStream({
    sessionKey: gwKey,
    onEvent(event: ChatStreamEvent) {
      chatEvents.emit(`chat:event:${localKey}`, event)

      if (
        event.type === "chat.status" &&
        (event.state === "done" || event.state === "error")
      ) {
        const stream = activeStreams.get(gwKey)
        if (stream) {
          stream.close()
          activeStreams.delete(gwKey)
        }
      }
    },
  })
    .then((stream) => {
      activeStreams.set(gwKey, stream)
    })
    .catch((error) => {
      chatEvents.emit(`chat:event:${localKey}`, {
        type: "chat.error",
        sessionKey: localKey,
        message:
          error instanceof Error
            ? error.message
            : "Failed to open event stream",
      } satisfies ChatStreamEvent)
    })
}
