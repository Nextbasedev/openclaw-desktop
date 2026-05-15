"use client"

import type { ActiveChat, ActiveTopic } from "@/components/sidebar"
import type { EditorGroupsState } from "@/lib/editorGroups"
import { middlewareFetch } from "@/lib/middleware-client"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"

const LAYOUT_CACHE_KEY = "workspace:last-layout:v1"
const LAYOUT_LOCAL_POINTER_KEY = "openclaw:last-workspace-layout-key"
const LAYOUT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LAYOUT_VERSION = 1

export type WorkspaceLayoutSnapshot = {
  version: 1
  windowId?: string | null
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

type DurableLayoutResponse = {
  ok: true
  layout: null | {
    layoutKey: string
    workspaceId: string
    windowId: string
    isMeaningful: boolean
    payload: unknown
    updatedAt: number
  }
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

function workspaceIdFor(snapshotOrSpaceId?: Pick<WorkspaceLayoutSnapshot, "activeSpaceId"> | string | null) {
  const value = typeof snapshotOrSpaceId === "string" ? snapshotOrSpaceId : snapshotOrSpaceId?.activeSpaceId
  return value?.trim() || "default"
}

function hasMeaningfulLayout(snapshot: Pick<WorkspaceLayoutSnapshot, "activeChat" | "activeTopic" | "editorGroups">) {
  return Boolean(snapshot.activeChat || snapshot.activeTopic) ||
    snapshot.editorGroups.groups.some((group) => group.tabs.some((tab) => tab.kind !== "draft"))
}

export function getWorkspaceWindowId() {
  if (typeof window === "undefined") return "main"
  try {
    const existing = sessionStorage.getItem("openclaw.workspace.window-id")
    if (existing) return existing
    const generated = `window-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem("openclaw.workspace.window-id", generated)
    return generated
  } catch {
    return "main"
  }
}

export async function saveWorkspaceLayoutSnapshot(
  snapshot: Omit<WorkspaceLayoutSnapshot, "version" | "updatedAt">,
) {
  const payload: WorkspaceLayoutSnapshot = {
    ...snapshot,
    windowId: snapshot.windowId ?? getWorkspaceWindowId(),
    version: LAYOUT_VERSION,
    updatedAt: Date.now(),
  }
  const isMeaningful = hasMeaningfulLayout(payload)
  try {
    localStorage.setItem(LAYOUT_LOCAL_POINTER_KEY, LAYOUT_CACHE_KEY)
  } catch {}
  if (isMeaningful) {
    await persistentCacheSet(LAYOUT_CACHE_KEY, payload, { ttlMs: LAYOUT_TTL_MS })
  }
  await middlewareFetch("/api/workspace/layouts", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: workspaceIdFor(payload),
      windowId: payload.windowId,
      isMeaningful,
      payload,
    }),
  }).catch(() => {})
}

export async function loadWorkspaceLayoutSnapshot(activeSpaceId?: string | null): Promise<WorkspaceLayoutSnapshot | null> {
  const workspaceId = workspaceIdFor(activeSpaceId)
  const durable = await middlewareFetch<DurableLayoutResponse>(`/api/workspace/layouts/latest?workspaceId=${encodeURIComponent(workspaceId)}`)
    .catch(() => null)
  const durablePayload = durable?.layout?.payload
  if (isSnapshot(durablePayload) && Date.now() - durablePayload.updatedAt <= LAYOUT_TTL_MS) return durablePayload

  const payload = await persistentCacheGet<WorkspaceLayoutSnapshot>(LAYOUT_CACHE_KEY)
  if (!isSnapshot(payload)) return null
  if (Date.now() - payload.updatedAt > LAYOUT_TTL_MS) return null
  if (activeSpaceId && workspaceIdFor(payload) !== workspaceId) return null
  return payload
}
