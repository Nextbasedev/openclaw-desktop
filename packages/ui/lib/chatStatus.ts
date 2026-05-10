import type { ChatMessage, StreamStatus } from "../components/ChatView/types"

type BackendSessionStatus = string | null | undefined

function hasCompletedAssistantMessage(messages: ChatMessage[] | undefined | null) {
  const last = messages?.[messages.length - 1]
  return last?.role === "assistant" && last.text.trim().length > 0
}

export function statusFromBackendSession(
  backendStatus: BackendSessionStatus,
  messages: ChatMessage[] | undefined | null,
): StreamStatus {
  switch (backendStatus) {
    case "running":
    case "queued":
    case "starting":
      return "thinking"
    case "error":
    case "failed":
      return "error"
    case "idle":
    case "done":
    case "completed":
      return hasCompletedAssistantMessage(messages) ? "done" : "idle"
    default:
      return hasCompletedAssistantMessage(messages) ? "done" : "idle"
  }
}

export function inferRestoredChatStatus(
  messages: ChatMessage[] | undefined | null,
  cachedStatus: StreamStatus | null,
): StreamStatus {
  if (
    cachedStatus &&
    !["idle", "connected", "thinking", "running", "queued"].includes(cachedStatus)
  ) {
    return cachedStatus
  }

  return statusFromBackendSession(null, messages)
}

export function statusAfterSendAck(
  messages: ChatMessage[] | undefined | null,
  currentStatus: StreamStatus | null,
): StreamStatus | null {
  const restoredStatus = inferRestoredChatStatus(messages, currentStatus)
  return restoredStatus === "done" || restoredStatus === "error" ? restoredStatus : null
}
