import type { ChatMessage, InlineToolCall } from "./types"

export type StableChatMessage = ChatMessage & { uiId: string }

function hashString(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function attachmentFingerprint(message: ChatMessage) {
  return (message.attachments ?? [])
    .map((attachment) => `${attachment.name}:${attachment.mimeType}:${attachment.size ?? ""}`)
    .join("|")
}

function textFingerprint(message: ChatMessage) {
  return hashString(`${message.text.trim()}\n${attachmentFingerprint(message)}`)
}

function stableMessageBaseId(message: ChatMessage, fallbackOrdinal: number) {
  const optimistic = message.optimisticMessageId?.trim()
  if (message.role === "user" && optimistic) return optimistic
  const explicit = message.messageId?.trim()
  if (explicit) return explicit
  const seq = typeof message.gatewayIndex === "number" && Number.isFinite(message.gatewayIndex)
    ? `seq:${message.gatewayIndex}`
    : null
  if (seq) return seq
  return `fallback:${fallbackOrdinal}:${textFingerprint(message)}`
}

function stableAssistantBaseId(message: ChatMessage, fallbackOrdinal: number) {
  const runId = message.runId?.trim()
  if (runId) return `run:${runId}`
  return stableMessageBaseId(message, fallbackOrdinal)
}

function mergeText(existing: string, incoming: string) {
  if (!existing.trim()) return incoming
  if (!incoming.trim()) return existing
  if (incoming.startsWith(existing)) return incoming
  if (existing.includes(incoming)) return existing
  return `${existing}\n\n${incoming}`
}

function mergeTools(existing?: InlineToolCall[], incoming?: InlineToolCall[]) {
  const merged = new Map<string, InlineToolCall>()
  for (const tool of [...(existing ?? []), ...(incoming ?? [])]) {
    const current = merged.get(tool.id)
    if (!current) {
      merged.set(tool.id, tool)
      continue
    }
    const currentTerminal = current.status === "success" || current.status === "error"
    const staleRunningIncoming = currentTerminal && tool.status === "running"
    merged.set(tool.id, staleRunningIncoming
      ? {
          ...tool,
          ...current,
          duration: current.duration ?? tool.duration,
          startedAt: current.startedAt ?? tool.startedAt,
          completedAt: current.completedAt ?? tool.completedAt,
          resultText: current.resultText ?? tool.resultText,
          awaitingResult: false,
        }
      : { ...current, ...tool }
    )
  }
  return Array.from(merged.values())
}

function mergeAssistantTurn(existing: StableChatMessage, incoming: ChatMessage): StableChatMessage {
  return {
    ...existing,
    ...incoming,
    uiId: existing.uiId,
    messageId: existing.messageId,
    text: mergeText(existing.text, incoming.text),
    reasoningText: mergeText(existing.reasoningText ?? "", incoming.reasoningText ?? "") || undefined,
    toolCalls: mergeTools(existing.toolCalls, incoming.toolCalls),
    embeds: [...(existing.embeds ?? []), ...(incoming.embeds ?? [])],
    attachments: [...(existing.attachments ?? []), ...(incoming.attachments ?? [])],
    animateText: Boolean(existing.animateText || incoming.animateText),
  }
}

function assistantRowsAreSameTurn(existing: StableChatMessage, incoming: ChatMessage) {
  if (existing.messageId === incoming.messageId) return true

  const existingRunId = existing.runId?.trim()
  const incomingRunId = incoming.runId?.trim()
  if (existingRunId && incomingRunId) return existingRunId === incomingRunId

  const existingHasText = Boolean(existing.text.trim())
  const incomingHasText = Boolean(incoming.text.trim())
  // Tool-only/thinking-only assistant rows are fragments of the nearest visible
  // assistant answer. Two text-bearing assistant rows are complete answers; do
  // not merge them just because a user separator is missing or the timeline is
  // temporarily out of order. That was the source of old answers absorbing later
  // tool cards/final text into one giant assistant bubble.
  if (existingHasText && incomingHasText) return false

  if (
    typeof existing.gatewayIndex === "number" &&
    typeof incoming.gatewayIndex === "number" &&
    existing.gatewayIndex !== incoming.gatewayIndex
  ) {
    return false
  }

  return true
}

type StableRowsOptions = {
  coalesceAssistantTurns?: boolean
}

export function buildStableChatRows(
  messages: readonly ChatMessage[],
  options: StableRowsOptions = {}
): StableChatMessage[] {
  const out: StableChatMessage[] = []
  let activeAssistant: StableChatMessage | null = null
  let assistantOrdinalInTurn = 0
  let fallbackOrdinal = 0

  const flushAssistant = () => {
    if (!activeAssistant) return
    out.push(activeAssistant)
    activeAssistant = null
  }

  for (const message of messages) {
    if (message.role === "user") {
      flushAssistant()
      assistantOrdinalInTurn = 0
      const uiId = `message:${stableMessageBaseId(message, fallbackOrdinal++)}`
      out.push({ ...message, uiId })
      continue
    }

    const assistantBaseId = stableAssistantBaseId(message, fallbackOrdinal++)
    const assistantUiId = `message:${assistantBaseId}:assistant:${options.coalesceAssistantTurns ? "turn" : assistantOrdinalInTurn}`

    if (options.coalesceAssistantTurns) {
      if (activeAssistant && assistantRowsAreSameTurn(activeAssistant, message)) {
        activeAssistant = mergeAssistantTurn(activeAssistant, message)
      } else {
        flushAssistant()
        activeAssistant = { ...message, uiId: assistantUiId }
      }
    } else {
      out.push({ ...message, uiId: assistantUiId })
      assistantOrdinalInTurn += 1
    }
  }

  flushAssistant()
  return out
}
