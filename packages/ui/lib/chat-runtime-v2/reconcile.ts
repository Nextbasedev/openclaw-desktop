import type { ChatMessage, StreamStatus } from "@/components/ChatView/types"
import { dedupeChatMessages, sameUserMessage } from "@/lib/chatMessageDedupe"
import { cleanUserMessageText } from "@/lib/chatHistoryParser"
import { isActiveRunStatus } from "./initialSnapshot"

export function hasAssistantAnswerAfterLatestUserMessage(messages: ChatMessage[]) {
  let latestUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex < 0) {
    return messages.some(
      (message) => message.role === "assistant" && message.text.trim().length > 0,
    )
  }
  for (let i = latestUserIndex + 1; i < messages.length; i++) {
    const message = messages[i]
    if (message?.role === "assistant" && message.text.trim().length > 0) return true
  }
  return false
}

function sameUserTextAndAttachments(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  const aText = cleanUserMessageText(a.text).replace(/\s+/g, " ").trim()
  const bText = cleanUserMessageText(b.text).replace(/\s+/g, " ").trim()
  if (!aText || aText !== bText) return false
  const aAttachments = (a.attachments ?? []).map((item) => item.name).sort().join("|")
  const bAttachments = (b.attachments ?? []).map((item) => item.name).sort().join("|")
  return aAttachments === bAttachments
}

export function mergeOptimisticMessagesWithCanonical(
  canonicalMessages: ChatMessage[],
  optimisticSource: ChatMessage[] | null | undefined,
) {
  if (!optimisticSource?.length) return canonicalMessages
  const keptOptimistic = optimisticSource.filter(
    (message) =>
      message.isOptimistic &&
      !canonicalMessages.some(
        (canonical) =>
          canonical.messageId === message.messageId ||
          (message.role === "user" && canonical.role === "user" && (
            sameUserMessage(canonical, message) || sameUserTextAndAttachments(canonical, message)
          )),
      ),
  )
  return keptOptimistic.length
    ? dedupeChatMessages([...canonicalMessages, ...keptOptimistic])
    : canonicalMessages
}

export function shouldPreserveActiveReconcile(params: {
  currentStatus: StreamStatus | null | undefined
  nextStatus: StreamStatus | null | undefined
  candidateMessages: ChatMessage[]
  runningToolCount: number
  currentMessageCount?: number
  freshMessageCount?: number
}) {
  if (!isActiveRunStatus(params.currentStatus)) return false
  if (
    typeof params.currentMessageCount === "number" &&
    typeof params.freshMessageCount === "number" &&
    params.freshMessageCount < params.currentMessageCount
  ) return true
  if ((params.nextStatus === "idle" || params.nextStatus === "done") && params.runningToolCount > 0) return true
  return !hasAssistantAnswerAfterLatestUserMessage(params.candidateMessages)
}
