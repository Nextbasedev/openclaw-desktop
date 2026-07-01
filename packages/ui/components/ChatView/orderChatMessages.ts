import type { ChatMessage } from "./types"
import { sortChatMessagesByTimeline } from "@/lib/chatMessageDedupe"

// Single ordering rule for the whole app: chronological by the backend's
// monotonic gateway/openclaw seq (gatewayIndex), which is the ONLY field that
// reliably encodes arrival order on both the websocket stream and persisted
// history. createdAt is used only as a fallback when seq is absent, because
// assistant timestamps are model/exec time and can predate the user's client
// send time — sorting by createdAt first inverts user/assistant rows and makes
// the just-sent message appear to jump above the answer. Optimistic/live rows
// without a seq keep their insertion order so they stay pinned to the tail
// until their seq arrives.
//
// This delegates to the same comparator dedupeChatMessages() uses internally so
// the two sort passes (reducer + render) can never disagree and flip rows.
export function orderChatMessages(messages: ChatMessage[]) {
  return sortChatMessagesByTimeline(messages)
}
