import type { ChatMessage, StreamStatus } from "../components/ChatView/types"

export function inferRestoredChatStatus(
  messages: ChatMessage[] | undefined | null,
  cachedStatus: StreamStatus | null,
): StreamStatus {
  if (cachedStatus && cachedStatus !== "idle" && cachedStatus !== "connected") {
    return cachedStatus
  }

  const last = messages?.[messages.length - 1]
  if (last?.role === "assistant" && last.text.trim().length > 0) return "done"
  return cachedStatus ?? "idle"
}
