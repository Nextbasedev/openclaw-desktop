import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import {
  createChatSession,
  deleteChatSession,
  sendChatMessage,
  getChatHistory,

  openChatEventStream,
  type ChatStreamEvent,
  type ChatStatusEvent,
  type ChatToolEvent,
} from "middleware"
import { prependSkillContext, clearSessionTracking } from "./skill-runtime.service.js"
import { getDb } from "../db/connection.js"
import { getAppSetting, generateId, nowIso } from "../db/helpers.js"

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

const lastSessionStatus = new Map<string, ChatStatusEvent>()

export function getLastSessionStatus(
  sessionKey: string,
): ChatStatusEvent | undefined {
  return lastSessionStatus.get(sessionKey)
}

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
  replyTo?: { messageId: string; snippet: string }
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
      replyTo: input.replyTo,
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
  const stoppedStatus: ChatStatusEvent = {
    type: "chat.status",
    sessionKey: input.sessionKey,
    state: "done",
    label: "stopped",
  }
  lastSessionStatus.set(input.sessionKey, stoppedStatus)
  chatEvents.emit(`chat:event:${input.sessionKey}`, stoppedStatus)
  return { stopped: true, sessionKey: input.sessionKey }
}

export async function chatHistory(input: { sessionKey: string }) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  let history: Awaited<ReturnType<typeof getChatHistory>>
  try {
    history = await getChatHistory(gwKey)
  } catch (error) {
    wrapGatewayError(error)
  }

  const db = getDb()
  const edits = db
    .prepare(
      "SELECT source_message_id, created_at FROM branches WHERE source_session_key = ? AND branch_reason = 'edit' ORDER BY created_at ASC",
    )
    .all(input.sessionKey) as Array<{
    source_message_id: string
    created_at: string
  }>

  if (edits.length === 0) return history

  type HistMsg = {
    id?: string
    role?: string
    text?: string
    createdAt?: string
    [key: string]: unknown
  }
  let msgs = (history.messages ?? []) as HistMsg[]

  for (const edit of edits) {
    const sourceIdx = msgs.findIndex(
      (m) => m.id === edit.source_message_id,
    )
    if (sourceIdx === -1) continue

    let editIdx = -1
    for (let i = sourceIdx + 1; i < msgs.length; i++) {
      const m = msgs[i]
      if (
        m.role === "user" &&
        m.createdAt &&
        m.createdAt >= edit.created_at
      ) {
        editIdx = i
        break
      }
    }
    if (editIdx === -1) continue

    msgs = [...msgs.slice(0, sourceIdx), ...msgs.slice(editIdx)]
  }

  return { ...history, messages: msgs }
}

export async function chatEditAndResend(input: {
  sessionKey: string
  messageId: string
  text: string
}) {
  const gwKey = await ensureGatewaySession(input.sessionKey)

  const db = getDb()
  const editId = `edit_${crypto.randomUUID().replace(/-/g, "")}`
  const now = new Date().toISOString()
  try {
    db.prepare(
      "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_reason, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(editId, input.sessionKey, input.messageId, editId, "edit", now, null)
  } catch {}

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
  text: string
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: input.text,
      regenerate: true,
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

  let doneCount = 0

  openChatEventStream({
    sessionKey: gwKey,
    onEvent(event: ChatStreamEvent) {
      console.log(`[stream:${localKey.slice(-8)}] ${event.type}`, event.type === "chat.status" ? (event as ChatStatusEvent).state : event.type === "chat.tool" ? `${(event as ChatToolEvent).name}:${(event as ChatToolEvent).phase}` : "")
      chatEvents.emit(`chat:event:${localKey}`, event)

      if (event.type === "chat.status") {
        lastSessionStatus.set(localKey, event as ChatStatusEvent)
        if (event.state === "done" || event.state === "error") {
          doneCount++
          console.log(`[stream:${localKey.slice(-8)}] done #${doneCount} — keeping stream open for sub-agents`)
        }
      }
    },
  })
    .then((stream) => {
      activeStreams.set(gwKey, stream)
      console.log(`[stream:${localKey.slice(-8)}] stream opened`)
    })
    .catch((error) => {
      console.error(`[stream:${localKey.slice(-8)}] stream error:`, error)
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

export function chatStartSubagentStream(input: { sessionKey: string }) {
  const gwKey = input.sessionKey
  if (activeStreams.has(gwKey)) return { started: false, reason: "already_active" }
  startEventStream(gwKey, gwKey)
  return { started: true, sessionKey: gwKey }
}

export async function chatFork(input: {
  sessionKey: string
  messageId: string
  gatewayIndex: number
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)

  let history: Awaited<ReturnType<typeof getChatHistory>>
  try {
    history = await getChatHistory(gwKey)
  } catch (error) {
    throw wrapGatewayError(error)
  }

  const msgs = history.messages ?? []
  const msgIdx = input.gatewayIndex
  if (msgIdx < 0 || msgIdx >= msgs.length) {
    throw new Error(`Message index ${msgIdx} out of range (${msgs.length} messages)`)
  }
  const sliced = msgs.slice(0, msgIdx + 1)

  const forkLabel = `Fork ${crypto.randomUUID().slice(0, 8)}`
  const model =
    getAppSetting(getDb(), "onboarding.model.ref") ?? undefined
  let newSession: Awaited<ReturnType<typeof createChatSession>>
  try {
    newSession = await createChatSession({
      agentId: "main",
      label: forkLabel,
      model,
    })
  } catch (error) {
    throw wrapGatewayError(error)
  }

  const db = getDb()
  const now = nowIso()
  const chatId = generateId("chat")
  const branchId = generateId("branch")
  const newSessionKey = newSession.sessionKey

  db.transaction(() => {
    db.prepare(
      "INSERT INTO chats (id, name, session_key, agent_id, archived, pinned, last_active_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)",
    ).run(chatId, forkLabel, newSessionKey, "main", now, now, now)

    db.prepare(
      "INSERT OR REPLACE INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, NULL, NULL, 'main', ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run(newSessionKey, forkLabel, now, now)

    db.prepare(
      "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
    ).run(
      branchId,
      input.sessionKey,
      input.messageId,
      newSessionKey,
      "fork",
      now,
      JSON.stringify({
        sourceGatewaySessionId: gwKey,
        newGatewaySessionId: newSessionKey,
        messageIndex: msgIdx,
      }),
    )
  })()

  persistGatewayKey(newSessionKey, newSession.sessionKey)

  return {
    chatId,
    sessionKey: newSessionKey,
    name: forkLabel,
    messages: sliced,
  }
}

export async function chatForkHistory(input: {
  sessionKey: string
}) {
  const db = getDb()
  const branch = db
    .prepare(
      "SELECT source_session_key, source_message_id, metadata_json FROM branches WHERE branch_session_key = ? AND branch_reason = 'fork'",
    )
    .get(input.sessionKey) as
    | { source_session_key: string; source_message_id: string; metadata_json: string | null }
    | undefined

  if (!branch) return { messages: [], isFork: false }

  let messageIndex = -1
  if (branch.metadata_json) {
    try {
      const meta = JSON.parse(branch.metadata_json)
      if (typeof meta.messageIndex === "number") messageIndex = meta.messageIndex
    } catch {}
  }

  const sourceGwKey = resolveGatewayKey(branch.source_session_key)
  let history: Awaited<ReturnType<typeof getChatHistory>>
  try {
    history = await getChatHistory(sourceGwKey)
  } catch {
    return { messages: [], isFork: true }
  }

  const msgs = history.messages ?? []
  if (messageIndex < 0 || messageIndex >= msgs.length) {
    return { messages: [], isFork: true }
  }

  return {
    messages: msgs.slice(0, messageIndex + 1),
    isFork: true,
    sourceSessionKey: branch.source_session_key,
    sourceMessageId: branch.source_message_id,
  }
}
