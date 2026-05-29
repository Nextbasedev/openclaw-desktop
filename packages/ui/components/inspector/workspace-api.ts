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

/**
 * workspaceBasePath(null)  → real global workspace (/api/workspace)
 * workspaceBasePath(undefined) → legacy: falls back to localStorage activeProjectId
 * workspaceBasePath("project_x") → project-scoped workspace
 */
function workspaceBasePath(projectId?: string | null): string {
  // Explicit null means "global workspace" — no localStorage fallback
  if (projectId === null) return "/api/workspace"
  const id = projectId ?? (typeof window !== "undefined" ? localStorage.getItem("openclaw.activeProjectId") : null)
  return id ? `/api/projects/${id}/workspace` : "/api/workspace"
}

function requireMiddleware() {
  const connection = getMiddlewareConnection()
  if (!connection) throw new Error("Middleware connection is not configured")
  return connection
}

function pathQuery(path?: string) {
  const params = new URLSearchParams()
  if (path) params.set("path", path)
  const query = params.toString()
  return query ? `?${query}` : ""
}

export async function fetchRemoteWorkspaceTree(input: {
  sessionKey: string
  projectId?: string | null
  path?: string
  all?: boolean
}): Promise<{ entries: RemoteWorkspaceEntry[] }> {
  requireMiddleware()
  return middlewareFetch(`${workspaceBasePath(input.projectId)}/tree${pathQuery(input.path)}`)
}

export async function fetchRemoteWorkspaceCapabilities(projectIdOrSessionKey?: string | null): Promise<{ capabilities: RemoteWorkspaceCapabilities }> {
  requireMiddleware()
  // The old API accepted a session key. New middleware capabilities are workspace-scoped;
  // if a project id is available in localStorage, workspaceBasePath() will use it.
  const projectId = typeof projectIdOrSessionKey === "string" && projectIdOrSessionKey.startsWith("project_")
    ? projectIdOrSessionKey
    : undefined
  return middlewareFetch(`${workspaceBasePath(projectId)}/capabilities`)
}

export async function fetchRemoteWorkspaceStat(input: {
  sessionKey: string
  projectId?: string | null
  path: string
}): Promise<{ entry: RemoteWorkspaceEntry }> {
  requireMiddleware()
  return middlewareFetch(`${workspaceBasePath(input.projectId)}/stat${pathQuery(input.path)}`)
}

export async function fetchRemoteWorkspaceFile(input: {
  sessionKey: string
  projectId?: string | null
  path: string
}): Promise<{ path: string; content: string; encoding: string }> {
  requireMiddleware()
  return middlewareFetch(`${workspaceBasePath(input.projectId)}/file${pathQuery(input.path)}`)
}

export async function saveRemoteWorkspaceFile(input: {
  sessionKey: string
  projectId?: string | null
  path: string
  content: string
}): Promise<void> {
  requireMiddleware()
  await middlewareFetch(`${workspaceBasePath(input.projectId)}/file`, {
    method: "PUT",
    body: JSON.stringify({ path: input.path, content: input.content }),
  })
}

export async function deleteRemoteWorkspaceEntry(input: {
  sessionKey: string
  projectId?: string | null
  path: string
}): Promise<void> {
  requireMiddleware()
  await middlewareFetch(`${workspaceBasePath(input.projectId)}/file${pathQuery(input.path)}`, { method: "DELETE" })
}

export async function createRemoteWorkspaceDirectory(input: {
  sessionKey: string
  projectId?: string | null
  path: string
}): Promise<void> {
  requireMiddleware()
  await middlewareFetch(`${workspaceBasePath(input.projectId)}/mkdir`, {
    method: "POST",
    body: JSON.stringify({ path: input.path }),
  })
}

export async function moveRemoteWorkspaceEntry(input: {
  sessionKey: string
  projectId?: string | null
  fromPath: string
  toPath: string
}): Promise<void> {
  requireMiddleware()
  await middlewareFetch(`${workspaceBasePath(input.projectId)}/move`, {
    method: "POST",
    body: JSON.stringify({ fromPath: input.fromPath, toPath: input.toPath }),
  })
}

export function remoteWorkspaceDownloadUrl(_sessionKey: string, path: string, projectId?: string | null): string {
  const connection = getMiddlewareConnection()
  if (!connection) throw new Error("Middleware connection is not configured")
  const tokenQuery = connection.token ? `&token=${encodeURIComponent(connection.token)}` : ""
  return `${connection.url}${workspaceBasePath(projectId)}/download${pathQuery(path)}${tokenQuery}`
}
