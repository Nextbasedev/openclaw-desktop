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

function workspaceBasePath(): string {
  const projectId = typeof window !== "undefined" ? localStorage.getItem("openclaw.activeProjectId") : null
  return projectId ? `/api/projects/${projectId}/workspace` : "/api/workspace"
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
  path?: string
  all?: boolean
}): Promise<{ entries: RemoteWorkspaceEntry[] }> {
  if (getMiddlewareConnection()) {
    const params = new URLSearchParams()
    if (input.path) params.set("path", input.path)
    return middlewareFetch(`${workspaceBasePath()}/tree?${params.toString()}`)
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
  path: string
}): Promise<{ path: string; content: string; encoding: string }> {
  if (getMiddlewareConnection()) {
    return middlewareFetch(`${workspaceBasePath()}/file?path=${encodeURIComponent(input.path)}`)
  }
  throw new Error("Middleware connection is not configured")
}

export async function saveRemoteWorkspaceFile(input: {
  sessionKey: string
  path: string
  content: string
}): Promise<void> {
  if (getMiddlewareConnection()) {
    await middlewareFetch(`${workspaceBasePath()}/file`, {
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
