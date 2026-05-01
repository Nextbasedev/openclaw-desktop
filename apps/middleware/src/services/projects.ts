import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"

export function projectRoutes(store: Store) {
  return {
    list: () => ({ projects: store.listProjects() }),
    create: (body: any) => {
      const name = String(body?.name ?? "").trim(); const workspaceRoot = String(body?.workspaceRoot ?? "").trim()
      if (!name) throw new HttpError(400, "Project name is required", "BAD_REQUEST")
      if (!workspaceRoot) throw new HttpError(400, "workspaceRoot is required", "BAD_REQUEST")
      return { project: store.createProject({ name, workspaceRoot, repoRoot: body?.repoRoot ?? workspaceRoot }) }
    },
    update: (id: string, body: any) => {
      const project = store.updateProject(id, body ?? {})
      if (!project) throw new HttpError(404, "Project not found", "NOT_FOUND")
      return { project }
    },
    delete: (id: string) => ({ ok: store.deleteProject(id) }),
  }
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".cache", "target"])
function scanDir(dir: string, depth: number, out: Map<string,string>) {
  if (depth > 3 || out.size > 300) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (fs.existsSync(path.join(full, ".git"))) out.set(full, e.name)
    else scanDir(full, depth + 1, out)
  }
}
export function repoRoutes(store: Store, workspaceRoot: string) {
  return {
    recent: () => ({ repos: store.recentRepos() }),
    scan: () => { const out = new Map<string,string>(); for (const root of [workspaceRoot, os.homedir(), "/root/.openclaw/workspace"]) scanDir(root, 0, out); return { repos: [...out].map(([path,name]) => ({ path, name })) } },
    select: (body: any) => { const repoPath = String(body?.path ?? ""); const name = String(body?.name ?? path.basename(repoPath)); if (!repoPath) throw new HttpError(400, "path is required", "BAD_REQUEST"); return store.selectRepo({ path: repoPath, name }) },
  }
}
