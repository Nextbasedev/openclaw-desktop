"use client"

import type { ActiveChat, ActiveTopic } from "@/components/sidebar"
import type { EditorGroupsState } from "@/lib/editorGroups"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"

const LEGACY_LAYOUT_CACHE_KEY = "workspace:last-layout:v1"
const LAYOUT_CACHE_PREFIX = LEGACY_LAYOUT_CACHE_KEY
const LAYOUT_LOCAL_POINTER_KEY = "openclaw:last-workspace-layout-key"
const LAYOUT_WINDOW_ID_PARAM = "openclawWindowId"
const LAYOUT_WINDOW_ID_STORAGE_KEY = "openclaw.layoutWindowId"
const LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LAYOUT_VERSION = 1

function normalizeWindowLayoutId(value: string | null | undefined) {
  const normalized = value?.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) ?? ""
  return normalized || null
}

function createWindowLayoutId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `window-${random}`
}

export function currentWorkspaceLayoutWindowId() {
  if (typeof window === "undefined") return "main"

  const urlId = normalizeWindowLayoutId(new URLSearchParams(window.location.search).get(LAYOUT_WINDOW_ID_PARAM))
  if (urlId) {
    try { window.sessionStorage.setItem(LAYOUT_WINDOW_ID_STORAGE_KEY, urlId) } catch {}
    return urlId
  }

  try {
    const stored = normalizeWindowLayoutId(window.sessionStorage.getItem(LAYOUT_WINDOW_ID_STORAGE_KEY))
    if (stored) return stored
  } catch {}

  const isSecondaryWindow = window.name?.startsWith("openclaw-chat-")
  if (!isSecondaryWindow) return "main"

  const generated = createWindowLayoutId()
  try { window.sessionStorage.setItem(LAYOUT_WINDOW_ID_STORAGE_KEY, generated) } catch {}
  return generated
}

export function workspaceLayoutCacheKey(windowId = currentWorkspaceLayoutWindowId()) {
  return `${LAYOUT_CACHE_PREFIX}:${windowId}`
}

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

function isFreshSnapshot(value: unknown): value is WorkspaceLayoutSnapshot {
  return isSnapshot(value) && Date.now() - value.updatedAt <= LAYOUT_TTL_MS
}

function persistentLocalStorageKey(key: string) {
  return `openclaw-ui-cache:v1:${key}`
}

function readLocalSnapshot(cacheKey: string): WorkspaceLayoutSnapshot | null {
  if (typeof localStorage === "undefined") return null
  try {
    const entry = JSON.parse(localStorage.getItem(persistentLocalStorageKey(cacheKey)) || "null") as { value?: unknown } | null
    return isFreshSnapshot(entry?.value) ? entry.value : null
  } catch {
    return null
  }
}

export function loadWorkspaceLayoutSnapshotSync(): WorkspaceLayoutSnapshot | null {
  const cacheKey = workspaceLayoutCacheKey()
  const payload = readLocalSnapshot(cacheKey)
  if (payload) return payload

  if (cacheKey !== workspaceLayoutCacheKey("main")) return null
  return readLocalSnapshot(LEGACY_LAYOUT_CACHE_KEY)
}

export async function saveWorkspaceLayoutSnapshot(
  snapshot: Omit<WorkspaceLayoutSnapshot, "version" | "updatedAt">,
) {
  const payload: WorkspaceLayoutSnapshot = {
    ...snapshot,
    version: LAYOUT_VERSION,
    updatedAt: Date.now(),
  }
  const cacheKey = workspaceLayoutCacheKey()
  try {
    localStorage.setItem(LAYOUT_LOCAL_POINTER_KEY, cacheKey)
  } catch {}
  await persistentCacheSet(cacheKey, payload, { ttlMs: LAYOUT_TTL_MS })
}

export async function loadWorkspaceLayoutSnapshot(): Promise<WorkspaceLayoutSnapshot | null> {
  const cacheKey = workspaceLayoutCacheKey()
  const payload = await persistentCacheGet<WorkspaceLayoutSnapshot>(cacheKey)
  if (isFreshSnapshot(payload)) return payload

  if (cacheKey !== workspaceLayoutCacheKey("main")) return null

  const legacyPayload = await persistentCacheGet<WorkspaceLayoutSnapshot>(LEGACY_LAYOUT_CACHE_KEY)
  if (!isFreshSnapshot(legacyPayload)) return null

  await persistentCacheSet(cacheKey, legacyPayload, { ttlMs: LAYOUT_TTL_MS })
  try {
    localStorage.setItem(LAYOUT_LOCAL_POINTER_KEY, cacheKey)
  } catch {}
  return legacyPayload
}
