import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage } from "../../components/ChatView/types"
import { parseChatHistory, type RawHistoryMessage } from "../chatHistoryParser"
import { queryKeys } from "../query"

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

export function updateCachedBootstrapMessages(
  queryClient: QueryClient,
  sessionKey: string,
  messages: ChatMessage[],
) {
  if (messages.length === 0) return
  queryClient.setQueryData(queryKeys.chatBootstrap(sessionKey), (existing: CachedBootstrap | undefined) => ({
    history: {
      ...(existing?.history ?? {}),
      messages,
    },
    branchData: (existing as { branchData?: unknown } | undefined)?.branchData ?? { branches: [] },
    v2Cursor: (existing as { v2Cursor?: number } | undefined)?.v2Cursor,
  }))
}
