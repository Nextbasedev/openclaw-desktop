import { invoke } from "@/lib/ipc"
import { localSyncGetChats, localSyncSetChats } from "@/lib/localFirstSync"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"
import { dedupeRequest, invalidateDedupe } from "@/lib/requestDedupe"
import { loadMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import type { Chat } from "@/types/chat"

const CHAT_LIST_CACHE_TTL_MS = 1000 * 60
const CHAT_LIST_REQUEST_TTL_MS = 1500

function connectionCacheKey() {
  if (typeof window === "undefined") return "server"
  try {
    const url = localStorage.getItem("openclaw.middleware.url")?.trim() || "default"
    const token = localStorage.getItem("openclaw.middleware.token")?.trim() ? "token" : "no-token"
    return `${url}|${token}`
  } catch {
    return "default"
  }
}

function chatListRequestKey(spaceId?: string | null) {
  return `chat-list:${connectionCacheKey()}:${spaceId ?? "all"}`
}

function projectChatCacheKey(spaceId: string) {
  return `project:${spaceId}:chats`
}

export function visibleChatsForSpace(chats: Chat[], spaceId?: string | null) {
  return chats.filter((chat) => {
    if (chat.archived) return false
    if (chat.isSubagent || chat.parentSessionKey || isSubagentSessionKey(chat.sessionKey)) return false
    return !spaceId || chat.spaceId === spaceId
  })
}

export async function loadCachedChatsForSpace(spaceId?: string | null): Promise<Chat[] | null> {
  if (spaceId) {
    const localChats = await localSyncGetChats(spaceId).catch(() => null)
    if (localChats?.chats?.length) return visibleChatsForSpace(localChats.chats, spaceId)

    const persisted = await persistentCacheGet<Chat[]>(projectChatCacheKey(spaceId)).catch(() => null)
    if (persisted?.length) return visibleChatsForSpace(persisted, spaceId)
  }

  const bootstrap = await loadMiddlewareStartupBootstrap().catch(() => null)
  if (!bootstrap?.chats?.length) return null
  if (spaceId && bootstrap.activeSpaceId !== spaceId) return null
  return visibleChatsForSpace(bootstrap.chats, spaceId)
}

export async function fetchChatsForSpace(spaceId?: string | null): Promise<Chat[]> {
  return dedupeRequest(
    chatListRequestKey(spaceId),
    async () => {
      const result = await invoke<{ chats: Chat[] }>(
        "middleware_chats_list",
        { input: { spaceId: spaceId ?? undefined } },
      )
      const active = visibleChatsForSpace(result.chats || [], spaceId)
      if (spaceId) {
        await persistentCacheSet(projectChatCacheKey(spaceId), active, { ttlMs: CHAT_LIST_CACHE_TTL_MS })
        await localSyncSetChats(spaceId, active, undefined, CHAT_LIST_CACHE_TTL_MS)
      }
      return active
    },
    { ttlMs: CHAT_LIST_REQUEST_TTL_MS },
  )
}

export function invalidateChatListCache(spaceId?: string | null) {
  if (spaceId) {
    invalidateDedupe(chatListRequestKey(spaceId))
    invalidateDedupe(chatListRequestKey(null))
    return
  }
  invalidateDedupe("chat-list:")
}
