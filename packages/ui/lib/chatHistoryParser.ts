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
import { buildInboundMediaUrl } from "./middlewareMedia"

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
    gatewaySeq?: number | null
    segmentId?: string | null
    runId?: string | null
  }
  runId?: string
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
  attachments?: unknown[]
  toolCalls?: unknown[]
  tools?: unknown[]
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

function gatewaySeq(raw: RawHistoryMessage) {
  const seq = raw.__openclaw?.gatewaySeq
  return typeof seq === "number" && Number.isFinite(seq) && seq > 0
    ? Math.floor(seq)
    : undefined
}

function inferGatewayOrderBase(raw: RawHistoryMessage[]) {
  let base: number | undefined
  for (const item of raw) {
    const seq = openclawSeq(item)
    const gateway = gatewaySeq(item)
    if (seq === undefined || gateway === undefined) continue
    const diff = seq - gateway
    if (diff < 0) continue
    base = base === undefined ? diff : Math.min(base, diff)
  }
  return base
}

function messageOrderSeq(raw: RawHistoryMessage, gatewayOrderBase: number | undefined) {
  // openclawSeq is the canonical, monotonic persisted order from the
  // middleware. Trust it first. Earlier this preferred gatewayOrderBase +
  // gatewaySeq, but the raw gatewaySeq can be out of order within a single run
  // (e.g. a create_task/subagent-spawn assistant message gets a HIGHER
  // gatewaySeq than its own tool results and the follow-up reply), which pushed
  // the spawning tool card below the assistant's answer. Only fall back to the
  // gateway-derived position when the canonical seq is absent (pure live rows
  // that have not been persisted yet).
  const seq = openclawSeq(raw)
  if (seq !== undefined) return seq
  const gateway = gatewaySeq(raw)
  if (gateway !== undefined && gatewayOrderBase !== undefined) {
    return gatewayOrderBase + gateway
  }
  return undefined
}

function messageRunId(raw: RawHistoryMessage) {
  const runId = raw.__openclaw?.runId ?? raw.runId
  return typeof runId === "string" && runId.trim() ? runId.trim() : undefined
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

type RawToolBlock = ContentBlock & {
  toolCallId?: string
  tool_call_id?: string
  toolName?: string
  tool_name?: string
  tool?: string
  args?: unknown
  parameters?: unknown
  argsMeta?: unknown
  result?: unknown
  resultMeta?: unknown
  phase?: string
  startedAtMs?: number
  finishedAtMs?: number | null
}

function isToolBlock(block: ContentBlock) {
  const type = block.type.toLowerCase()
  return type === "toolcall" || type === "tool_call" || type === "tooluse" || type === "tool_use"
}

function thinkingText(raw: RawHistoryMessage): string {
  if (!Array.isArray(raw.content)) return ""
  return raw.content
    .filter((block) => block && typeof block === "object" && !Array.isArray(block) && block.type === "thinking")
    .map((block) => {
      const record = block as { text?: unknown; content?: unknown }
      return typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : ""
    })
    .join("")
}

function toolBlocks(raw: RawHistoryMessage): RawToolBlock[] {
  const contentBlocks = Array.isArray(raw.content)
    ? raw.content.filter(isToolBlock)
    : []
  const projectedBlocks = [
    ...(Array.isArray(raw.toolCalls) ? raw.toolCalls : []),
    ...(Array.isArray(raw.tools) ? raw.tools : []),
  ].filter((block): block is RawToolBlock => Boolean(block && typeof block === "object" && !Array.isArray(block)))
  return [...contentBlocks, ...projectedBlocks] as RawToolBlock[]
}

function toolBlockId(block: RawToolBlock) {
  // Gateway/live projections can include both a per-event/block `id` and the
  // stable logical tool call id. The UI must group by the logical tool id;
  // otherwise repeated update/result projections for one tool inflate the
  // visible Steps count and render duplicate rows.
  return block.toolCallId ?? block.tool_call_id ?? block.id
}

function toolBlockName(block: RawToolBlock) {
  return block.name ?? block.toolName ?? block.tool_name ?? block.tool
}

function toolBlockInput(block: RawToolBlock) {
  return block.arguments ?? block.input ?? block.args ?? block.parameters ?? block.argsMeta
}

function toolBlockResultText(block: RawToolBlock) {
  const result = block.resultMeta ?? block.result
  if (result == null) return undefined
  if (isAwaitingToolResult(result)) return undefined
  if (typeof result === "string") return result
  if (typeof result === "object" && !Array.isArray(result)) {
    const record = result as { text?: unknown; content?: unknown; result?: unknown }
    const value = record.text ?? record.content ?? record.result
    if (typeof value === "string") return value
  }
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function isAwaitingToolResult(value: unknown) {
  if (!value) return false
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as { awaitingResult?: unknown; completionInferred?: unknown; source?: unknown; reason?: unknown }
    return record.awaitingResult === true || (
      "awaitingResult" in record &&
      "completionInferred" in record &&
      record.source === "gateway_live_tool_result" &&
      typeof record.reason === "string"
    )
  }
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    return isAwaitingToolResult(JSON.parse(trimmed) as unknown)
  } catch {
    return false
  }
}

function inferToolBlockStatus(block: RawToolBlock): InlineToolCall["status"] {
  const status = block.status ?? block.phase
  if (block.isError || status === "error" || status === "failed") return "error"
  if (
    status === "success" ||
    status === "result" ||
    status === "done" ||
    status === "complete" ||
    status === "completed" ||
    block.finishedAtMs != null ||
    block.resultMeta != null ||
    block.result != null
  ) return "success"
  return "running"
}

function toolResultText(raw: RawHistoryMessage): string {
  return raw.text || extractText(raw.content)
}

export function formatChatErrorMessage(error: unknown): string {
  const raw = typeof error === "string" ? error.trim() : String(error ?? "").trim()
  if (!raw) return "Something went wrong. Try again."

  const withoutPrefix = raw.replace(/^Error:\s*/i, "").trim()
  const httpJson = withoutPrefix.match(/^(\d{3})\s+(\{[\s\S]*\})$/)
  if (httpJson) {
    try {
      const parsed = JSON.parse(httpJson[2]) as { code?: unknown; message?: unknown; error?: unknown }
      if (parsed.code === "deactivated_workspace") {
        return "Workspace is deactivated. Reactivate the workspace and try again."
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim()
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim()
      if (typeof parsed.code === "string" && parsed.code.trim()) return parsed.code.trim().replace(/_/g, " ")
    } catch {}
  }

  try {
    const parsed = JSON.parse(withoutPrefix) as { code?: unknown; message?: unknown; error?: unknown }
    if (parsed.code === "deactivated_workspace") {
      return "Workspace is deactivated. Reactivate the workspace and try again."
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim()
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim()
  } catch {}

  return withoutPrefix
}

function normalizeAssistantText(text: string): string {
  if (!/^\s*Error:\s*\d{3}\s+\{/.test(text)) return text
  return `Error: ${formatChatErrorMessage(text)}`
}

function visibleMessageText(raw: RawHistoryMessage): string {
  const text = raw.text || extractText(raw.content)
  if (text.trim()) return normalizeAssistantText(text)
  if (
    raw.role === "assistant" &&
    raw.stopReason === "error" &&
    raw.errorMessage
  ) {
    return `Error: ${formatChatErrorMessage(raw.errorMessage)}`
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
    if (/^\s*(error|failed|failure|exception|traceback|denied|rejected)\b/i.test(resultText)) return "error"
  }
  return "success"
}

function rawTimestampMs(raw: RawHistoryMessage): number | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp > 100_000_000 && raw.timestamp < 10_000_000_000
      ? Math.round(raw.timestamp * 1000)
      : Math.round(raw.timestamp)
  }
  if (raw.createdAt) {
    const parsed = Date.parse(raw.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function realTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value > 100_000_000 && value < 10_000_000_000
    ? Math.round(value * 1000)
    : Math.round(value)
}

function createdAtIso(raw: RawHistoryMessage): string | undefined {
  if (raw.createdAt) return raw.createdAt
  const ts = rawTimestampMs(raw)
  return ts !== null ? new Date(ts).toISOString() : undefined
}

function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 0 || ms > 30 * 60 * 1000) return undefined
  if (ms < 100) return "0.1s"
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
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

function blockDurationMs(block: ContentBlock): number | null {
  if (typeof block.durationMs === "number" && Number.isFinite(block.durationMs)) return block.durationMs
  if (typeof block.duration !== "string") return null
  const match = block.duration.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds)$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  return match[2].toLowerCase() === "ms" ? value : value * 1000
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
const MEDIA_ATTACHMENT_MARKER_RE = /\s*\[media attached:[^\]]+\]\s*/gim
const MEDIA_ATTACHMENT_MARKER_CAPTURE_RE = /\[media attached:\s*([^\]]+)\]/gim
const ATTACHED_FILE_MARKER_RE = /^\s*\[Attached (?:images?|audio(?: file)?|file):[^\]]+\]\s*/gim
const ATTACHED_FILE_MARKER_CAPTURE_RE = /\[Attached (images?|audio(?: file)?|file):([^\]]+)\]/gim
const MEDIA_REPLY_INSTRUCTION_RE =
  /^To send an image back,[\s\S]*?Keep caption in the text body\.\s*/
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

  result = result.replace(MEDIA_ATTACHMENT_MARKER_RE, "\n")

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
    .replace(ATTACHED_FILE_MARKER_RE, "")
    .trim()
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readAttachmentMimeType(raw: Record<string, unknown>): string | undefined {
  return stringValue(raw.mimeType) ?? stringValue(raw.mime_type) ?? stringValue(raw.mediaType) ?? stringValue(raw.contentType)
}

function readAttachmentName(raw: Record<string, unknown>, index: number): string {
  return stringValue(raw.name) ?? stringValue(raw.fileName) ?? stringValue(raw.filename) ?? stringValue(raw.mediaId) ?? stringValue(raw.media_id) ?? `attachment-${index + 1}`
}

function readAttachmentContent(raw: Record<string, unknown>): string | undefined {
  const direct = stringValue(raw.content) ?? stringValue(raw.data) ?? stringValue(raw.base64)
  if (!direct) return undefined
  const dataUrl = direct.match(/^data:([^;,]+);base64,(.+)$/i)
  return dataUrl ? dataUrl[2] : direct
}

function readInboundMediaId(raw: Record<string, unknown>): string | undefined {
  return stringValue(raw.mediaId) ?? stringValue(raw.media_id) ?? stringValue(raw.id)
}

function mediaIdFromUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith("media://inbound/")) return undefined
  return trimmed.slice("media://inbound/".length)
}

function resolveAttachmentUrl(rawUrl: string | undefined, mediaId: string | undefined): string | undefined {
  const urlMediaId = rawUrl ? mediaIdFromUrl(rawUrl) : undefined
  const inboundId = urlMediaId ?? mediaId
  if (inboundId) return buildInboundMediaUrl(inboundId) ?? rawUrl
  return rawUrl
}

function basename(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  const name = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? value
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function readAttachmentSize(raw: Record<string, unknown>): number | undefined {
  return numberValue(raw.size) ?? numberValue(raw.bytes) ?? numberValue(raw.byteLength)
}

function mimeTypeFromAttachmentMarker(kind: string, name: string) {
  const lowerName = name.toLowerCase()
  if (kind.startsWith("image") || /\.(png|jpe?g|webp|gif|svg)$/.test(lowerName)) {
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg"
    if (lowerName.endsWith(".webp")) return "image/webp"
    if (lowerName.endsWith(".gif")) return "image/gif"
    if (lowerName.endsWith(".svg")) return "image/svg+xml"
    return "image/png"
  }
  if (kind.startsWith("audio")) {
    if (lowerName.endsWith(".wav")) return "audio/wav"
    if (lowerName.endsWith(".ogg")) return "audio/ogg"
    if (lowerName.endsWith(".m4a")) return "audio/mp4"
    return "audio/mpeg"
  }
  if (lowerName.endsWith(".pdf")) return "application/pdf"
  return "application/octet-stream"
}

function readAttachmentMarkerAttachments(text: string): ChatMessage["attachments"] {
  const attachments: NonNullable<ChatMessage["attachments"]> = []
  for (const match of text.matchAll(ATTACHED_FILE_MARKER_CAPTURE_RE)) {
    const kind = match[1]?.toLowerCase() ?? "file"
    const name = (match[2] ?? "").trim()
    if (!name) continue
    attachments.push({
      name,
      mimeType: mimeTypeFromAttachmentMarker(kind, name),
    })
  }
  return attachments.length > 0 ? attachments : undefined
}

function readMediaAttachmentMarkerAttachments(text: string): ChatMessage["attachments"] {
  const attachments: NonNullable<ChatMessage["attachments"]> = []
  for (const match of text.matchAll(MEDIA_ATTACHMENT_MARKER_CAPTURE_RE)) {
    const marker = (match[1] ?? "").trim()
    if (!marker) continue
    const mimeType = marker.match(/\(([^()\s]+\/[^()\s]+)\)/)?.[1]
    const primaryRef = marker.split("|")[0]?.replace(/\s*\([^)]*\)\s*$/, "").trim()
    if (!primaryRef) continue
    const mediaId = mediaIdFromUrl(primaryRef)
    if (!mediaId) continue
    const url = resolveAttachmentUrl(primaryRef, mediaId)
    attachments.push({
      name: basename(mediaId ?? primaryRef),
      mimeType: mimeType ?? mimeTypeFromAttachmentMarker("file", mediaId ?? primaryRef),
      url,
    })
  }
  return attachments.length > 0 ? attachments : undefined
}

function readContentBlockAttachments(content: RawHistoryMessage["content"]): ChatMessage["attachments"] {
  if (!Array.isArray(content)) return undefined
  const attachments: NonNullable<ChatMessage["attachments"]> = []
  content.forEach((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return
    const raw = block as Record<string, unknown>
    const type = stringValue(raw.type)?.toLowerCase()
    if (type !== "image" && type !== "input_image" && type !== "attachment") return
    const source = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source)
      ? raw.source as Record<string, unknown>
      : raw
    const mimeType = readAttachmentMimeType(raw) ?? readAttachmentMimeType(source) ?? (type === "image" || type === "input_image" ? "image/png" : undefined)
    if (!mimeType) return
    const content = readAttachmentContent(source) ?? readAttachmentContent(raw)
    const mediaId = readInboundMediaId(source) ?? readInboundMediaId(raw)
    const url = resolveAttachmentUrl(stringValue(source.url) ?? stringValue(raw.url), mediaId)
    if (!content && !url && !mediaId) return
    attachments.push({
      name: readAttachmentName(raw, index) ?? mediaId ?? `attachment-${index + 1}`,
      mimeType,
      content,
      url,
      size: readAttachmentSize(raw) ?? readAttachmentSize(source),
    })
  })
  return attachments.length > 0 ? attachments : undefined
}

function readMessageAttachments(raw: RawHistoryMessage): ChatMessage["attachments"] {
  const fromTopLevel: NonNullable<ChatMessage["attachments"]> = []
  if (Array.isArray(raw.attachments)) {
    raw.attachments.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return
      const attachment = item as Record<string, unknown>
      const mimeType = readAttachmentMimeType(attachment) ?? (stringValue(attachment.type) === "image" ? "image/png" : undefined)
      if (!mimeType) return
      const content = readAttachmentContent(attachment)
      const mediaId = readInboundMediaId(attachment)
      const url = resolveAttachmentUrl(stringValue(attachment.url), mediaId)
      if (!content && !url && !mediaId) return
      fromTopLevel.push({
        name: readAttachmentName(attachment, index) ?? mediaId ?? `attachment-${index + 1}`,
        mimeType,
        content,
        url,
        size: readAttachmentSize(attachment),
      })
    })
  }

  const fromContent = readContentBlockAttachments(raw.content) ?? []
  const markerText = raw.text || extractText(raw.content)
  const fromMarkers = [
    ...(readAttachmentMarkerAttachments(markerText) ?? []),
    ...(readMediaAttachmentMarkerAttachments(markerText) ?? []),
  ]
    .filter((marker) =>
      ![...fromTopLevel, ...fromContent].some(
        (attachment) =>
          (attachment.name === marker.name && attachment.mimeType === marker.mimeType) ||
          (Boolean(attachment.url) && attachment.url === marker.url)
      )
    )
  const all = [...fromTopLevel, ...fromContent, ...fromMarkers]
  return all.length > 0 ? all : undefined
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

function rawMessageIdentity(raw: RawHistoryMessage): string | null {
  const seq = openclawSeq(raw)
  if (typeof seq === "number") return `seq:${seq}`
  const id = raw.__openclaw?.id ?? raw.id ?? raw.messageId
  return typeof id === "string" && id.trim() ? `id:${id}` : null
}

export function deduplicateRawMessages(
  raw: RawHistoryMessage[]
): RawHistoryMessage[] {
  const result: RawHistoryMessage[] = []
  for (const item of raw) {
    if (isAbortedGatewayArtifact(item)) continue
    const currText = visibleMessageText(item).trim()
    if (item.role === "assistant" && !currText && !toolBlocks(item).length && !thinkingText(item).trim()) {
      continue
    }

    const prev = result[result.length - 1]
    if (prev && prev.role === item.role) {
      const prevText = prev.text || extractText(prev.content)
      const prevIdentity = rawMessageIdentity(prev)
      const currIdentity = rawMessageIdentity(item)
      if (
        prevIdentity &&
        currIdentity &&
        prevIdentity === currIdentity &&
        prevText.trim() &&
        prevText.trim() === currText
      ) {
        continue
      }
    }
    result.push(item)
  }
  return result
}

export function parseChatHistory(raw: RawHistoryMessage[]): ParsedChatHistory {
  const deduped = deduplicateRawMessages(raw)
  const gatewayOrderBase = inferGatewayOrderBase(deduped)
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
  let assistantMergeBlockedByUserBoundary = false

  for (const item of deduped) {
    const role = item.role

    if (role === "user") {
      const rawText = item.text || extractText(item.content)
      const text = rawText ? cleanUserMessageText(rawText) : ""
      const attachments = readMessageAttachments(item)
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
      if (text || (attachments && attachments.length > 0)) {
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
          gatewayIndex: messageOrderSeq(item, gatewayOrderBase),
          runId: messageRunId(item),
          attachments,
        })
      }
      // Even if the Gateway/user echo has no visible text, it is still a turn
      // boundary. Without this, the next assistant/tool message is merged into
      // the previous assistant card, making tools from later questions appear
      // above/inside older answers.
      assistantMergeBlockedByUserBoundary = true
      pendingToolCalls = []
      resultQueue = []
      pendingToolById.clear()
      continue
    }

    if (role === "assistant") {
      for (const block of toolBlocks(item)) {
        const durationMs = blockDurationMs(block)
        const startedAt = rawTimestampMs(item) ?? realTimestampMs(block.startedAtMs) ?? undefined
        const finishedAt = realTimestampMs(block.finishedAtMs)
        const resultText = toolBlockResultText(block)
        const fallbackDurationMs =
          typeof startedAt === "number" && typeof finishedAt === "number"
            ? finishedAt - startedAt
            : null
        const call: InlineToolCall & { startedAtMs?: number | null } = {
          id: toolBlockId(block) ?? randomId(),
          tool: toolBlockName(block) ?? "unknown",
          status: inferToolBlockStatus(block),
          input: toolBlockInput(block),
          duration: formatDuration(durationMs ?? fallbackDurationMs ?? -1),
          startedAt,
          completedAt: finishedAt,
          startedAtMs: startedAt,
          resultText,
        }
        pendingToolCalls.push(call)
        resultQueue.push(call)
        pendingToolById.set(call.id, call)

        if (toolBlockName(block) === "sessions_spawn") {
          const args = (toolBlockInput(block) ?? {}) as Record<string, unknown>
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
      const reasoningText = thinkingText(item).trim()
      if (text || pendingToolCalls.length > 0 || reasoningText) {
        const last = messages.at(-1)
        if (last?.role === "assistant" && !assistantMergeBlockedByUserBoundary) {
          if (text) last.text = mergeAssistantText(last.text, text)
          last.toolCalls = [...(last.toolCalls ?? []), ...pendingToolCalls]
          if (reasoningText) last.reasoningText = last.reasoningText ? `${last.reasoningText}${reasoningText}` : reasoningText
          last.messageId = messageId(item)
          last.createdAt = createdAtIso(item) ?? last.createdAt
          last.model = item.model ?? last.model
          last.usage = item.usage ?? last.usage
          last.stopReason = item.stopReason ?? last.stopReason
          last.gatewayIndex = messageOrderSeq(item, gatewayOrderBase) ?? last.gatewayIndex
          last.runId = messageRunId(item) ?? last.runId
        } else {
          messages.push({
            messageId: messageId(item),
            role: "assistant",
            text,
            createdAt: createdAtIso(item),
            model: item.model,
            usage: item.usage,
            stopReason: item.stopReason,
            reasoningText: reasoningText || undefined,
            toolCalls:
              pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
            gatewayIndex: messageOrderSeq(item, gatewayOrderBase),
            runId: messageRunId(item),
          })
        }
        assistantMergeBlockedByUserBoundary = false
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
      const finishedAt = rawTimestampMs(item)
      matched.completedAt = finishedAt ?? matched.completedAt
      const preciseDurationMs = toolResultDurationMs(item, resultText)
      const fallbackDurationMs =
        finishedAt !== null &&
        matched.startedAtMs !== null &&
        matched.startedAtMs !== undefined
          ? finishedAt - matched.startedAtMs
          : null
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
              : "completed"
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
