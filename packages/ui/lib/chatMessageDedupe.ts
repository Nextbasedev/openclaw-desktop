import type { ChatMessage } from "../components/ChatView/types"

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  if (a.text.trim() !== b.text.trim()) return false
  if (a.createdAt && b.createdAt) return a.createdAt === b.createdAt
  return Boolean(a.isOptimistic || b.isOptimistic)
}

export function mergeAssistantTextIfSameTurn(existing: string, incoming: string): string | null {
  const current = existing.trim()
  const next = incoming.trim()
  if (!current) return next || null
  if (!next) return current
  if (current === next) return current
  if (next.startsWith(current)) return next
  if (current.startsWith(next)) return current
  return null
}

export function sameAssistantMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "assistant" || b.role !== "assistant") return false
  const aText = a.text.trim()
  const bText = b.text.trim()
  if (!aText || !bText) return false
  if (a.messageId === b.messageId) return true
  return mergeAssistantTextIfSameTurn(aText, bText) !== null
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of messages) {
    if (seenIds.has(message.messageId)) continue

    const assistantIndex = result.findIndex((existing) =>
      sameAssistantMessage(existing, message),
    )
    if (assistantIndex >= 0) {
      const existing = result[assistantIndex]
      const preferred =
        message.text.trim().length >= existing.text.trim().length
          ? message
          : existing
      result[assistantIndex] = {
        ...existing,
        ...preferred,
        createdAt: existing.createdAt || preferred.createdAt,
        embeds: preferred.embeds ?? existing.embeds,
        usage: preferred.usage ?? existing.usage,
        stopReason: preferred.stopReason ?? existing.stopReason,
        model: preferred.model ?? existing.model,
      }
      seenIds.add(message.messageId)
      continue
    }

    const duplicateUser = result.some((existing) =>
      sameUserMessage(existing, message),
    )
    if (duplicateUser) continue

    seenIds.add(message.messageId)
    result.push(message)
  }

  return result
}
