import fs from "node:fs"
import path from "node:path"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"
import { assertInside } from "../lib/path-safe.js"

function rootWorkspace() {
  return process.env.WORKSPACE_ROOT || path.join(process.env.HOME || "/root", ".openclaw", "workspace")
}

function projectRoot(store: Store, id: string) {
  const p = store.getProject(id)
  if (!p) throw new HttpError(404, "Project not found", "NOT_FOUND")
  return p.workspaceRoot
}

function entryFor(root: string, full: string, stat = fs.statSync(full)) {
  return {
    name: path.basename(full),
    path: path.relative(root, full).replace(/\\/g, "/"),
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function treeAt(root: string, rel = "") {
  const dir = assertInside(root, rel)
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => {
    const full = path.join(dir, e.name)
    return entryFor(root, full)
  })
  return { entries }
}

function statAt(root: string, rel = "") {
  const full = assertInside(root, rel)
  return { entry: entryFor(root, full) }
}

function readAt(root: string, rel: string) {
  const file = assertInside(root, rel)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new HttpError(400, "Workspace path is not a file", "BAD_REQUEST")
  const content = fs.readFileSync(file, "utf8")
  return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } }
}

function writeAt(root: string, rel: string, content: string) {
  const file = assertInside(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return { ok: true, path: rel }
}

function mkdirAt(root: string, rel: string) {
  const dir = assertInside(root, rel)
  fs.mkdirSync(dir, { recursive: true })
  return { ok: true, path: rel }
}

function moveAt(root: string, fromRel: string, toRel: string) {
  const from = assertInside(root, fromRel)
  const to = assertInside(root, toRel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  return { ok: true, fromPath: fromRel, toPath: toRel }
}

function deleteAt(root: string, rel: string) {
  const target = assertInside(root, rel)
  fs.rmSync(target, { recursive: true, force: true })
  return { ok: true, path: rel }
}

function downloadAt(root: string, rel: string) {
  const file = assertInside(root, rel)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new HttpError(400, "Workspace path is not a file", "BAD_REQUEST")
  return { file, name: path.basename(file), size: stat.size }
}

function capabilities() {
  return {
    capabilities: {
      canTree: true,
      canStat: true,
      canRead: true,
      canWrite: true,
      canDownloadFile: true,
      canCreateDir: true,
      canMoveEntry: true,
      canDeleteEntry: true,
    },
  }
}

export function workspaceRoutes(store: Store) {
  return {
    capabilities,
    treeRoot: (rel = "") => treeAt(rootWorkspace(), rel),
    statRoot: (rel = "") => statAt(rootWorkspace(), rel),
    readRoot: (rel: string) => readAt(rootWorkspace(), rel),
    writeRoot: (rel: string, content: string) => writeAt(rootWorkspace(), rel, content),
    mkdirRoot: (rel: string) => mkdirAt(rootWorkspace(), rel),
    moveRoot: (fromRel: string, toRel: string) => moveAt(rootWorkspace(), fromRel, toRel),
    deleteRoot: (rel: string) => deleteAt(rootWorkspace(), rel),
    downloadRoot: (rel: string) => downloadAt(rootWorkspace(), rel),
    tree: (projectId: string, rel = "") => treeAt(projectRoot(store, projectId), rel),
    stat: (projectId: string, rel = "") => statAt(projectRoot(store, projectId), rel),
    read: (projectId: string, rel: string) => readAt(projectRoot(store, projectId), rel),
    write: (projectId: string, rel: string, content: string) => writeAt(projectRoot(store, projectId), rel, content),
    mkdir: (projectId: string, rel: string) => mkdirAt(projectRoot(store, projectId), rel),
    move: (projectId: string, fromRel: string, toRel: string) => moveAt(projectRoot(store, projectId), fromRel, toRel),
    delete: (projectId: string, rel: string) => deleteAt(projectRoot(store, projectId), rel),
    download: (projectId: string, rel: string) => downloadAt(projectRoot(store, projectId), rel),
  }
}
