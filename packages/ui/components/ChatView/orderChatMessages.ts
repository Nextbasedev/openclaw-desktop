import type { ChatMessage } from "./types"

// Single ordering rule: render in creation order using the monotonic gateway/
// openclaw seq, which is the only field that reliably encodes arrival order on
// BOTH the websocket stream and persisted history. Raw createdAt/timestamp are
// heterogeneous (user = client send time, assistant = model/exec time which can
// predate the user's send) and were the source of order drift, so they are not
// used. Messages without a seq yet (just-sent optimistic, live-streaming) keep
// their insertion order, which pins them to the tail until their seq arrives.
export function orderChatMessages(messages: ChatMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aSeq = a.message.gatewayIndex
      const bSeq = b.message.gatewayIndex
      if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) return aSeq - bSeq
      return a.index - b.index
    })
    .map(({ message }) => message)
}
