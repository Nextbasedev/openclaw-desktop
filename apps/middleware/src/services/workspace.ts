import fs from "node:fs"
import path from "node:path"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"
import { assertInside } from "../lib/path-safe.js"

function projectRoot(store: Store, id: string) { const p = store.getProject(id); if (!p) throw new HttpError(404, "Project not found", "NOT_FOUND"); return p.workspaceRoot }
export function workspaceRoutes(store: Store) {
  return {
    tree: (projectId: string, rel = "") => { const root = projectRoot(store, projectId); const dir = assertInside(root, rel); const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => { const full = path.join(dir, e.name); const stat = fs.statSync(full); return { name: e.name, path: path.relative(root, full).replace(/\\/g, "/"), type: e.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: stat.mtime.toISOString() } }); return { entries } },
    read: (projectId: string, rel: string) => { const root = projectRoot(store, projectId); const file = assertInside(root, rel); return { file: { path: rel, content: fs.readFileSync(file, "utf8"), encoding: "utf-8" } } },
    write: (projectId: string, rel: string, content: string) => { const root = projectRoot(store, projectId); const file = assertInside(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return { ok: true, path: rel } },
  }
}
