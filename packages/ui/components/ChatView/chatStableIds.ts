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

function reverseOccurrenceKeys(messages: readonly ChatMessage[]) {
  const counts = new Map<string, number>()
  const keys = new Map<ChatMessage, string>()

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "user") continue
    const fingerprint = textFingerprint(message)
    const occurrenceFromEnd = (counts.get(fingerprint) ?? 0) + 1
    counts.set(fingerprint, occurrenceFromEnd)
    keys.set(
      message,
      occurrenceFromEnd === 1
        ? `user:${fingerprint}`
        : `user:${fingerprint}:from-end-${occurrenceFromEnd}`
    )
  }

  return keys
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
    merged.set(tool.id, current ? { ...current, ...tool } : tool)
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

type StableRowsOptions = {
  coalesceAssistantTurns?: boolean
}

export function buildStableChatRows(
  messages: readonly ChatMessage[],
  options: StableRowsOptions = {}
): StableChatMessage[] {
  const out: StableChatMessage[] = []
  const userKeys = reverseOccurrenceKeys(messages)
  let lastUserUiId: string | null = null
  let activeAssistant: StableChatMessage | null = null
  let assistantOrdinalInTurn = 0

  const flushAssistant = () => {
    if (!activeAssistant) return
    out.push(activeAssistant)
    activeAssistant = null
  }

  for (const message of messages) {
    if (message.role === "user") {
      flushAssistant()
      assistantOrdinalInTurn = 0
      const uiId = userKeys.get(message) ?? `user:${textFingerprint(message)}`
      lastUserUiId = uiId
      out.push({ ...message, uiId })
      continue
    }

    const assistantUiId = lastUserUiId
      ? `${lastUserUiId}:assistant:${options.coalesceAssistantTurns ? "turn" : assistantOrdinalInTurn}`
      : `assistant:${textFingerprint(message)}:${message.gatewayIndex ?? message.messageId}`

    if (options.coalesceAssistantTurns) {
      activeAssistant = activeAssistant
        ? mergeAssistantTurn(activeAssistant, message)
        : { ...message, uiId: assistantUiId }
    } else {
      out.push({ ...message, uiId: assistantUiId })
      assistantOrdinalInTurn += 1
    }
  }

  flushAssistant()
  return out
}
