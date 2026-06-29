import type { ChatMessage } from "./types"

function timestampOf(message: ChatMessage): number {
  if (!message.createdAt) return Number.POSITIVE_INFINITY
  const value = Date.parse(message.createdAt)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function isSlashCommandUserMessage(message: ChatMessage) {
  return message.role === "user" && message.text.trimStart().startsWith("/")
}

function isGatewayInjectedCommandOutput(message: ChatMessage) {
  return message.role === "assistant" && message.model === "gateway-injected"
}

function keepCommandOutputAfterSlashUser(messages: ChatMessage[]) {
  const ordered = [...messages]
  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index]
      const next = ordered[index + 1]
      if (isGatewayInjectedCommandOutput(current) && isSlashCommandUserMessage(next)) {
        ordered[index] = next
        ordered[index + 1] = current
        changed = true
      }
    }
  }
  return ordered
}

export function orderChatMessages(messages: ChatMessage[]) {
  const sorted = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aSeq = a.message.gatewayIndex
      const bSeq = b.message.gatewayIndex
      if (a.message.isOptimistic || b.message.isOptimistic) return a.index - b.index
      if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) return aSeq - bSeq
      if (typeof aSeq === "number" && typeof bSeq !== "number") return a.index - b.index
      if (typeof aSeq !== "number" && typeof bSeq === "number") return a.index - b.index
      const timeDelta = timestampOf(a.message) - timestampOf(b.message)
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta
      return a.index - b.index
    })
    .map(({ message }) => message)
  return keepCommandOutputAfterSlashUser(sorted)
}
