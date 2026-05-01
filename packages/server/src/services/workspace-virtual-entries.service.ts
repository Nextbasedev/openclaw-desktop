import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export type VirtualWorkspaceEntry = {
  name: string
  path: string
  type: "file" | "directory"
  size: number
  modifiedAt?: string
}

const VIRTUAL_HOME_ROOT = "~"
const OPENCLAW_HOME = path.join(os.homedir(), ".openclaw")
const OPENCLAW_WORKSPACE_ROOT = path.join(OPENCLAW_HOME, "workspace")
const VIRTUAL_PREFIX = `${VIRTUAL_HOME_ROOT}/.openclaw`

function normalizeVirtualPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+$/, "")
}

function addDirectoryChain(
  entries: Map<string, VirtualWorkspaceEntry>,
  virtualPath: string,
): void {
  const parts = normalizeVirtualPath(virtualPath).split("/")
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts.slice(0, index + 1).join("/")
    if (!current || entries.has(current)) continue
    entries.set(current, {
      name: parts[index] ?? current,
      path: current,
      type: "directory",
      size: 0,
    })
  }
}

function collectDirectoryEntries(
  entries: Map<string, VirtualWorkspaceEntry>,
  realDir: string,
  virtualDir: string,
): void {
  if (!fs.existsSync(realDir)) return

  addDirectoryChain(entries, virtualDir)

  const children = fs.readdirSync(realDir, { withFileTypes: true })
  for (const child of children) {
    const childRealPath = path.join(realDir, child.name)
    const childVirtualPath = normalizeVirtualPath(`${virtualDir}/${child.name}`)
    if (child.isDirectory()) {
      addDirectoryChain(entries, childVirtualPath)
      collectDirectoryEntries(entries, childRealPath, childVirtualPath)
      continue
    }

    const stat = fs.statSync(childRealPath)
    entries.set(childVirtualPath, {
      name: child.name,
      path: childVirtualPath,
      type: "file",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    })
  }
}

function resolveVirtualRealPath(pathValue: string): string | null {
  const normalized = normalizeVirtualPath(pathValue)
  if (normalized === VIRTUAL_HOME_ROOT) return os.homedir()
  if (!normalized.startsWith(VIRTUAL_PREFIX)) return null

  const relative = normalized.slice(VIRTUAL_PREFIX.length).replace(/^\/+/, "")
  const resolved = path.resolve(OPENCLAW_HOME, relative)
  if (!resolved.startsWith(path.resolve(OPENCLAW_HOME))) return null
  return resolved
}

function resolveWorkspaceRealPath(pathValue: string): string | null {
  const normalized = normalizeVirtualPath(pathValue)
  if (!normalized) return path.resolve(OPENCLAW_WORKSPACE_ROOT)

  const root = path.resolve(OPENCLAW_WORKSPACE_ROOT)
  const resolved = path.resolve(root, normalized)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  return resolved
}

function collectLocalWorkspaceEntries(
  entries: Map<string, VirtualWorkspaceEntry>,
  realDir: string,
  relativeDir = "",
): void {
  if (!fs.existsSync(realDir)) return

  const children = fs.readdirSync(realDir, { withFileTypes: true })
  for (const child of children) {
    const childRealPath = path.join(realDir, child.name)
    const childRelativePath = normalizeVirtualPath(
      relativeDir ? `${relativeDir}/${child.name}` : child.name,
    )

    if (child.isDirectory()) {
      entries.set(childRelativePath, {
        name: child.name,
        path: childRelativePath,
        type: "directory",
        size: 0,
      })
      collectLocalWorkspaceEntries(entries, childRealPath, childRelativePath)
      continue
    }

    const stat = fs.statSync(childRealPath)
    entries.set(childRelativePath, {
      name: child.name,
      path: childRelativePath,
      type: "file",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    })
  }
}

export function isVirtualWorkspacePath(pathValue: string): boolean {
  const normalized = normalizeVirtualPath(pathValue)
  return normalized === VIRTUAL_HOME_ROOT || normalized.startsWith(`${VIRTUAL_HOME_ROOT}/`)
}

export function hasLocalWorkspaceMirror(): boolean {
  return fs.existsSync(OPENCLAW_WORKSPACE_ROOT)
}

export function isLocalWorkspacePath(pathValue: string): boolean {
  if (!hasLocalWorkspaceMirror()) return false
  if (isVirtualWorkspacePath(pathValue)) return false

  const resolved = resolveWorkspaceRealPath(pathValue)
  return Boolean(resolved && fs.existsSync(resolved))
}

export function listLocalWorkspaceEntries(): VirtualWorkspaceEntry[] {
  const entries = new Map<string, VirtualWorkspaceEntry>()
  collectLocalWorkspaceEntries(entries, OPENCLAW_WORKSPACE_ROOT)
  return [...entries.values()]
}

export function listVirtualWorkspaceEntries(): VirtualWorkspaceEntry[] {
  const entries = new Map<string, VirtualWorkspaceEntry>()
  addDirectoryChain(entries, VIRTUAL_HOME_ROOT)

  const userSkillsDir = path.join(OPENCLAW_HOME, "skills")
  collectDirectoryEntries(entries, userSkillsDir, `${VIRTUAL_PREFIX}/skills`)

  const workspaceSkillsDir = path.join(OPENCLAW_HOME, "workspace", "skills")
  collectDirectoryEntries(
    entries,
    workspaceSkillsDir,
    `${VIRTUAL_PREFIX}/workspace/skills`,
  )

  return [...entries.values()]
}

export function readVirtualWorkspaceFile(pathValue: string): {
  content: string
  encoding: "utf-8"
} {
  const resolved = resolveVirtualRealPath(pathValue)
  if (!resolved) {
    throw new Error(`Virtual workspace path not found: ${pathValue}`)
  }

  const stat = fs.statSync(resolved)
  if (stat.isDirectory()) {
    throw new Error(`Workspace path is a directory: ${pathValue}`)
  }

  return {
    content: fs.readFileSync(resolved, "utf-8"),
    encoding: "utf-8",
  }
}

export function readLocalWorkspaceFile(pathValue: string): {
  content: string
  encoding: "utf-8"
} {
  const resolved = resolveWorkspaceRealPath(pathValue)
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`Workspace path not found: ${pathValue}`)
  }

  const stat = fs.statSync(resolved)
  if (stat.isDirectory()) {
    throw new Error(`Workspace path is a directory: ${pathValue}`)
  }

  return {
    content: fs.readFileSync(resolved, "utf-8"),
    encoding: "utf-8",
  }
}

export function writeLocalWorkspaceFile(
  pathValue: string,
  content: string,
): void {
  const resolved = resolveWorkspaceRealPath(pathValue)
  if (!resolved) {
    throw new Error(`Workspace path not found: ${pathValue}`)
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content, "utf-8")
}

export function createLocalWorkspaceDirectory(pathValue: string): void {
  const resolved = resolveWorkspaceRealPath(pathValue)
  if (!resolved) {
    throw new Error(`Workspace path not found: ${pathValue}`)
  }

  fs.mkdirSync(resolved, { recursive: true })
}

export function moveLocalWorkspaceEntry(
  fromPath: string,
  toPath: string,
): void {
  const fromResolved = resolveWorkspaceRealPath(fromPath)
  const toResolved = resolveWorkspaceRealPath(toPath)
  if (!fromResolved || !fs.existsSync(fromResolved)) {
    throw new Error(`Workspace path not found: ${fromPath}`)
  }
  if (!toResolved) {
    throw new Error(`Workspace path not found: ${toPath}`)
  }

  fs.mkdirSync(path.dirname(toResolved), { recursive: true })
  fs.renameSync(fromResolved, toResolved)
}

export function deleteLocalWorkspaceEntry(pathValue: string): void {
  const resolved = resolveWorkspaceRealPath(pathValue)
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`Workspace path not found: ${pathValue}`)
  }

  fs.rmSync(resolved, { recursive: true, force: false })
}
