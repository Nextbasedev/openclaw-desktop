"use client"

import type { ActiveChat, ActiveTopic } from "@/components/sidebar"
import type { EditorGroupsState } from "@/lib/editorGroups"
import { invoke } from "@/lib/ipc"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"

const LAYOUT_CACHE_KEY = "workspace:last-layout:v1"
const LAYOUT_LOCAL_POINTER_KEY = "openclaw:last-workspace-layout-key"
const WINDOW_ID_STORAGE_KEY = "openclaw.workspace.window-id"
const LAYOUT_WORKSPACE_ID = "default"
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

type RemoteWorkspaceLayout = {
  layoutKey: string
  workspaceId: string
  windowId: string
  windowLabel?: string | null
  route?: string | null
  activeSpaceId?: string | null
  isMeaningful: boolean
  payload: unknown
  closedAt?: number | null
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

export function hasMeaningfulWorkspaceLayout(
  snapshot: Pick<WorkspaceLayoutSnapshot, "activeChat" | "activeTopic" | "editorGroups">,
) {
  return Boolean(snapshot.activeChat || snapshot.activeTopic) ||
    snapshot.editorGroups.groups.some((group) => group.tabs.some((tab) => tab.kind !== "draft"))
}

function localWindowId() {
  if (typeof window === "undefined") return "main"
  try {
    const existing = sessionStorage.getItem(WINDOW_ID_STORAGE_KEY)
    if (existing) return existing
    const generated = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(WINDOW_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return "main"
  }
}

async function currentWindowIdentity() {
  if (typeof window === "undefined") return { windowId: "main", windowLabel: "main" }
  if (window.__TAURI_INTERNALS__) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const label = getCurrentWindow().label || "main"
      return { windowId: label, windowLabel: label }
    } catch {}
  }
  const id = localWindowId()
  return { windowId: id, windowLabel: id }
}

function withMetadata(snapshot: Omit<WorkspaceLayoutSnapshot, "version" | "updatedAt">): WorkspaceLayoutSnapshot {
  return {
    ...snapshot,
    version: LAYOUT_VERSION,
    updatedAt: Date.now(),
  }
}

async function saveLocal(payload: WorkspaceLayoutSnapshot) {
  try {
    localStorage.setItem(LAYOUT_LOCAL_POINTER_KEY, LAYOUT_CACHE_KEY)
  } catch {}
  await persistentCacheSet(LAYOUT_CACHE_KEY, payload, { ttlMs: LAYOUT_TTL_MS })
}

export async function saveWorkspaceLayoutSnapshot(
  snapshot: Omit<WorkspaceLayoutSnapshot, "version" | "updatedAt">,
  options: { closed?: boolean } = {},
) {
  const isMeaningful = hasMeaningfulWorkspaceLayout(snapshot)
  if (!isMeaningful) return

  const payload = withMetadata(snapshot)
  await saveLocal(payload)

  try {
    const identity = await currentWindowIdentity()
    await invoke("middleware_workspace_layout_save", {
      input: {
        workspaceId: LAYOUT_WORKSPACE_ID,
        windowId: identity.windowId,
        windowLabel: identity.windowLabel,
        route: payload.route,
        activeSpaceId: payload.activeSpaceId ?? null,
        isMeaningful,
        closed: Boolean(options.closed),
        payload,
      },
    })
  } catch {
    // Local cache remains a safe fallback when middleware is unavailable.
  }
}

async function loadRemoteSnapshot(): Promise<WorkspaceLayoutSnapshot | null> {
  try {
    const result = await invoke<{ ok: true; layout: RemoteWorkspaceLayout | null }>(
      "middleware_workspace_layout_latest",
      { input: { workspaceId: LAYOUT_WORKSPACE_ID } },
    )
    const payload = result.layout?.payload
    if (!isSnapshot(payload)) return null
    if (Date.now() - payload.updatedAt > LAYOUT_TTL_MS) return null
    if (!hasMeaningfulWorkspaceLayout(payload)) return null
    await saveLocal(payload).catch(() => {})
    return payload
  } catch {
    return null
  }
}

async function loadLocalSnapshot(): Promise<WorkspaceLayoutSnapshot | null> {
  const payload = await persistentCacheGet<WorkspaceLayoutSnapshot>(LAYOUT_CACHE_KEY)
  if (!isSnapshot(payload)) return null
  if (Date.now() - payload.updatedAt > LAYOUT_TTL_MS) return null
  if (!hasMeaningfulWorkspaceLayout(payload)) return null
  return payload
}

export async function loadWorkspaceLayoutSnapshot(): Promise<WorkspaceLayoutSnapshot | null> {
  return (await loadRemoteSnapshot()) ?? (await loadLocalSnapshot())
}
