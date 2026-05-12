"use client"

import { getMiddlewareConnection, middlewareFetch } from "@/lib/middleware-client"

export type RemoteWorkspaceEntry = {
  name: string
  path: string
  type: "file" | "directory"
  size: number
  modifiedAt?: string
}

export type RemoteWorkspaceCapabilities = {
  canTree: boolean
  canStat: boolean
  canRead: boolean
  canWrite: boolean
  canDownloadFile: boolean
  canCreateDir: boolean
  canMoveEntry: boolean
  canDeleteEntry: boolean
}

function workspaceBasePath(projectId?: string | null): string {
  const id = projectId ?? (typeof window !== "undefined" ? localStorage.getItem("openclaw.activeProjectId") : null)
  return id ? `/api/projects/${id}/workspace` : "/api/workspace"
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error((payload as { error?: string }).error || `Workspace request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function fetchRemoteWorkspaceTree(input: {
  sessionKey: string
  projectId?: string | null
  path?: string
  all?: boolean
}): Promise<{ entries: RemoteWorkspaceEntry[] }> {
  if (getMiddlewareConnection()) {
    const params = new URLSearchParams()
    if (input.path) params.set("path", input.path)
    return middlewareFetch(`${workspaceBasePath(input.projectId)}/tree?${params.toString()}`)
  }
  throw new Error("Middleware connection is not configured")
}

export async function fetchRemoteWorkspaceCapabilities(_sessionKey: string): Promise<{ capabilities: RemoteWorkspaceCapabilities }> {
  return {
    capabilities: {
      canTree: true,
      canStat: false,
      canRead: true,
      canWrite: true,
      canDownloadFile: false,
      canCreateDir: false,
      canMoveEntry: false,
      canDeleteEntry: false,
    },
  }
}

export async function fetchRemoteWorkspaceFile(input: {
  sessionKey: string
  projectId?: string | null
  path: string
}): Promise<{ path: string; content: string; encoding: string }> {
  if (getMiddlewareConnection()) {
    return middlewareFetch(`${workspaceBasePath(input.projectId)}/file?path=${encodeURIComponent(input.path)}`)
  }
  throw new Error("Middleware connection is not configured")
}

export async function fetchRemoteWorkspaceBlob(input: {
  projectId?: string | null
  path: string
}): Promise<{ blob: Blob; mimeType: string }> {
  const connection = getMiddlewareConnection()
  if (!connection) throw new Error("Middleware connection is not configured")
  const token = connection.token.trim()
  const response = await fetch(
    `${connection.url.replace(/\/+$/, "")}${workspaceBasePath(input.projectId)}/raw?path=${encodeURIComponent(input.path)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }))
    const error = (payload as { error?: unknown }).error
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message)
          : `Workspace media request failed: ${response.status}`
    throw new Error(message)
  }
  return {
    blob: await response.blob(),
    mimeType: response.headers.get("Content-Type") ?? "application/octet-stream",
  }
}

export function remoteWorkspaceMediaUrl(path: string): string {
  return `/api/workspace/media?path=${encodeURIComponent(path)}`
}

export async function saveRemoteWorkspaceFile(input: {
  sessionKey: string
  projectId?: string | null
  path: string
  content: string
}): Promise<void> {
  if (getMiddlewareConnection()) {
    await middlewareFetch(`${workspaceBasePath(input.projectId)}/file`, {
      method: "PUT",
      body: JSON.stringify({ path: input.path, content: input.content }),
    })
    return
  }
  throw new Error("Middleware connection is not configured")
}

export async function deleteRemoteWorkspaceEntry(_input: {
  sessionKey: string
  path: string
}): Promise<void> {
  throw new Error("Delete is not implemented in the new Middleware workspace API yet")
}

export async function createRemoteWorkspaceDirectory(_input: {
  sessionKey: string
  path: string
}): Promise<void> {
  throw new Error("Create directory is not implemented in the new Middleware workspace API yet")
}

export async function moveRemoteWorkspaceEntry(_input: {
  sessionKey: string
  fromPath: string
  toPath: string
}): Promise<void> {
  throw new Error("Move is not implemented in the new Middleware workspace API yet")
}

export function remoteWorkspaceDownloadUrl(_sessionKey: string, _path: string): string {
  throw new Error("Download is not implemented in the new Middleware workspace API yet")
}
