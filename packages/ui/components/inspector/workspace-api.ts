"use client"

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

function sessionHeaders(sessionKey: string): HeadersInit {
  return {
    "x-session-key": sessionKey,
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(
      (payload as { error?: string }).error ||
        `Workspace request failed: ${response.status}`,
    )
  }
  return response.json() as Promise<T>
}

export async function fetchRemoteWorkspaceTree(input: {
  sessionKey: string
  path?: string
  all?: boolean
}): Promise<{ entries: RemoteWorkspaceEntry[] }> {
  const params = new URLSearchParams()
  if (input.path) params.set("path", input.path)
  if (input.all) params.set("all", "true")
  const suffix = params.toString() ? `?${params.toString()}` : ""
  const response = await fetch(`/api/my/workspace/tree${suffix}`, {
    headers: sessionHeaders(input.sessionKey),
  })
  return readJson(response)
}

export async function fetchRemoteWorkspaceCapabilities(
  sessionKey: string,
): Promise<{ capabilities: RemoteWorkspaceCapabilities }> {
  const response = await fetch("/api/my/workspace/capabilities", {
    headers: sessionHeaders(sessionKey),
  })
  return readJson(response)
}

export async function fetchRemoteWorkspaceFile(input: {
  sessionKey: string
  path: string
}): Promise<{ path: string; content: string; encoding: string }> {
  const response = await fetch(
    `/api/my/workspace/files/${input.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      headers: sessionHeaders(input.sessionKey),
    },
  )
  return readJson(response)
}

export async function saveRemoteWorkspaceFile(input: {
  sessionKey: string
  path: string
  content: string
}): Promise<void> {
  const response = await fetch(
    `/api/my/workspace/files/${input.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...sessionHeaders(input.sessionKey),
      },
      body: JSON.stringify({ content: input.content }),
    },
  )
  await readJson<{ ok: true }>(response)
}

export async function deleteRemoteWorkspaceEntry(input: {
  sessionKey: string
  path: string
}): Promise<void> {
  const response = await fetch(
    `/api/my/workspace/files/${input.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "DELETE",
      headers: sessionHeaders(input.sessionKey),
    },
  )
  await readJson<{ ok: true }>(response)
}

export async function createRemoteWorkspaceDirectory(input: {
  sessionKey: string
  path: string
}): Promise<void> {
  const response = await fetch("/api/my/workspace/mkdir", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...sessionHeaders(input.sessionKey),
    },
    body: JSON.stringify({ path: input.path }),
  })
  await readJson<{ ok: true }>(response)
}

export async function moveRemoteWorkspaceEntry(input: {
  sessionKey: string
  fromPath: string
  toPath: string
}): Promise<void> {
  const response = await fetch("/api/my/workspace/move", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...sessionHeaders(input.sessionKey),
    },
    body: JSON.stringify({
      fromPath: input.fromPath,
      toPath: input.toPath,
    }),
  })
  await readJson<{ ok: true }>(response)
}

export function remoteWorkspaceDownloadUrl(
  sessionKey: string,
  path: string,
): string {
  const params = new URLSearchParams({ sessionKey })
  return `/api/my/workspace/download/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?${params.toString()}`
}
