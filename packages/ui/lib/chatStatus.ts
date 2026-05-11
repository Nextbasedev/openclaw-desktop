import type { ChatMessage, StreamStatus } from "../components/ChatView/types"

type BackendSessionStatus = string | null | undefined

function hasRunningTool(message: ChatMessage) {
  return Boolean(message.toolCalls?.some((tool) => tool.status === "running"))
}

function hasCompletedAssistantAfterLatestUser(messages: ChatMessage[] | undefined | null) {
  if (!messages?.length) return false
  let latestUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i
      break
    }
  }
  const searchFrom = latestUserIndex >= 0 ? latestUserIndex + 1 : 0
  for (let i = messages.length - 1; i >= searchFrom; i--) {
    const message = messages[i]
    if (message?.role !== "assistant") continue
    if (hasRunningTool(message)) return false
    if (message.text.trim().length > 0) return true
  }
  return false
}

export function statusFromBackendSession(
  backendStatus: BackendSessionStatus,
  messages: ChatMessage[] | undefined | null,
): StreamStatus {
  switch (backendStatus) {
    case "running":
    case "queued":
    case "starting":
      return hasCompletedAssistantAfterLatestUser(messages) ? "done" : "thinking"
    case "error":
    case "failed":
      return "error"
    case "idle":
    case "done":
    case "completed":
      return hasCompletedAssistantAfterLatestUser(messages) ? "done" : "idle"
    default:
      return hasCompletedAssistantAfterLatestUser(messages) ? "done" : "idle"
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
