import { listSessionWorkspaceFiles } from "middleware"
import { getDb } from "../db/connection.js"
import { chatHistory } from "./chat.service.js"
import {
  hasLocalWorkspaceMirror,
  listLocalWorkspaceEntries,
  listVirtualWorkspaceEntries,
} from "./workspace-virtual-entries.service.js"

export type WorkspaceEntry = {
  name: string
  path: string
  type: "file" | "directory"
  size: number
  modifiedAt?: string
}

const REMOTE_WORKSPACE_ROOT = "/root/.openclaw/workspace"
const CLONE_DIRECTORY_CACHE_TTL_MS = 15_000

type CloneDirectoryCacheEntry = {
  expiresAt: number
  entries: WorkspaceEntry[]
}

const cloneDirectoryCache = new Map<string, CloneDirectoryCacheEntry>()

export function clearWorkspaceEntryCaches(): void {
  cloneDirectoryCache.clear()
}

export function normalizeWorkspacePath(input: string | undefined): string {
  const value = (input ?? "").trim()
  if (!value || value === ".") return ""
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
}

export function workspaceParentPath(pathValue: string): string {
  const normalized = normalizeWorkspacePath(pathValue)
  if (!normalized) return ""
  const parts = normalized.split("/")
  parts.pop()
  return parts.join("/")
}

export function workspaceFileName(pathValue: string): string {
  const normalized = normalizeWorkspacePath(pathValue)
  if (!normalized) return ""
  const parts = normalized.split("/")
  return parts[parts.length - 1] ?? normalized
}

export function sortWorkspaceEntries(
  entries: WorkspaceEntry[],
): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1
    }
    return a.path.localeCompare(b.path)
  })
}

export function immediateWorkspaceChildren(
  entries: WorkspaceEntry[],
  directoryPath: string,
): WorkspaceEntry[] {
  const currentPath = normalizeWorkspacePath(directoryPath)
  const prefix = currentPath ? `${currentPath}/` : ""
  const directories = new Map<string, WorkspaceEntry>()
  const files: WorkspaceEntry[] = []

  for (const entry of entries) {
    const entryPath = normalizeWorkspacePath(entry.path)
    if (!entryPath) continue

    if (workspaceParentPath(entryPath) === currentPath) {
      if (entry.type === "directory") {
        directories.set(entryPath, { ...entry, path: entryPath })
      } else {
        files.push({ ...entry, path: entryPath })
      }
      continue
    }

    if (!entryPath.startsWith(prefix)) continue
    const remainder = prefix ? entryPath.slice(prefix.length) : entryPath
    if (!remainder || !remainder.includes("/")) continue

    const [directoryName] = remainder.split("/")
    const directoryEntryPath = normalizeWorkspacePath(
      prefix ? `${prefix}${directoryName}` : directoryName,
    )
    if (!directoryEntryPath || directories.has(directoryEntryPath)) continue

    directories.set(directoryEntryPath, {
      name: directoryName ?? workspaceFileName(directoryEntryPath),
      path: directoryEntryPath,
      type: "directory",
      size: 0,
    })
  }

  return [...directories.values(), ...files]
}

function clonePathToWorkspaceEntries(
  text: string | undefined,
): WorkspaceEntry[] {
  if (!text) return []

  const matches = text.matchAll(
    /\/root\/\.openclaw\/workspace\/[^\s"'`)\]}]+/g,
  )
  const directories = new Map<string, WorkspaceEntry>()

  for (const match of matches) {
    const rawPath = match[0]?.trim()
    if (!rawPath?.startsWith(`${REMOTE_WORKSPACE_ROOT}/`)) continue

    const relativePath = normalizeWorkspacePath(
      rawPath.slice(REMOTE_WORKSPACE_ROOT.length + 1),
    )
    if (!relativePath) continue

    const parts = relativePath.split("/")
    const lastDirectoryIndex = inferredLastDirectoryIndex(parts)
    for (let index = 0; index <= lastDirectoryIndex; index += 1) {
      const pathValue = parts.slice(0, index + 1).join("/")
      if (!pathValue) continue
      directories.set(pathValue, {
        name: parts[index] ?? workspaceFileName(pathValue),
        path: pathValue,
        type: "directory",
        size: 0,
      })
    }
  }

  return [...directories.values()]
}

function inferredLastDirectoryIndex(parts: string[]): number {
  const leaf = parts[parts.length - 1] ?? ""
  if (!leaf || leaf.startsWith(".")) return parts.length - 1
  if (leaf.includes(".")) return parts.length - 2
  return parts.length - 1
}

function repoNameFromRemoteUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "")
  const parts = cleaned.split("/").filter(Boolean)
  return normalizeWorkspacePath(parts[parts.length - 1] ?? "")
}

function remoteUrlToWorkspaceEntries(
  text: string | undefined,
): WorkspaceEntry[] {
  if (!text) return []

  const cloneLikeSignal =
    /(?:remote\s*:|already cloned|repo status is clean|branch\s*:|git clone)/i.test(
      text,
    )
  if (!cloneLikeSignal) return []

  const matches = text.matchAll(
    /https?:\/\/[^\s"'`)\]}]+?\/([^/\s"'`)\]}]+?)(?:\.git)?(?=\s|$)/gi,
  )
  const directories = new Map<string, WorkspaceEntry>()

  for (const match of matches) {
    const rawUrl = match[0]?.trim()
    if (!rawUrl) continue

    const repoName = repoNameFromRemoteUrl(rawUrl)
    if (!repoName) continue

    directories.set(repoName, {
      name: workspaceFileName(repoName),
      path: repoName,
      type: "directory",
      size: 0,
    })
  }

  return [...directories.values()]
}

function collectMessageText(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMessageText(item))
  }
  if (typeof value !== "object") return []

  const record = value as Record<string, unknown>
  const segments: string[] = []

  for (const key of [
    "text",
    "content",
    "message",
    "result",
    "output",
    "stderr",
    "stdout",
    "error",
  ]) {
    if (key in record) {
      segments.push(...collectMessageText(record[key]))
    }
  }

  return segments
}

async function listDetectedCloneDirectories(
  sessionKey: string,
): Promise<WorkspaceEntry[]> {
  const scope = resolveWorkspaceCloneScope(sessionKey)
  const cached = cloneDirectoryCache.get(scope.cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries
  }

  try {
    const directories = new Map<string, WorkspaceEntry>()
    for (const key of scope.sessionKeys) {
      const history = await chatHistory({ sessionKey: key })
      for (const message of history.messages ?? []) {
        const textSegments = collectMessageText(message)
        for (const segment of textSegments) {
          for (const entry of clonePathToWorkspaceEntries(segment)) {
            directories.set(entry.path, entry)
          }
          for (const entry of remoteUrlToWorkspaceEntries(segment)) {
            directories.set(entry.path, entry)
          }
        }
      }
    }
    const entries = [...directories.values()]
    cloneDirectoryCache.set(scope.cacheKey, {
      expiresAt: Date.now() + CLONE_DIRECTORY_CACHE_TTL_MS,
      entries,
    })
    return entries
  } catch {
    return []
  }
}

function resolveWorkspaceCloneScope(sessionKey: string): {
  cacheKey: string
  sessionKeys: string[]
} {
  const db = getDb()
  const scopeRow = db
    .prepare(
      "SELECT agent_id, source FROM session_mappings WHERE session_key = ?",
    )
    .get(sessionKey) as
    | { agent_id: string; source: string }
    | undefined

  if (!scopeRow) {
    return {
      cacheKey: `session:${sessionKey}`,
      sessionKeys: [sessionKey],
    }
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT session_key
       FROM session_mappings
       WHERE agent_id = ?
         AND source = ?
         AND hidden = 0
       ORDER BY updated_at DESC
       LIMIT 50`,
    )
    .all(scopeRow.agent_id, scopeRow.source) as Array<{ session_key: string }>

  const sessionKeys = Array.from(
    new Set([
      sessionKey,
      ...rows.map((row) => row.session_key).filter(Boolean),
    ]),
  )

  return {
    cacheKey: `agent:${scopeRow.agent_id}:source:${scopeRow.source}`,
    sessionKeys,
  }
}

export async function listMergedWorkspaceEntries(
  sessionKey: string,
): Promise<WorkspaceEntry[]> {
  const [result, detectedCloneDirectories] = await Promise.all([
    listSessionWorkspaceFiles({ sessionKey }),
    listDetectedCloneDirectories(sessionKey),
  ])
  const localEntries = listLocalWorkspaceEntries()
  const virtualEntries = listVirtualWorkspaceEntries()
  const includeDetectedCloneDirectories =
    !hasLocalWorkspaceMirror() || localEntries.length === 0

  const merged = new Map<string, WorkspaceEntry>()

  for (const entry of localEntries) {
    const normalizedPath = normalizeWorkspacePath(entry.path)
    if (!normalizedPath) continue
    merged.set(normalizedPath, {
      name: entry.name || workspaceFileName(normalizedPath),
      path: normalizedPath,
      type: entry.type,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
    })
  }

  for (const entry of result.entries) {
    const normalizedPath = normalizeWorkspacePath(entry.path)
    if (!normalizedPath) continue
    if (!merged.has(normalizedPath)) {
      merged.set(normalizedPath, {
        name: entry.name || workspaceFileName(normalizedPath),
        path: normalizedPath,
        type: entry.type,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })
    }
  }

  if (includeDetectedCloneDirectories) {
    for (const entry of detectedCloneDirectories) {
      if (!merged.has(entry.path)) {
        merged.set(entry.path, entry)
      }
    }
  }

  for (const entry of virtualEntries) {
    if (!merged.has(entry.path)) {
      merged.set(entry.path, entry)
    }
  }

  return sortWorkspaceEntries([...merged.values()])
}
