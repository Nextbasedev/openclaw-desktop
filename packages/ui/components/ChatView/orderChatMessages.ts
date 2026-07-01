import type { ChatMessage } from "./types"

function createdAtMs(message: ChatMessage): number | null {
  if (!message.createdAt) return null
  const value = Date.parse(message.createdAt)
  return Number.isFinite(value) ? value : null
}

// Render chronologically by createdAt where available, with gateway/openclaw seq
// as the deterministic tie-breaker. If timestamps are absent or equal, preserve
// insertion order so optimistic/live rows do not jump while streaming.
export function orderChatMessages(messages: ChatMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aTime = createdAtMs(a.message)
      const bTime = createdAtMs(b.message)
      if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime

      const aSeq = a.message.gatewayIndex
      const bSeq = b.message.gatewayIndex
      if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) return aSeq - bSeq

      return a.index - b.index
    })
    .map(({ message }) => message)
}
