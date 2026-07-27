import type { QueryClient } from "@tanstack/react-query"
import type { ChatMessage } from "../../components/ChatView/types"
import { parseChatHistory, type RawHistoryMessage } from "../chatHistoryParser"
import { queryKeys } from "../query"
import type { CachedChatBootstrapV2 } from "./types"

export function warmBootstrapMessages(
  initialMessages: ChatMessage[] | undefined,
  cachedBootstrap: CachedChatBootstrapV2 | null | undefined,
): ChatMessage[] | undefined {
  if (initialMessages && initialMessages.length > 0) return initialMessages
  const cachedMessages = cachedBootstrap?.messages ?? cachedBootstrap?.history?.messages
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
  queryClient.setQueryData(queryKeys.chatBootstrap(sessionKey), (existing: CachedChatBootstrapV2 | undefined) => ({
    ...(existing ?? {}),
    messages,
    messageCount: messages.length,
    history: {
      ...(existing?.history ?? {}),
      messages,
    },
    branchData: existing?.branchData ?? { branches: [] },
    cursor: existing?.cursor,
    v2Cursor: existing?.v2Cursor,
  } satisfies CachedChatBootstrapV2))
}
