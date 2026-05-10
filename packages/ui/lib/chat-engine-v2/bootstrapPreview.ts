import type { ChatMessage } from "../../components/ChatView/types"
import { parseChatHistory, type RawHistoryMessage } from "../chatHistoryParser"

type CachedBootstrap = {
  history?: { messages?: unknown[] }
}

export function warmBootstrapMessages(
  initialMessages: ChatMessage[] | undefined,
  cachedBootstrap: CachedBootstrap | null | undefined,
): ChatMessage[] | undefined {
  if (initialMessages && initialMessages.length > 0) return initialMessages
  const cachedMessages = cachedBootstrap?.history?.messages
  if (!cachedMessages || cachedMessages.length === 0) return undefined
  const parsed = parseChatHistory(cachedMessages as RawHistoryMessage[]).messages
  return parsed.length > 0 ? parsed : undefined
}
