import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { getDb } from "../db/connection.js"

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
