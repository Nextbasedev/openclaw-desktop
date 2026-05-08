import { getMiddlewareConnection, middlewareFetch } from "@/lib/middleware-client"
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
const BOOTSTRAP_TTL_MS = 2_000

export async function loadMiddlewareStartupBootstrap(): Promise<BootstrapPayload | null> {
  if (!getMiddlewareConnection()) return null
  return dedupeRequest(
    BOOTSTRAP_KEY,
    () => middlewareFetch<BootstrapPayload>("/api/bootstrap"),
    { ttlMs: BOOTSTRAP_TTL_MS },
  ).catch(() => null)
}

export function invalidateMiddlewareStartupBootstrap() {
  invalidateDedupe(BOOTSTRAP_KEY)
}
