import { EventEmitter } from "node:events"
import {
  createChatSession,
  deleteChatSession,
  sendChatMessage,
  getChatHistory,
  openChatEventStream,
  type ChatStreamEvent,
} from "middleware"

export const chatEvents = new EventEmitter()
chatEvents.setMaxListeners(100)

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
  const existing = activeStreams.get(input.sessionKey)
  if (existing) {
    existing.close()
    activeStreams.delete(input.sessionKey)
  }
  try {
    return await deleteChatSession(input.sessionKey)
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function chatSend(input: {
  sessionKey: string
  text: string
  timeoutMs?: number
  attachments?: unknown[]
}) {
  const validatedAttachments = validateAttachments(input.attachments)

  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: input.sessionKey,
      text: input.text,
      timeoutMs: input.timeoutMs,
      attachments: validatedAttachments,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(input.sessionKey)

  return result
}

export async function chatStop(input: { sessionKey: string }) {
  const stream = activeStreams.get(input.sessionKey)
  if (stream) {
    stream.close()
    activeStreams.delete(input.sessionKey)
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
  try {
    return await getChatHistory(input.sessionKey)
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function chatEditAndResend(input: {
  sessionKey: string
  messageId: string
  text: string
}) {
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: input.sessionKey,
      text: input.text,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(input.sessionKey)

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
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: input.sessionKey,
      text: "",
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  startEventStream(input.sessionKey)

  return {
    ...result,
    regeneratedMessageId: input.messageId,
    action: "regenerate",
  }
}

function startEventStream(sessionKey: string) {
  const existing = activeStreams.get(sessionKey)
  if (existing) {
    existing.close()
    activeStreams.delete(sessionKey)
  }

  openChatEventStream({
    sessionKey,
    onEvent(event: ChatStreamEvent) {
      chatEvents.emit(`chat:event:${sessionKey}`, event)

      if (
        event.type === "chat.status" &&
        (event.state === "done" || event.state === "error")
      ) {
        const stream = activeStreams.get(sessionKey)
        if (stream) {
          stream.close()
          activeStreams.delete(sessionKey)
        }
      }
    },
  })
    .then((stream) => {
      activeStreams.set(sessionKey, stream)
    })
    .catch((error) => {
      chatEvents.emit(`chat:event:${sessionKey}`, {
        type: "chat.error",
        sessionKey,
        message:
          error instanceof Error
            ? error.message
            : "Failed to open event stream",
      } satisfies ChatStreamEvent)
    })
}
