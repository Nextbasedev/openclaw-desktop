import {
  getSessionWorkspaceFile,
  writeSessionWorkspaceFile,
} from "middleware"
import { getWorkspaceCapabilities } from "./workspace-capabilities.service.js"
import {
  immediateWorkspaceChildren,
  listMergedWorkspaceEntries,
  normalizeWorkspacePath,
  sortWorkspaceEntries,
  type WorkspaceEntry,
} from "./workspace-entries.service.js"
import {
  createLocalWorkspaceDirectory,
  deleteLocalWorkspaceEntry,
  hasLocalWorkspaceMirror,
  isVirtualWorkspacePath,
  isLocalWorkspacePath,
  moveLocalWorkspaceEntry,
  readLocalWorkspaceFile,
  readVirtualWorkspaceFile,
  writeLocalWorkspaceFile,
} from "./workspace-virtual-entries.service.js"

function ensureSessionKey(sessionKey: string | undefined): string {
  const value = sessionKey?.trim()
  if (!value) throw new Error("Session key is required")
  return value
}

function ensurePath(pathValue: string | undefined): string {
  const normalized = normalizeWorkspacePath(pathValue)
  if (!normalized) throw new Error("Path is required")
  return normalized
}

function inferEntryFromChildren(
  entries: WorkspaceEntry[],
  pathValue: string,
): WorkspaceEntry | null {
  const prefix = `${pathValue}/`
  const hasChildren = entries.some((entry) => entry.path.startsWith(prefix))
  if (!hasChildren) return null
  const segments = pathValue.split("/")
  return {
    name: segments[segments.length - 1] ?? pathValue,
    path: pathValue,
    type: "directory",
    size: 0,
  }
}

export async function workspaceTree(input: {
  sessionKey: string
  path?: string
  all?: boolean
}) {
  const sessionKey = ensureSessionKey(input.sessionKey)
  const relativePath = normalizeWorkspacePath(input.path)
  const entries = await listMergedWorkspaceEntries(sessionKey)

  if (input.all) {
    return { entries }
  }

  const visibleEntries = immediateWorkspaceChildren(entries, relativePath)

  return {
    entries: sortWorkspaceEntries(visibleEntries),
  }
}

export async function workspaceStat(input: {
  sessionKey: string
  path: string
}) {
  const sessionKey = ensureSessionKey(input.sessionKey)
  const relativePath = ensurePath(input.path)
  const entries = await listMergedWorkspaceEntries(sessionKey)
  const exact = entries.find((entry) => entry.path === relativePath)
  const inferred = exact ?? inferEntryFromChildren(entries, relativePath)

  if (!inferred) {
    throw new Error(`Workspace path not found: ${relativePath}`)
  }

  return { entry: inferred }
}

export async function workspaceRead(input: {
  sessionKey: string
  path: string
}) {
  const sessionKey = ensureSessionKey(input.sessionKey)
  const relativePath = ensurePath(input.path)

  if (isVirtualWorkspacePath(relativePath)) {
    const file = readVirtualWorkspaceFile(relativePath)
    return {
      file: {
        path: relativePath,
        content: file.content,
        encoding: file.encoding,
      },
    }
  }

  if (isLocalWorkspacePath(relativePath)) {
    const file = readLocalWorkspaceFile(relativePath)
    return {
      file: {
        path: relativePath,
        content: file.content,
        encoding: file.encoding,
      },
    }
  }

  const file = await getSessionWorkspaceFile({
    sessionKey,
    path: relativePath,
  })

  return {
    file: {
      path: relativePath,
      content: file.content,
      encoding: file.encoding,
    },
  }
}

export async function workspaceWrite(input: {
  sessionKey: string
  path: string
  content: string
}) {
  const sessionKey = ensureSessionKey(input.sessionKey)
  const relativePath = ensurePath(input.path)

  if (isVirtualWorkspacePath(relativePath)) {
    throw new Error("This workspace path is read-only.")
  }

  if (hasLocalWorkspaceMirror()) {
    writeLocalWorkspaceFile(relativePath, input.content)
    return { ok: true, path: relativePath }
  }

  await writeSessionWorkspaceFile({
    sessionKey,
    path: relativePath,
    content: input.content,
  })

  return { ok: true, path: relativePath }
}

export async function workspaceCreateDirectory(input: {
  sessionKey: string
  path: string
}) {
  ensureSessionKey(input.sessionKey)
  const relativePath = ensurePath(input.path)

  if (!hasLocalWorkspaceMirror()) {
    throw new Error("Workspace folders can only be created from the local OpenClaw workspace.")
  }

  createLocalWorkspaceDirectory(relativePath)
  return { ok: true, path: relativePath }
}

export async function workspaceMove(input: {
  sessionKey: string
  fromPath: string
  toPath: string
}) {
  ensureSessionKey(input.sessionKey)
  const fromPath = ensurePath(input.fromPath)
  const toPath = ensurePath(input.toPath)

  if (isVirtualWorkspacePath(fromPath) || isVirtualWorkspacePath(toPath)) {
    throw new Error("This workspace path is read-only.")
  }

  if (!hasLocalWorkspaceMirror()) {
    throw new Error("Workspace rename and move require the local OpenClaw workspace.")
  }

  moveLocalWorkspaceEntry(fromPath, toPath)
  return { ok: true, fromPath, toPath }
}

export async function workspaceDelete(input: {
  sessionKey: string
  path: string
}) {
  ensureSessionKey(input.sessionKey)
  const relativePath = ensurePath(input.path)

  if (isVirtualWorkspacePath(relativePath)) {
    throw new Error("This workspace path is read-only.")
  }

  if (!hasLocalWorkspaceMirror()) {
    throw new Error("Workspace delete requires the local OpenClaw workspace.")
  }

  deleteLocalWorkspaceEntry(relativePath)
  return { ok: true, path: relativePath }
}

export function workspaceCapabilities() {
  return { capabilities: getWorkspaceCapabilities() }
}
