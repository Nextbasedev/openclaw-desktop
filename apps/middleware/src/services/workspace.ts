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

function treeAt(root: string, rel = "") {
  const dir = assertInside(root, rel)
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => {
    const full = path.join(dir, e.name)
    const stat = fs.statSync(full)
    return { name: e.name, path: path.relative(root, full).replace(/\\/g, "/"), type: e.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: stat.mtime.toISOString() }
  })
  return { entries }
}

function readAt(root: string, rel: string) {
  const file = assertInside(root, rel)
  const content = fs.readFileSync(file, "utf8")
  return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } }
}

function contentTypeForPath(file: string) {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case ".avif": return "image/avif"
    case ".gif": return "image/gif"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".png": return "image/png"
    case ".svg": return "image/svg+xml"
    case ".webp": return "image/webp"
    case ".m4v": return "video/mp4"
    case ".avi": return "video/x-msvideo"
    case ".mkv": return "video/x-matroska"
    case ".mov": return "video/quicktime"
    case ".mp4": return "video/mp4"
    case ".ogg":
    case ".ogv": return "video/ogg"
    case ".webm": return "video/webm"
    default: return "application/octet-stream"
  }
}

function rawAt(root: string, rel: string) {
  const file = assertInside(root, rel)
  return { file, contentType: contentTypeForPath(file) }
}

function writeAt(root: string, rel: string, content: string) {
  const file = assertInside(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return { ok: true, path: rel }
}

export function workspaceRoutes(store: Store) {
  return {
    treeRoot: (rel = "") => treeAt(rootWorkspace(), rel),
    readRoot: (rel: string) => readAt(rootWorkspace(), rel),
    rawRoot: (rel: string) => rawAt(rootWorkspace(), rel),
    writeRoot: (rel: string, content: string) => writeAt(rootWorkspace(), rel, content),
    tree: (projectId: string, rel = "") => treeAt(projectRoot(store, projectId), rel),
    read: (projectId: string, rel: string) => readAt(projectRoot(store, projectId), rel),
    raw: (projectId: string, rel: string) => rawAt(projectRoot(store, projectId), rel),
    write: (projectId: string, rel: string, content: string) => writeAt(projectRoot(store, projectId), rel, content),
  }
}
