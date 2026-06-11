import type { ChatMessage } from "@/components/ChatView/types"

export type ChatTimelineRowKind = "message" | "system" | "spacer"
export type ChatHeavyState = "mounted" | "collapsed" | "unloaded"

export type ChatTimelineRow = {
  rowId: string
  rowKind: ChatTimelineRowKind
  messageId: string | null
  openclawSeq: number | null
  role: ChatMessage["role"] | null
  message: ChatMessage | null
  heightEstimate: number
  heightVersion: number
  heavyState: ChatHeavyState
  mutationVersion: number
}

const DEFAULT_USER_HEIGHT = 92
const DEFAULT_ASSISTANT_HEIGHT = 132
const TOOL_HEIGHT = 96
const ATTACHMENT_HEIGHT = 140
const REASONING_HEIGHT = 80

function signatureVersion(parts: Array<string | number | boolean | null | undefined>): number {
  const signature = parts.map((part) => String(part ?? "")).join("\u0000")
  let hash = 0
  for (let index = 0; index < signature.length; index += 1) {
    hash = ((hash * 31) + signature.charCodeAt(index)) >>> 0
  }
  return hash
}

export function chatMessageSeq(message: ChatMessage): number | null {
  return typeof message.gatewayIndex === "number" && Number.isFinite(message.gatewayIndex)
    ? message.gatewayIndex
    : null
}

export function chatTimelineRowId(message: ChatMessage): string {
  const seq = chatMessageSeq(message)
  if (seq !== null) return `seq:${seq}`
  if (message.messageId) return `message:${message.messageId}`
  return `role:${message.role}:text:${message.text.slice(0, 64)}`
}

export function estimateChatRowHeight(message: ChatMessage): number {
  const base = message.role === "user" ? DEFAULT_USER_HEIGHT : DEFAULT_ASSISTANT_HEIGHT
  const textLines = Math.max(1, Math.ceil((message.text?.length ?? 0) / 90))
  const toolExtra = (message.toolCalls?.length ?? 0) * TOOL_HEIGHT
  const attachmentExtra = (message.attachments?.length ?? 0) * ATTACHMENT_HEIGHT
  const reasoningExtra = message.reasoningText ? REASONING_HEIGHT : 0
  return base + Math.max(0, textLines - 1) * 22 + toolExtra + attachmentExtra + reasoningExtra
}

export function chatRowHeightVersion(message: ChatMessage): number {
  return signatureVersion([
    message.text?.length ?? 0,
    message.reasoningText?.length ?? 0,
    message.toolCalls?.length ?? 0,
    message.attachments?.length ?? 0,
    message.stopReason ?? "",
    message.sendStatus ?? "",
  ])
}

export function chatRowMutationVersion(message: ChatMessage): number {
  const toolSignature = (message.toolCalls ?? [])
    .map((tool) => `${tool.id}:${tool.status}:${tool.awaitingResult ? 1 : 0}:${tool.resultText?.length ?? 0}`)
    .join("|")
  return signatureVersion([
    message.messageId,
    message.role,
    message.text?.length ?? 0,
    message.reasoningText?.length ?? 0,
    toolSignature,
    message.isOptimistic ? 1 : 0,
    message.sendStatus ?? "",
  ])
}

export function toChatTimelineRow(message: ChatMessage, existing?: ChatTimelineRow): ChatTimelineRow {
  const heightVersion = chatRowHeightVersion(message)
  const mutationVersion = chatRowMutationVersion(message)
  return {
    rowId: existing?.rowId ?? chatTimelineRowId(message),
    rowKind: "message",
    messageId: message.messageId,
    openclawSeq: chatMessageSeq(message),
    role: message.role,
    message,
    heightEstimate: existing && existing.heightVersion === heightVersion
      ? existing.heightEstimate
      : estimateChatRowHeight(message),
    heightVersion,
    heavyState: existing?.heavyState ?? "mounted",
    mutationVersion,
  }
}

export function buildChatTimelineRows(messages: ChatMessage[], existingRows: ChatTimelineRow[] = []): ChatTimelineRow[] {
  const existingByRowId = new Map(existingRows.map((row) => [row.rowId, row]))
  return messages.map((message) => toChatTimelineRow(message, existingByRowId.get(chatTimelineRowId(message))))
}
