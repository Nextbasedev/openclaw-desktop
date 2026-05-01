import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
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
  type ChatAgentEvent,
  type ChatMessageEvent,
} from "middleware"
import {
  prependSkillContext,
  clearSessionTracking,
  resolveSkillMention,
  buildMentionContext,
} from "./skill-runtime.service.js"
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
  try {
    const row = getDb()
      .prepare(
        "SELECT session_id, source FROM session_mappings WHERE session_key = ?",
      )
      .get(localKey) as
      | { session_id: string | null; source: string | null }
      | undefined
    if (row?.source === "gateway" && !row.session_id) {
      localToGatewayKey.delete(localKey)
      return undefined
    }
    const cached = localToGatewayKey.get(localKey)
    if (cached) return cached
    if (row?.session_id) {
      localToGatewayKey.set(localKey, row.session_id)
      return row.session_id
    }
  } catch {}
  const cached = localToGatewayKey.get(localKey)
  if (cached) return cached
  return undefined
}

function wrapGatewayError(error: unknown): never {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("enoent")) {
      throw new Error(
        "Gateway config or identity file not found. Run onboarding first.",
      )
    }
    if (msg.includes("token is missing")) {
      throw new Error(
        "Gateway authentication token is missing. Re-run onboarding to configure.",
      )
    }
    if (msg.includes("pairing") || msg.includes("not paired") || msg.includes("not registered")) {
      throw new Error(
        "Device not paired with gateway. Re-run onboarding to pair this device.",
      )
    }
    if (msg.includes("econnrefused")) {
      throw new Error(
        "Gateway is not running. Start the OpenClaw Gateway and try again.",
      )
    }
    if (msg.includes("timeout") || msg.includes("etimedout")) {
      throw new Error(
        "Gateway connection timed out. Check that the gateway is reachable.",
      )
    }
    if (
      msg.includes("websocket") ||
      msg.includes("connect")
    ) {
      throw new Error(
        `Gateway connection failed: ${error.message}`,
      )
    }
  }
  throw error
}

const activeStreams = new Map<
  string,
  { close: () => void }
>()
const openingStreams = new Map<string, Promise<void>>()

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

export type HistMsg = {
  id?: string
  role?: string
  text?: string
  createdAt?: string
  model?: string | null
  content?: unknown
  [key: string]: unknown
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

function isGatewayBackedSession(localKey: string): boolean {
  if (localKey.startsWith("agent:")) return true
  try {
    const row = getDb()
      .prepare("SELECT source FROM session_mappings WHERE session_key = ?")
      .get(localKey) as { source: string | null } | undefined
    return row?.source === "gateway"
  } catch {
    return false
  }
}

function sessionAliasKeys(primaryKey: string, gatewayKey: string): string[] {
  const keys = new Set([primaryKey, gatewayKey])
  try {
    const rows = getDb()
      .prepare(
        "SELECT session_key, session_id FROM session_mappings WHERE session_key IN (?, ?) OR session_id IN (?, ?)",
      )
      .all(primaryKey, gatewayKey, primaryKey, gatewayKey) as Array<{
      session_key: string | null
      session_id: string | null
    }>
    for (const row of rows) {
      if (row.session_key) keys.add(row.session_key)
      if (row.session_id) keys.add(row.session_id)
    }
  } catch {}
  return [...keys]
}

function readPrimaryModel(): string | undefined {
  try {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json")
    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as Record<string, unknown>
    const agents = config.agents as Record<string, unknown> | undefined
    const defaults = agents?.defaults as Record<string, unknown> | undefined
    const model = defaults?.model as Record<string, unknown> | undefined
    const primary = model?.primary
    return typeof primary === "string" && primary.length > 0 ? primary : undefined
  } catch {
    return undefined
  }
}

async function ensureGatewaySession(localKey: string): Promise<string> {
  const existing = loadGatewayKey(localKey)
  if (existing) return existing

  if (isGatewayBackedSession(localKey)) return localKey

  const model = readPrimaryModel() ?? getAppSetting(getDb(), "onboarding.model.ref") ?? undefined
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

  let messageText = input.text
  const { skill, cleanedText } = resolveSkillMention(messageText)
  if (skill) {
    messageText = buildMentionContext(skill, cleanedText)
  }

  const isCommand = input.text.startsWith("/")
  const commandTimestamp = isCommand ? nowIso() : null

  try {
    await ensureEventStream(gwKey, input.sessionKey)
  } catch (error) {
    wrapGatewayError(error)
  }

  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: messageText,
      timeoutMs: input.timeoutMs,
      attachments: validatedAttachments,
      replyTo: input.replyTo,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  if (isCommand && commandTimestamp) {
    try {
      getDb()
        .prepare(
          "INSERT INTO sent_messages (id, session_key, text, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(generateId("cmd"), input.sessionKey, input.text, commandTimestamp)
    } catch {}
  }

  return result
}

export async function chatStop(input: { sessionKey: string }) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  const stream = activeStreams.get(gwKey)
  if (stream) {
    stream.close()
    activeStreams.delete(gwKey)
  }
  openingStreams.delete(gwKey)
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

function commandMessage(command: {
  id: string
  text: string
  created_at: string
}): HistMsg {
  return {
    id: command.id,
    role: "user",
    text: command.text,
    content: [{ type: "text", text: command.text }],
    createdAt: command.created_at,
    model: null,
  }
}

function commandMatchesInjectedReply(command: string, reply: string): boolean {
  const cmd = command.trim().toLowerCase()
  const text = reply.trim().toLowerCase()

  if (!cmd.startsWith("/") || !text) return false
  if (cmd === "/status") return text.includes("openclaw") || text.includes("runtime:")
  if (cmd === "/models" || cmd.startsWith("/models ")) {
    return text.includes("providers:") || text.includes("use: /model")
  }
  if (cmd === "/model" || cmd === "/model status") {
    return (
      text.includes("current:") ||
      text.includes("switch: /model") ||
      text.includes("browse: /models") ||
      text.includes("more: /model status")
    )
  }
  if (cmd.startsWith("/model ")) {
    const target = cmd.slice("/model ".length).trim()
    return (
      (text.includes("model set to") ||
        text.includes("switched") ||
        text.includes("using model")) &&
      (!target || text.includes(target))
    )
  }
  if (cmd === "/help") return text.includes("help") || text.includes("session")
  return false
}

function hasExistingCommandBefore(messages: HistMsg[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const msg = messages[i]
    const text = msg.text?.trim()
    if (!text && msg.role === "assistant") continue
    return msg.role === "user" && Boolean(text?.startsWith("/"))
  }
  return false
}

export function mergeCommandMessages(
  messages: HistMsg[],
  commands: Array<{ id: string; text: string; created_at: string }>,
): HistMsg[] {
  if (commands.length === 0) return messages

  const localCommandCounts = new Map<string, number>()
  for (const command of commands) {
    const text = command.text.trim()
    localCommandCounts.set(text, (localCommandCounts.get(text) ?? 0) + 1)
  }

  const historyMessages = messages.filter((msg) => {
    const text = msg.text?.trim()
    if (msg.role === "user" && text?.startsWith("/")) {
      const localCount = localCommandCounts.get(text) ?? 0
      if (localCount > 0) {
        localCommandCounts.set(text, localCount - 1)
        return false
      }
    }
    return true
  })

  const pending = commands
  if (pending.length === 0) return historyMessages

  const insertBefore = new Map<number, HistMsg[]>()
  const usedCommands = new Set<string>()

  for (let i = 0; i < historyMessages.length; i++) {
    const msg = historyMessages[i]
    if (msg.role !== "assistant" || msg.model !== "gateway-injected") continue
    const replyText = msg.text ?? ""
    const match = pending.find(
      (command) =>
        !usedCommands.has(command.id) &&
        commandMatchesInjectedReply(command.text, replyText),
    )
    if (!match) continue
    usedCommands.add(match.id)
    insertBefore.set(i, [...(insertBefore.get(i) ?? []), commandMessage(match)])
  }

  for (let i = 0; i < historyMessages.length; i++) {
    const msg = historyMessages[i]
    if (msg.role !== "assistant" || msg.model !== "gateway-injected") continue
    if (insertBefore.has(i) || hasExistingCommandBefore(historyMessages, i)) {
      continue
    }
    const fallback = pending.find((command) => !usedCommands.has(command.id))
    if (!fallback) break
    usedCommands.add(fallback.id)
    insertBefore.set(i, [
      ...(insertBefore.get(i) ?? []),
      commandMessage(fallback),
    ])
  }

  const merged: HistMsg[] = []
  for (let i = 0; i < historyMessages.length; i++) {
    const before = insertBefore.get(i)
    if (before) merged.push(...before)
    merged.push(historyMessages[i])
  }

  return merged
}

function stripBootstrapWarning(text: string): string {
  return text.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()
}

function hasContent(msg: HistMsg): boolean {
  const text = typeof msg.text === "string" ? msg.text.trim() : ""
  if (text) return true
  if (Array.isArray(msg.content) && msg.content.length > 0) return true
  return false
}

function deduplicateUserMessages(msgs: HistMsg[]): HistMsg[] {
  const result: HistMsg[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]

    if (msg.role === "assistant" && !hasContent(msg)) continue

    if (msg.role === "user") {
      const coreText = stripBootstrapWarning(
        typeof msg.text === "string" ? msg.text : ""
      )
      if (coreText) {
        let isDuplicate = false
        for (let j = result.length - 1; j >= Math.max(0, result.length - 4); j--) {
          const prev = result[j]
          if (prev.role !== "user") continue
          const prevCore = stripBootstrapWarning(
            typeof prev.text === "string" ? prev.text : ""
          )
          if (prevCore === coreText) {
            isDuplicate = true
            break
          }
        }
        if (isDuplicate) continue
      }
    }

    result.push(msg)
  }
  return result
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

  let msgs = deduplicateUserMessages((history.messages ?? []) as HistMsg[])

  try {
    const cronMsgs = await loadCronMessagesForSession(input.sessionKey)
    if (cronMsgs.length > 0) {
      msgs = [...msgs, ...cronMsgs].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return ta - tb
      })
    }
  } catch {}

  const aliasKeys = sessionAliasKeys(input.sessionKey, gwKey)
  const placeholders = aliasKeys.map(() => "?").join(", ")
  const commands = db
    .prepare(
      `SELECT id, text, created_at FROM sent_messages WHERE session_key IN (${placeholders}) AND text LIKE '/%' ORDER BY created_at ASC`,
    )
    .all(...aliasKeys) as Array<{
    id: string
    text: string
    created_at: string
  }>

  msgs = mergeCommandMessages(msgs, commands)

  const edits = db
    .prepare(
      "SELECT source_message_id, created_at FROM branches WHERE source_session_key = ? AND branch_reason = 'edit' ORDER BY created_at ASC",
    )
    .all(input.sessionKey) as Array<{
    source_message_id: string
    created_at: string
  }>

  if (edits.length === 0) return { ...history, messages: msgs }

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

async function loadCronMessagesForSession(sessionKey: string): Promise<HistMsg[]> {
  const { cronListJobs, cronListRuns, getParentSessionKey } = await import("./cron.service.js")

  let jobs: Awaited<ReturnType<typeof cronListJobs>>
  try {
    jobs = await cronListJobs()
  } catch {
    return []
  }

  const matchingJobs = jobs.jobs.filter((job) => {
    return getParentSessionKey(job.jobId) === sessionKey || job.session === sessionKey
  })
  if (matchingJobs.length === 0) return []

  const cronMsgs: HistMsg[] = []
  for (const job of matchingJobs) {
    try {
      const { runs } = await cronListRuns({ jobId: job.jobId, limit: 50, sortDir: "asc" })
      for (const run of runs) {
        if (run.status !== "completed" && run.status !== "failed") continue
        if (!run.sessionKey) continue
        try {
          const history = await getChatHistory(run.sessionKey)
          const messages = (history.messages ?? []) as HistMsg[]
          for (const m of messages) {
            const raw = m as Record<string, unknown>
            const text = typeof m.text === "string"
              ? m.text
              : String(raw.content ?? "")
            const prefix = m.role === "assistant" ? `**[Cron: ${job.name}]**\n` : ""
            cronMsgs.push({
              id: `cron:${run.runId}:${m.id ?? m.role}`,
              role: m.role,
              text: `${prefix}${text}`,
              content: [{ type: "text", text: `${prefix}${text}` }],
              createdAt: m.createdAt ?? run.startedAt,
              model: m.role === "assistant" ? "cron" : undefined,
            } as HistMsg)
          }
        } catch {}
      }
    } catch {}
  }
  return cronMsgs
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
    await ensureEventStream(gwKey, input.sessionKey)
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: input.text,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  return {
    ...result,
    editedMessageId: input.messageId,
    action: "edit_and_resend",
  }
}

function histText(message: HistMsg | undefined): string {
  if (!message) return ""
  if (typeof message.text === "string") return message.text
  const content = message.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return ""
        const typed = block as { text?: unknown; content?: unknown }
        if (typeof typed.text === "string") return typed.text
        if (typeof typed.content === "string") return typed.content
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

function buildEditPreviewPrompt(params: {
  priorMessages: HistMsg[]
  editedText: string
}) {
  const transcript = params.priorMessages
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : null
      const text = histText(message).trim()
      if (!role || !text) return null
      return `${role}: ${text}`
    })
    .filter(Boolean)
    .join("\n\n")

  if (!transcript) return params.editedText

  return [
    "Continue the conversation below. The prior transcript is context only; do not repeat it unless needed.",
    "",
    "Prior transcript:",
    transcript,
    "",
    "User edited their latest message to:",
    params.editedText,
  ].join("\n")
}

export async function chatEditLastPreview(input: {
  sessionKey: string
  userMessageId: string
  text: string
}) {
  const editedText = input.text.trim()
  if (!editedText) throw new Error("Edited message cannot be empty")

  const gwKey = resolveGatewayKey(input.sessionKey)
  let history: Awaited<ReturnType<typeof getChatHistory>>
  try {
    history = await getChatHistory(gwKey)
  } catch (error) {
    throw wrapGatewayError(error)
  }

  const messages = ((history.messages ?? []) as HistMsg[]).filter((m) => m.role === "user" || m.role === "assistant")
  const sourceIdx = messages.findIndex((m) => m.id === input.userMessageId || (m as Record<string, unknown>).messageId === input.userMessageId)
  if (sourceIdx === -1) throw new Error("Message not found")
  if (messages[sourceIdx]?.role !== "user") throw new Error("Only user messages can be edited")
  const laterUser = messages.slice(sourceIdx + 1).some((m) => m.role === "user")
  if (laterUser) throw new Error("Only the latest user message can be edited")

  const sourceAssistant = messages.slice(sourceIdx + 1).find((m) => m.role === "assistant")
  const priorMessages = messages.slice(0, sourceIdx)
  const label = `Edit preview ${crypto.randomUUID().slice(0, 8)}`
  const created = await createChatSession({ agentId: "main", label, model: readPrimaryModel() })
  const branchSessionKey = created.sessionKey
  const branchId = `edit_preview_${crypto.randomUUID().replace(/-/g, "")}`
  const now = new Date().toISOString()

  try {
    getDb().prepare(
      "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_reason, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      branchId,
      input.sessionKey,
      input.userMessageId,
      branchSessionKey,
      "edit_preview",
      now,
      JSON.stringify({
        type: "last_message_edit",
        status: "pending",
        originalSessionKey: input.sessionKey,
        originalGatewayKey: gwKey,
        editedSessionKey: branchSessionKey,
        sourceUserMessageId: input.userMessageId,
        sourceAssistantMessageId: sourceAssistant?.id ?? null,
      }),
    )
  } catch {}

  const prompt = buildEditPreviewPrompt({ priorMessages, editedText })
  try {
    await ensureEventStream(branchSessionKey, branchSessionKey)
    await sendChatMessage({ sessionKey: branchSessionKey, text: prompt })
  } catch (error) {
    try { await deleteChatSession(branchSessionKey) } catch {}
    throw wrapGatewayError(error)
  }

  return {
    branchId,
    branchSessionKey,
    sourceUserMessageId: input.userMessageId,
    sourceAssistantMessageId: sourceAssistant?.id ?? null,
    original: {
      user: messages[sourceIdx],
      assistant: sourceAssistant ?? null,
    },
    edited: {
      user: {
        id: `edited:${input.userMessageId}`,
        role: "user",
        text: editedText,
        createdAt: now,
      },
      assistant: null,
    },
  }
}

export async function chatSelectEditBranch(input: {
  sessionKey: string
  branchSessionKey: string
  selected: "original" | "edited"
}) {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db.prepare(
    "SELECT id, metadata_json FROM branches WHERE source_session_key = ? AND branch_session_key = ? AND branch_reason = 'edit_preview' ORDER BY created_at DESC LIMIT 1",
  ).get(input.sessionKey, input.branchSessionKey) as { id: string; metadata_json: string | null } | undefined
  if (!row) throw new Error("Edit preview branch not found")

  let metadata: Record<string, unknown> = {}
  try { metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {} } catch {}
  metadata.status = "selected"
  metadata.selected = input.selected
  metadata.selectedAt = now

  if (input.selected === "edited") {
    const oldGwKey = resolveGatewayKey(input.sessionKey)
    const existing = activeStreams.get(oldGwKey)
    if (existing) {
      existing.close()
      activeStreams.delete(oldGwKey)
    }
    const branchStream = activeStreams.get(input.branchSessionKey)
    if (branchStream) {
      branchStream.close()
      activeStreams.delete(input.branchSessionKey)
    }
    persistGatewayKey(input.sessionKey, input.branchSessionKey)
    metadata.activeGatewayKey = input.branchSessionKey
  } else {
    const branchStream = activeStreams.get(input.branchSessionKey)
    if (branchStream) {
      branchStream.close()
      activeStreams.delete(input.branchSessionKey)
    }
    try { await deleteChatSession(input.branchSessionKey) } catch {}
  }

  db.prepare("UPDATE branches SET metadata_json = ? WHERE id = ?").run(JSON.stringify(metadata), row.id)
  return { ok: true, selected: input.selected, activeSessionKey: input.selected === "edited" ? input.branchSessionKey : resolveGatewayKey(input.sessionKey) }
}

export async function chatRegenerate(input: {
  sessionKey: string
  messageId: string
  text: string
}) {
  const gwKey = resolveGatewayKey(input.sessionKey)
  let result: Awaited<ReturnType<typeof sendChatMessage>>
  try {
    await ensureEventStream(gwKey, input.sessionKey)
    result = await sendChatMessage({
      sessionKey: gwKey,
      text: input.text,
      regenerate: true,
    })
  } catch (error) {
    wrapGatewayError(error)
  }

  return {
    ...result,
    regeneratedMessageId: input.messageId,
    action: "regenerate",
  }
}

async function ensureEventStream(gwKey: string, localKey: string) {
  if (activeStreams.has(gwKey)) return

  const opening = openingStreams.get(gwKey)
  if (opening) {
    await opening
    return
  }

  const openingPromise = startEventStream(gwKey, localKey)
  openingStreams.set(gwKey, openingPromise)
  try {
    await openingPromise
  } finally {
    openingStreams.delete(gwKey)
  }
}

async function startEventStream(gwKey: string, localKey: string) {
  const existing = activeStreams.get(gwKey)
  if (existing) {
    existing.close()
    activeStreams.delete(gwKey)
  }

  let doneCount = 0
  let consecutiveAgentErrors = 0
  let lastModelName: string | null = null
  let lastAssistantMessage: { text: string; at: number } | null = null
  const MAX_AGENT_RETRIES = 2

  const stream = await openChatEventStream({
    sessionKey: gwKey,
    onEvent(event: ChatStreamEvent) {
      console.log(`[stream:${localKey.slice(-8)}] ${event.type}`, event.type === "chat.status" ? (event as ChatStatusEvent).state : event.type === "chat.tool" ? `${(event as ChatToolEvent).name}:${(event as ChatToolEvent).phase}` : event.type === "chat.agent" ? `phase=${(event as ChatAgentEvent).phase}` : "")

      if (event.type === "chat.message" && (event as ChatMessageEvent).model) {
        lastModelName = (event as ChatMessageEvent).model
      }

      if (event.type === "chat.message") {
        const msg = event as ChatMessageEvent
        const text = typeof msg.text === "string" ? msg.text.trim() : ""
        const now = Date.now()
        if (
          msg.role === "assistant" &&
          text &&
          lastAssistantMessage?.text === text &&
          now - lastAssistantMessage.at < 1000
        ) {
          return
        }
        if (msg.role === "assistant" && text) {
          lastAssistantMessage = { text, at: now }
        }
      }

      if (event.type === "chat.agent") {
        const agent = event as ChatAgentEvent
        if (agent.phase === "error") {
          consecutiveAgentErrors++
          if (consecutiveAgentErrors >= MAX_AGENT_RETRIES) {
            const modelHint = lastModelName ? ` (model: ${lastModelName})` : ""
            console.error(`[stream:${localKey.slice(-8)}] agent failed ${consecutiveAgentErrors} times${modelHint} — surfacing error`)
            chatEvents.emit(`chat:event:${localKey}`, {
              type: "chat.error",
              sessionKey: localKey,
              message: `The model${modelHint} failed to respond. Check your API key and model provider configuration.`,
            } satisfies ChatStreamEvent)
            const errorStatus: ChatStatusEvent = {
              type: "chat.status",
              sessionKey: localKey,
              state: "error",
              label: "model_error",
            }
            lastSessionStatus.set(localKey, errorStatus)
            chatEvents.emit(`chat:event:${localKey}`, errorStatus)
            return
          }
        }
      }

      if (event.type === "chat.message" || event.type === "chat.status") {
        const msg = event.type === "chat.message" ? event : null
        const status = event.type === "chat.status" ? event as ChatStatusEvent : null
        if ((msg && "text" in msg && typeof msg.text === "string" && msg.text.length > 0) || (status && status.state === "done")) {
          consecutiveAgentErrors = 0
        }
      }

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
  activeStreams.set(gwKey, stream)
  console.log(`[stream:${localKey.slice(-8)}] stream opened`)
}

export function chatStartSubagentStream(input: { sessionKey: string }) {
  const gwKey = input.sessionKey
  if (activeStreams.has(gwKey) || openingStreams.has(gwKey)) {
    return { started: false, reason: "already_active" }
  }
  void ensureEventStream(gwKey, gwKey).catch((error) => {
    console.error(`[stream:${gwKey.slice(-8)}] stream error:`, error)
    chatEvents.emit(`chat:event:${gwKey}`, {
      type: "chat.error",
      sessionKey: gwKey,
      message:
        error instanceof Error
          ? error.message
          : "Failed to open event stream",
    } satisfies ChatStreamEvent)
  })
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
