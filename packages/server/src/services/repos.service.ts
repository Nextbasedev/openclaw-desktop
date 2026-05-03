import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execSync } from "node:child_process"
import { getDb } from "../db/connection.js"
import { generateId, nowIso } from "../db/helpers.js"
import { enqueue } from "../sync/outbox.js"
import { kickSyncEngine } from "../sync/engine.js"

type RepoEntry = {
  name: string
  path: string
  isRecent: boolean
  selectedAt?: string
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".cache",
  "AppData", ".vscode", ".idea", "dist", "build",
  ".npm", ".yarn", ".pnpm-store", ".cursor", ".codex",
])

const HOME_SUBDIRS = [
  "Desktop", "Documents", "projects", "repos",
  "dev", "code", "workspace", "src", "github", "work",
]

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  results: Map<string, string>,
  limit: number,
): void {
  if (depth > maxDepth || results.size >= limit) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.size >= limit) return
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)
    const gitDir = path.join(full, ".git")

    try {
      if (fs.existsSync(gitDir)) {
        const normalized = normalizePath(full)
        results.set(normalized, entry.name)
        continue
      }
    } catch {
      continue
    }

    scanDir(full, depth + 1, maxDepth, results, limit)
  }
}

function getDriveRoots(): string[] {
  if (os.platform() !== "win32") return []
  const roots: string[] = []
  for (const letter of "CDEFGH") {
    const drive = `${letter}:\\`
    try {
      if (fs.existsSync(drive)) {
        for (const sub of ["projects", "repos", "dev", "code", "work", "src"]) {
          const full = path.join(drive, sub)
          if (fs.existsSync(full)) roots.push(full)
        }
      }
    } catch {}
  }
  return roots
}

export function reposScan(input?: { extraPaths?: string[] }) {
  const home = os.homedir()
  const roots: string[] = [home]

  for (const rel of HOME_SUBDIRS) {
    const full = path.join(home, rel)
    if (fs.existsSync(full)) roots.push(full)
  }

  for (const driveRoot of getDriveRoots()) {
    roots.push(driveRoot)
  }

  if (input?.extraPaths) {
    for (const p of input.extraPaths) {
      if (fs.existsSync(p)) roots.push(p)
    }
  }

  const results = new Map<string, string>()

  for (const root of roots) {
    scanDir(root, 0, 3, results, 200)
  }

  const repos: RepoEntry[] = Array.from(results.entries())
    .map(([p, name]) => ({ name, path: p, isRecent: false }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { repos }
}

export function reposRecent(input?: { limit?: number }) {
  const db = getDb()
  const limit = input?.limit ?? 20
  const rows = db
    .prepare(
      "SELECT path, name, selected_at FROM recent_repos ORDER BY selected_at DESC LIMIT ?",
    )
    .all(limit) as Array<{ path: string; name: string; selected_at: string }>

  const repos: RepoEntry[] = rows.map((r) => ({
    name: r.name,
    path: r.path,
    isRecent: true,
    selectedAt: r.selected_at,
  }))

  return { repos }
}

export function reposSelect(input: { path: string; name: string }) {
  const db = getDb()
  const now = new Date().toISOString()
  const normalized = normalizePath(input.path)

  db.prepare(
    `INSERT INTO recent_repos (path, name, selected_at, use_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(path) DO UPDATE SET
       selected_at = excluded.selected_at,
       use_count = use_count + 1`,
  ).run(normalized, input.name, now)

  return { ok: true }
}

function getWorkspaceRoot(): string {
  return path.join(os.homedir(), ".openclaw", "workspace")
}

function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "")
  const lastSegment = cleaned.split("/").pop() ?? ""
  return lastSegment || "repo"
}

export function reposClone(input: {
  url: string
  name?: string
  targetDir?: string
}): { ok: true; name: string; path: string } {
  const url = input.url.trim()
  if (!url) throw new Error("Repository URL is required")

  const repoName = input.name?.trim() || repoNameFromUrl(url)
  const parentDir = input.targetDir?.trim() || getWorkspaceRoot()

  fs.mkdirSync(parentDir, { recursive: true })

  const dest = path.join(parentDir, repoName)
  if (fs.existsSync(dest)) {
    throw new Error(`Directory already exists: ${dest}`)
  }

  execSync(`git clone ${JSON.stringify(url)} ${JSON.stringify(dest)}`, {
    timeout: 120_000,
    stdio: "pipe",
  })

  const normalizedPath = normalizePath(dest)

  const db = getDb()
  const now = nowIso()
  db.prepare(
    `INSERT INTO recent_repos (path, name, selected_at, use_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(path) DO UPDATE SET
       selected_at = excluded.selected_at,
       use_count = use_count + 1`,
  ).run(normalizedPath, repoName, now)

  const existing = db
    .prepare("SELECT COUNT(*) as c FROM projects WHERE name = ? COLLATE NOCASE")
    .get(repoName) as { c: number }

  if (existing.c === 0) {
    const id = generateId("proj")
    db.prepare(
      "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)",
    ).run(id, repoName, "default", normalizedPath, normalizedPath, now, now)
    enqueue("project", id, "upsert")
    kickSyncEngine()
  }

  return { ok: true, name: repoName, path: normalizedPath }
}
