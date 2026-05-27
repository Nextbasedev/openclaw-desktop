import type { ChatMessage, InlineToolCall } from "../types"

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

function userFingerprint(message: ChatMessage) {
  const text = message.text.trim()
  const attachments = attachmentFingerprint(message)
  return hashString(`${text}\n${attachments}`)
}

function nextOccurrence(counts: Map<string, number>, key: string) {
  const next = (counts.get(key) ?? 0) + 1
  counts.set(key, next)
  return next
}

function stableUserId(message: ChatMessage, counts: Map<string, number>) {
  const fingerprint = userFingerprint(message)
  const occurrence = nextOccurrence(counts, fingerprint)
  return occurrence === 1 ? `user:${fingerprint}` : `user:${fingerprint}:${occurrence}`
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

function assistantFallbackId(message: ChatMessage, counts: Map<string, number>) {
  const fingerprint = hashString(`${message.createdAt ?? ""}:${message.text.trim()}:${message.messageId}`)
  const occurrence = nextOccurrence(counts, fingerprint)
  return occurrence === 1 ? `assistant:${fingerprint}` : `assistant:${fingerprint}:${occurrence}`
}

export function buildStableVercelTimeline(messages: readonly ChatMessage[]) {
  const out: StableChatMessage[] = []
  const userCounts = new Map<string, number>()
  const assistantCounts = new Map<string, number>()
  let lastUserUiId: string | null = null
  let activeAssistant: StableChatMessage | null = null

  const flushAssistant = () => {
    if (!activeAssistant) return
    out.push(activeAssistant)
    activeAssistant = null
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      const assistantUiId = lastUserUiId
        ? `${lastUserUiId}:assistant`
        : assistantFallbackId(message, assistantCounts)
      activeAssistant = activeAssistant
        ? mergeAssistantTurn(activeAssistant, message)
        : { ...message, uiId: assistantUiId }
      continue
    }

    flushAssistant()
    const uiId = stableUserId(message, userCounts)
    lastUserUiId = uiId
    out.push({ ...message, uiId })
  }

  flushAssistant()
  return out
}
