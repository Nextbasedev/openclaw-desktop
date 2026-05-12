import { randomId } from "./id"
import type {
  ChatMessage,
  ContentBlock,
  InlineToolCall,
  ReplyTo,
  SpawnedSubagent,
} from "../components/ChatView/types"
import { extractText } from "../components/ChatView/utils"
import { extractSubagentSessionKey, extractSubagentSessionKeys } from "./subagentSession"
import { mergeAssistantText } from "./chatMessageDedupe"

const BLOCKQUOTE_RE = /^((?:>[^\n]*(?:\n|$))+)\n([\s\S]+)$/
const REFERENCE_BLOCK_RE = /Reference\s+\d+:\s*(?:\n)?([\s\S]*?)(?=\n\nReference\s+\d+:|$)/gi

export function extractReplyBlock(
  text: string,
  priorMessages: ChatMessage[]
): { replyTo: ReplyTo; displayText: string } | null {
  return extractReplyFromText(text, priorMessages)
}

function extractReplyFromText(
  text: string,
  priorMessages: ChatMessage[]
): { replyTo: ReplyTo; displayText: string } | null {
  const match = text.match(BLOCKQUOTE_RE)
  if (!match) return null

  const quoted = match[1]
    .split("\n")
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n")
    .trim()
  const displayText = match[2].trim()
  if (!quoted || !displayText) return null

  const referenceReply = extractSelectedReferenceReply(quoted, priorMessages)
  if (referenceReply) {
    return { replyTo: referenceReply, displayText }
  }

  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const msg = priorMessages[i]
    if (
      msg.text.startsWith(quoted) ||
      quoted.startsWith(msg.text.slice(0, 150))
    ) {
      return {
        replyTo: { messageId: msg.messageId, role: msg.role, text: msg.text },
        displayText,
      }
    }
  }

  return {
    replyTo: { messageId: "", role: "assistant", text: quoted },
    displayText,
  }
}

function extractSelectedReferenceReply(
  quoted: string,
  priorMessages: ChatMessage[]
): ReplyTo | null {
  const selections: NonNullable<ReplyTo["selections"]> = []
  REFERENCE_BLOCK_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = REFERENCE_BLOCK_RE.exec(quoted)) !== null) {
    const selectedText = match[1]
      .replace(/\nComment:[\s\S]*$/i, "")
      .trim()
    if (!selectedText) continue

    const sourceMessage = [...priorMessages]
      .reverse()
      .find((message) => message.text.includes(selectedText))
    if (!sourceMessage) continue

    selections.push({
      messageId: sourceMessage.messageId,
      text: selectedText,
    })
  }

  if (selections.length === 0) return null

  return {
    messageId: `${selections.at(-1)?.messageId}:selection:${selections.length}`,
    role: "assistant",
    text: quoted,
    selections,
  }
}

export type RawHistoryMessage = {
  id?: string
  messageId?: string
  __openclaw?: {
    id?: string
    seq?: number
  }
  role?: string
  text?: string
  content?: string | ContentBlock[]
  errorMessage?: string | null
  createdAt?: string
  timestamp?: number
  toolCallId?: string
  toolName?: string
  details?: unknown
  isError?: boolean
  error?: unknown
  status?: unknown
  model?: string
  provider?: string
  usage?: ChatMessage["usage"]
  stopReason?: string | null
  isOptimistic?: boolean
  __clientOptimistic?: boolean
}

export type ParsedChatHistory = {
  messages: ChatMessage[]
  subagents: SpawnedSubagent[]
}

function openclawSeq(raw: RawHistoryMessage) {
  const seq = raw.__openclaw?.seq
  return typeof seq === "number" && Number.isFinite(seq)
    ? Math.floor(seq)
    : undefined
}

function messageId(raw: RawHistoryMessage) {
  const openclawId = raw.__openclaw?.id
  if (typeof openclawId === "string" && openclawId.trim()) return openclawId
  if (raw.id) return raw.id
  if (raw.messageId) return raw.messageId
  const seq = openclawSeq(raw)
  if (typeof seq === "number") {
    return `openclaw:${seq}`
  }
  const text = visibleMessageText(raw).trim().replace(/\s+/g, " ").slice(0, 160)
  if (raw.role && raw.createdAt && text) return `${raw.role}:${raw.createdAt}:${text}`
  return randomId()
}

function toolBlocks(raw: RawHistoryMessage) {
  if (!Array.isArray(raw.content)) return []
  return raw.content.filter(
    (block) => block.type === "toolCall" || block.type === "tool_use"
  )
}

function toolResultText(raw: RawHistoryMessage): string {
  return raw.text || extractText(raw.content)
}

function visibleMessageText(raw: RawHistoryMessage): string {
  const text = raw.text || extractText(raw.content)
  if (text.trim()) return text
  if (
    raw.role === "assistant" &&
    raw.stopReason === "error" &&
    raw.errorMessage
  ) {
    return `Error: ${raw.errorMessage}`
  }
  return ""
}

function inferToolStatus(raw: RawHistoryMessage, resultText: string): InlineToolCall["status"] {
  if (raw.isError === true || raw.status === "error" || raw.error) return "error"
  const detailStatus = objectValue(raw.details, "status")
  const detailExitCode = objectValue(raw.details, "exitCode")
  if (detailStatus === "error" || detailStatus === "failed") return "error"
  if (typeof detailExitCode === "number" && Number.isFinite(detailExitCode) && detailExitCode !== 0) return "error"
  if (!resultText) return "success"
  try {
    const parsed = JSON.parse(resultText) as { status?: unknown; error?: unknown; exitCode?: unknown }
    if (parsed.status === "error" || parsed.status === "failed" || parsed.error) return "error"
    if (typeof parsed.exitCode === "number" && Number.isFinite(parsed.exitCode) && parsed.exitCode !== 0) return "error"
  } catch {
    if (/^\s*(error|failed|exception|traceback)\b/i.test(resultText)) return "error"
  }
  return "success"
}

function rawTimestampMs(raw: RawHistoryMessage): number | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp
  }
  if (raw.createdAt) {
    const parsed = Date.parse(raw.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function createdAtIso(raw: RawHistoryMessage): string | undefined {
  if (raw.createdAt) return raw.createdAt
  const ts = rawTimestampMs(raw)
  return ts !== null ? new Date(ts).toISOString() : undefined
}

function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 100) return "0.1s"
  return `${(ms / 1000).toFixed(1)}s`
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function toolResultDurationMs(
  raw: RawHistoryMessage,
  resultText: string
): number | null {
  const detailTookMs = objectValue(raw.details, "tookMs")
  if (typeof detailTookMs === "number" && Number.isFinite(detailTookMs)) {
    return detailTookMs
  }
  try {
    const parsed = JSON.parse(resultText) as unknown
    const tookMs = objectValue(parsed, "tookMs")
    if (typeof tookMs === "number" && Number.isFinite(tookMs)) return tookMs
  } catch {
    // Result text is not guaranteed to be JSON.
  }
  return null
}

export function stripBootstrap(t: string): string {
  return t.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()
}

const SYSTEM_LINE_RE =
  /^System(?:\s*\([^)]*\))?:\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+UTC\]\s*[^\n]*\n*/
const TZ_RE = /(?:UTC|GMT(?:[+-]\d{1,2}(?::\d{2})?)?)/
const TIMESTAMP_PREFIX_RE =
  new RegExp(
    String.raw`^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+${TZ_RE.source}\]\s*`
  )
const BARE_TIMESTAMP_RE =
  new RegExp(
    String.raw`^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+${TZ_RE.source}\]\s*`
  )
const CRON_HEADER_RE = /^\[cron:[^\]]*\]\s*(?:Reply with exactly:\s*)?/
const CURRENT_TIME_RE = /^Current time:\s*[^\n]+\n*/m
const MESSAGE_TOOL_RE =
  /^Use the message tool if you need to notify the user directly[^\n]*(?:\.\s*If you do not send directly[^\n]*)?\n*/m
const ASYNC_RESULT_RE =
  /^An async command you ran earlier has completed\.[^\n]*(?:\n[^\n]*Handle the result internally[^\n]*)?(?:\n[^\n]*Do not relay[^\n]*)?\n*/m
const MEDIA_ATTACHMENT_HEADER_RE = /^\[media attached:[\s\S]*?\]\s*/
const MEDIA_REPLY_INSTRUCTION_RE =
  /^To send an image back,[\s\S]*?Keep caption in the text body\.\s*/
const SENDER_METADATA_RE =
  /^Sender \(untrusted metadata\):\s*```(?:json)?\s*[\s\S]*?```\s*/
const BRACKETED_DAY_TIME_RE =
  /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:UTC|GMT[+-]\d{1,2}:?\d{2})\]\s*/

function stripMediaAttachmentPreamble(text: string): string {
  let result = text
  let hadMediaHeader = false

  while (MEDIA_ATTACHMENT_HEADER_RE.test(result)) {
    hadMediaHeader = true
    result = result.replace(MEDIA_ATTACHMENT_HEADER_RE, "")
  }

  if (hadMediaHeader) {
    result = result.replace(MEDIA_REPLY_INSTRUCTION_RE, "")
  }

  return result
}

function parseSenderMetadataPreamble(text: string): {
  nextText: string
  stripped: boolean
} {
  const match = text.match(
    /^Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```\s*/i
  )
  if (!match) {
    return { nextText: text, stripped: false }
  }

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>
    const hasIdentityField =
      typeof parsed.id === "string" ||
      typeof parsed.label === "string" ||
      typeof parsed.name === "string" ||
      typeof parsed.username === "string"
    if (!hasIdentityField) {
      return { nextText: text, stripped: false }
    }
  } catch {
    return { nextText: text, stripped: false }
  }

  return {
    nextText: text.slice(match[0].length),
    stripped: true,
  }
}

export function stripGatewayPrefixes(text: string): string {
  let result = text
  while (SYSTEM_LINE_RE.test(result)) {
    result = result.replace(SYSTEM_LINE_RE, "")
  }

  while (true) {
    const senderMetadata = parseSenderMetadataPreamble(result)
    result = senderMetadata.nextText
    if (!senderMetadata.stripped) break
  }
  result = stripMediaAttachmentPreamble(result)
  result = result.replace(SENDER_METADATA_RE, "")
  result = result.replace(CRON_HEADER_RE, "")
  result = result.replace(CURRENT_TIME_RE, "")
  result = result.replace(MESSAGE_TOOL_RE, "")
  result = result.replace(ASYNC_RESULT_RE, "")
  result = result.replace(TIMESTAMP_PREFIX_RE, "")
  result = result.replace(BRACKETED_DAY_TIME_RE, "")
  result = result.replace(BARE_TIMESTAMP_RE, "")
  return result.trim()
}

export function cleanUserMessageText(text: string): string {
  return stripGatewayPrefixes(stripBootstrap(text))
}

function isGatewayInjectedCommandOutput(message: RawHistoryMessage) {
  return (
    message.role === "assistant" &&
    message.provider === "openclaw" &&
    message.model === "gateway-injected"
  )
}

export function isAbortedGatewayArtifact(message: RawHistoryMessage) {
  if (!isGatewayInjectedCommandOutput(message)) return false
  const text = visibleMessageText(message).toLowerCase()
  return (
    text.includes("aborted") ||
    text.includes("operation was aborted")
  )
}

function isSlashCommandMessage(message: RawHistoryMessage | undefined) {
  if (!message || message.role !== "user") return false
  const text = cleanUserMessageText(
    message.text || extractText(message.content)
  )
  return text.trim().startsWith("/")
}

export function isTransientSlashCommandHistory(
  raw: RawHistoryMessage[]
): boolean {
  if (raw.length === 0) return false
  const visible = raw.filter((message) => {
    if (message.role === "user") {
      const text = cleanUserMessageText(
        message.text || extractText(message.content)
      )
      return text.length > 0
    }
    return Boolean(
      message.text ||
      extractText(message.content) ||
      isGatewayInjectedCommandOutput(message)
    )
  })
  const last = visible.at(-1)
  if (!last || !isGatewayInjectedCommandOutput(last)) return false
  return !isSlashCommandMessage(visible.at(-2))
}

export function deduplicateRawMessages(
  raw: RawHistoryMessage[]
): RawHistoryMessage[] {
  const result: RawHistoryMessage[] = []
  for (const item of raw) {
    if (isAbortedGatewayArtifact(item)) continue
    const currText = visibleMessageText(item).trim()
    if (item.role === "assistant" && !currText && !toolBlocks(item).length) {
      continue
    }

    const prev = result[result.length - 1]
    if (prev && prev.role === item.role) {
      const prevText = prev.text || extractText(prev.content)
      if (prevText.trim() && prevText.trim() === currText) continue
    }
    result.push(item)
  }
  return result
}

export function parseChatHistory(raw: RawHistoryMessage[]): ParsedChatHistory {
  const deduped = deduplicateRawMessages(raw)
  const messages: ChatMessage[] = []
  const subagents: SpawnedSubagent[] = []
  let pendingToolCalls: InlineToolCall[] = []
  let resultQueue: Array<InlineToolCall & { startedAtMs?: number | null }> = []
  const pendingToolById = new Map<
    string,
    InlineToolCall & { startedAtMs?: number | null }
  >()
  const subagentByToolId = new Map<
    string,
    SpawnedSubagent & { terminal?: boolean }
  >()
  const subagentBySessionKey = new Map<string, SpawnedSubagent & { terminal?: boolean }>()

  for (const item of deduped) {
    const role = item.role

    if (role === "user") {
      const rawText = item.text || extractText(item.content)
      const text = rawText ? cleanUserMessageText(rawText) : ""
      const completed = /\bstatus:\s*completed successfully\b/i.test(rawText)
      const failed = /\bstatus:\s*(failed|errored|error)\b/i.test(rawText)
      if (completed || failed) {
        for (const key of extractSubagentSessionKeys(rawText)) {
          const subagent = subagentBySessionKey.get(key)
          if (subagent) {
            subagent.terminal = true
            subagent.status = failed ? "failed" : "completed"
          }
        }
      }
      if (text) {
        const reply = extractReplyFromText(text, messages)
        messages.push({
          messageId: messageId(item),
          role: "user",
          text: reply ? reply.displayText : text,
          createdAt: createdAtIso(item),
          model: item.model,
          usage: item.usage,
          stopReason: item.stopReason,
          isOptimistic: Boolean(item.isOptimistic || item.__clientOptimistic),
          replyTo: reply?.replyTo,
          gatewayIndex: openclawSeq(item),
        })
      }
      pendingToolCalls = []
      resultQueue = []
      pendingToolById.clear()
      continue
    }

    if (role === "assistant") {
      for (const block of toolBlocks(item)) {
        const call: InlineToolCall & { startedAtMs?: number | null } = {
          id: block.id ?? randomId(),
          tool: block.name ?? "unknown",
          status:
            block.isError || block.status === "error"
              ? "error"
              : block.status === "success"
                ? "success"
                : "running",
          input: block.arguments ?? block.input,
          duration: block.duration,
          startedAtMs: rawTimestampMs(item),
        }
        pendingToolCalls.push(call)
        resultQueue.push(call)
        pendingToolById.set(call.id, call)

        if (block.name === "sessions_spawn") {
          const args = (block.input ?? {}) as Record<string, unknown>
          const task = typeof args.task === "string" ? args.task : ""
          const label =
            (typeof args.label === "string" && args.label) ||
            (typeof args.agentId === "string" && args.agentId) ||
            (task ? task.slice(0, 60) : `Sub-agent ${subagents.length + 1}`)
          subagentByToolId.set(call.id, {
            id: `spawn:${call.id}`,
            label,
            task,
            sessionKey: null,
            status: "linking",
            toolCallId: call.id,
          })
        }
      }

      const text = visibleMessageText(item).trim()
      if (text || pendingToolCalls.length > 0) {
        const last = messages.at(-1)
        if (last?.role === "assistant") {
          if (text) last.text = mergeAssistantText(last.text, text)
          last.toolCalls = [...(last.toolCalls ?? []), ...pendingToolCalls]
          last.messageId = messageId(item)
          last.createdAt = createdAtIso(item) ?? last.createdAt
          last.model = item.model ?? last.model
          last.usage = item.usage ?? last.usage
          last.stopReason = item.stopReason ?? last.stopReason
          last.gatewayIndex = openclawSeq(item) ?? last.gatewayIndex
        } else {
          messages.push({
            messageId: messageId(item),
            role: "assistant",
            text,
            createdAt: createdAtIso(item),
            model: item.model,
            usage: item.usage,
            stopReason: item.stopReason,
            toolCalls:
              pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
            gatewayIndex: openclawSeq(item),
          })
        }
        pendingToolCalls = []
      }
      continue
    }

    if (role === "tool" || role === "tool_result" || role === "toolResult") {
      const matched = item.toolCallId
        ? pendingToolById.get(item.toolCallId) ??
          resultQueue.find((call) => call.id === item.toolCallId)
        : resultQueue.shift()
      if (!matched) continue
      pendingToolById.delete(matched.id)
      resultQueue = resultQueue.filter((call) => call.id !== matched.id)
      const resultText = toolResultText(item)
      matched.status = inferToolStatus(item, resultText)
      matched.resultText = resultText || matched.resultText
      const preciseDurationMs = toolResultDurationMs(item, resultText)
      const fallbackDurationMs = (() => {
        const finishedAt = rawTimestampMs(item)
        return finishedAt !== null &&
          matched.startedAtMs !== null &&
          matched.startedAtMs !== undefined
          ? finishedAt - matched.startedAtMs
          : null
      })()
      matched.duration =
        formatDuration(preciseDurationMs ?? fallbackDurationMs ?? -1) ??
        matched.duration
      const subagent = subagentByToolId.get(matched.id)
      if (subagent && matched.tool === "sessions_spawn") {
        const childKey = extractSubagentSessionKey(resultText)
        subagent.sessionKey = childKey
        if (childKey) subagentBySessionKey.set(childKey, subagent)
        subagent.status =
          matched.status === "error"
            ? "failed"
            : childKey
              ? "working"
              : "linking"
      }
      if (matched.tool === "sessions_yield") {
        const latest = Array.from(subagentByToolId.values())
          .reverse()
          .find((spawn) => !spawn.terminal)
        if (latest) {
          latest.terminal = true
          latest.status = matched.status === "error" ? "failed" : "completed"
        }
      }
    }
  }

  for (const spawn of subagentByToolId.values()) {
    const publicSpawn = { ...spawn }
    delete publicSpawn.terminal
    subagents.push(publicSpawn)
  }

  return { messages, subagents }
}
