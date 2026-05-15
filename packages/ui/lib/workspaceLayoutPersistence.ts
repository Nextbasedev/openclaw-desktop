"use client"

import type { ActiveChat, ActiveTopic } from "@/components/sidebar"
import type { EditorGroupsState } from "@/lib/editorGroups"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"

const LAYOUT_CACHE_KEY = "workspace:last-layout:v1"
const LAYOUT_LOCAL_POINTER_KEY = "openclaw:last-workspace-layout-key"
const LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LAYOUT_VERSION = 1

export type WorkspaceLayoutSnapshot = {
  version: 1
  activeSpaceId?: string | null
  activeTab: string
  route: string
  activeChat?: ActiveChat | null
  activeTopic?: ActiveTopic | null
  activeSessionKey?: string | null
  activeSessionTitle?: string | null
  editorGroups: EditorGroupsState
  splitRatio: number
  updatedAt: number
}

function isSnapshot(value: unknown): value is WorkspaceLayoutSnapshot {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<WorkspaceLayoutSnapshot>
  return (
    record.version === LAYOUT_VERSION &&
    typeof record.activeTab === "string" &&
    typeof record.route === "string" &&
    typeof record.updatedAt === "number" &&
    Boolean(record.editorGroups && Array.isArray(record.editorGroups.groups))
  )
}

export async function saveWorkspaceLayoutSnapshot(
  snapshot: Omit<WorkspaceLayoutSnapshot, "version" | "updatedAt">,
) {
  const payload: WorkspaceLayoutSnapshot = {
    ...snapshot,
    version: LAYOUT_VERSION,
    updatedAt: Date.now(),
  }
  try {
    localStorage.setItem(LAYOUT_LOCAL_POINTER_KEY, LAYOUT_CACHE_KEY)
  } catch {}
  await persistentCacheSet(LAYOUT_CACHE_KEY, payload, { ttlMs: LAYOUT_TTL_MS })
}

export async function loadWorkspaceLayoutSnapshot(): Promise<WorkspaceLayoutSnapshot | null> {
  const payload = await persistentCacheGet<WorkspaceLayoutSnapshot>(LAYOUT_CACHE_KEY)
  if (!isSnapshot(payload)) return null
  if (Date.now() - payload.updatedAt > LAYOUT_TTL_MS) return null
  return payload
}
