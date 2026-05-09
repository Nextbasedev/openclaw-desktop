import type { ChatMessage } from "../components/ChatView/types"

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  if (a.text.trim() !== b.text.trim()) return false
  if (a.createdAt && b.createdAt) {
    if (a.createdAt === b.createdAt) return true
    if (a.isOptimistic || b.isOptimistic) {
      const aTime = Date.parse(a.createdAt)
      const bTime = Date.parse(b.createdAt)
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return Math.abs(aTime - bTime) <= 5 * 60 * 1000
      }
    }
    return false
  }
  return Boolean(a.isOptimistic || b.isOptimistic)
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

function messageSignature(message: ChatMessage) {
  return `${message.role}:${message.text.trim().replace(/\s+/g, " ")}`
}

function collapseRepeatedBlocks(messages: ChatMessage[]) {
  const result = [...messages]
  let changed = true

  while (changed) {
    changed = false
    for (let size = Math.floor(result.length / 2); size >= 3; size--) {
      for (let start = 0; start + size * 2 <= result.length; start++) {
        let same = true
        for (let offset = 0; offset < size; offset++) {
          if (
            messageSignature(result[start + offset]) !==
            messageSignature(result[start + size + offset])
          ) {
            same = false
            break
          }
        }
        if (same) {
          result.splice(start + size, size)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }

  return result
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of collapseRepeatedBlocks(messages)) {
    if (seenIds.has(message.messageId)) continue

    const assistantIndex = result.findIndex((existing) =>
      sameAssistantMessage(existing, message)
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
      sameUserMessage(existing, message)
    )
    if (duplicateUser) continue

    seenIds.add(message.messageId)
    result.push(message)
  }

  return collapseRepeatedBlocks(result)
}
