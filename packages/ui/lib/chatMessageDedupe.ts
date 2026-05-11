import type { ChatMessage } from "../components/ChatView/types"

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  if (a.text.trim() !== b.text.trim()) return false
  // When returning to a session, the optimistic local user message may have a
  // slightly different timestamp than the persisted history copy. Treat it as
  // the same message so it does not get appended after the assistant response.
  if (a.isOptimistic || b.isOptimistic) return true
  if (a.createdAt && b.createdAt) return a.createdAt === b.createdAt
  return false
}

export function sameAssistantMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "assistant" || b.role !== "assistant") return false
  const aText = a.text.trim()
  const bText = b.text.trim()
  if (!aText || !bText) return false
  if (a.messageId === b.messageId) return true
  if (aText === bText) return true
  return aText.startsWith(bText) || bText.startsWith(aText)
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
