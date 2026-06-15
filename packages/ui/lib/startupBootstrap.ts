import { getMiddlewareConnection, middlewareFetch } from "@/lib/middleware-client"
import { localSyncGetBootstrap, localSyncInvalidate, localSyncSetBootstrap, localSyncSetChats } from "@/lib/localFirstSync"
import { persistentCacheDeletePrefix, persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"
import { dedupeRequest, invalidateDedupe } from "@/lib/requestDedupe"
import type { Space } from "@/types/space"
import type { Chat } from "@/types/chat"
import type { Project } from "@/lib/api/projects"

type BootstrapPayload = {
  spaces: Space[]
  activeSpaceId: string | null
  chats: Chat[]
  projects?: Project[]
  sessions?: unknown[]
}

const BOOTSTRAP_KEY = "middleware:startup-bootstrap"
const BOOTSTRAP_CACHE_KEY = "startup:bootstrap"
const BOOTSTRAP_TTL_MS = 2_000
const BOOTSTRAP_PERSIST_TTL_MS = 1000 * 60

async function fetchMiddlewareStartupBootstrap(): Promise<BootstrapPayload | null> {
  if (!getMiddlewareConnection()) return null
  return dedupeRequest(
    BOOTSTRAP_KEY,
    async () => {
      const payload = await middlewareFetch<BootstrapPayload>("/api/bootstrap")
      await persistentCacheSet(BOOTSTRAP_CACHE_KEY, payload, { ttlMs: BOOTSTRAP_PERSIST_TTL_MS })
      await localSyncSetBootstrap({
        spaces: payload.spaces || [],
        activeSpaceId: payload.activeSpaceId ?? null,
        sessions: payload.sessions,
        ttlMs: BOOTSTRAP_PERSIST_TTL_MS,
      })
      if (payload.activeSpaceId) {
        await persistentCacheSet(`project:${payload.activeSpaceId}:chats`, payload.chats || [], { ttlMs: BOOTSTRAP_PERSIST_TTL_MS })
        await localSyncSetChats(
          payload.activeSpaceId,
          payload.chats || [],
          undefined,
          BOOTSTRAP_PERSIST_TTL_MS,
        )
      }
      return payload
    },
    { ttlMs: BOOTSTRAP_TTL_MS },
  ).catch(() => null)
}

export async function loadMiddlewareStartupBootstrap(): Promise<BootstrapPayload | null> {
  const localFirst = await localSyncGetBootstrap()
  const cached = localFirst
    ? { spaces: localFirst.spaces, activeSpaceId: localFirst.activeSpaceId, chats: [], sessions: localFirst.sessions }
    : await persistentCacheGet<BootstrapPayload>(BOOTSTRAP_CACHE_KEY)
  if (cached) return cached
  return await fetchMiddlewareStartupBootstrap()
}

export async function refreshMiddlewareStartupBootstrap(): Promise<BootstrapPayload | null> {
  return fetchMiddlewareStartupBootstrap()
}

export function invalidateMiddlewareStartupBootstrap() {
  invalidateDedupe(BOOTSTRAP_KEY)
  void persistentCacheDeletePrefix("startup:")
  void persistentCacheDeletePrefix("project:")
  void localSyncInvalidate("local:first:")
}
