import fs from "node:fs"
import path from "node:path"
import { getDb } from "../db/connection.js"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

function resolveProjectPath(
  projectId: string,
  relativePath: string,
): string {
  const db = getDb()
  const row = db
    .prepare("SELECT workspace_root FROM projects WHERE id = ?")
    .get(projectId) as { workspace_root: string } | undefined
  if (!row) throw new Error(`Project not found: ${projectId}`)
  const resolved = path.resolve(row.workspace_root, relativePath)
  if (!resolved.startsWith(row.workspace_root))
    throw new Error("Path escapes project root")
  return resolved
}

function mimeFromExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".html": "text/html",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".csv": "text/csv",
    ".py": "text/x-python",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".java": "text/x-java",
  }
  return map[ext] ?? "application/octet-stream"
}

function isBinaryExt(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  const binary = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".ico",
    ".webp",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".rar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp3",
    ".mp4",
    ".wav",
    ".avi",
    ".mov",
  ])
  return binary.has(ext)
}

export function filesTree(input: {
  projectId: string
  path: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  if (!fs.existsSync(resolved))
    throw new Error(`Path not found: ${input.path}`)
  const stat = fs.statSync(resolved)
  if (!stat.isDirectory())
    throw new Error(`Not a directory: ${input.path}`)

  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  const items = entries.map((entry) => {
    const fullPath = path.join(resolved, entry.name)
    const relativeTo = path.relative(
      resolveProjectPath(input.projectId, ""),
      fullPath,
    )
    let size = 0
    let modifiedAt: string | undefined
    try {
      const s = fs.statSync(fullPath)
      size = s.size
      modifiedAt = s.mtime.toISOString()
    } catch {}
    return {
      name: entry.name,
      path: relativeTo,
      type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      size,
      modifiedAt,
    }
  })

  return { entries: items }
}

export function filesRead(input: {
  projectId: string
  path: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  if (!fs.existsSync(resolved))
    throw new Error(`File not found: ${input.path}`)
  const stat = fs.statSync(resolved)
  if (stat.size > MAX_FILE_SIZE)
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
    )

  const content = fs.readFileSync(resolved, "utf-8")
  return {
    file: { path: input.path, content, encoding: "utf-8" as const },
  }
}

export function filesPrepareAttachment(input: {
  projectId: string
  path: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  if (!fs.existsSync(resolved))
    throw new Error(`File not found: ${input.path}`)
  const stat = fs.statSync(resolved)
  if (stat.size > MAX_FILE_SIZE)
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
    )

  const filename = path.basename(resolved)
  const mimeType = mimeFromExtension(filename)
  const binary = isBinaryExt(filename)
  const encoding = binary ? ("base64" as const) : ("utf-8" as const)
  const content = binary
    ? fs.readFileSync(resolved).toString("base64")
    : fs.readFileSync(resolved, "utf-8")

  return {
    name: filename,
    mimeType,
    content,
    encoding,
    size: stat.size,
  }
}

export function filesWrite(input: {
  projectId: string
  path: string
  content: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  const dir = path.dirname(resolved)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolved, input.content, "utf-8")
  return { ok: true, path: input.path }
}

export function filesMkdir(input: {
  projectId: string
  path: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  fs.mkdirSync(resolved, { recursive: true })
  return { ok: true, path: input.path }
}

export function filesRename(input: {
  projectId: string
  from: string
  to: string
}) {
  const resolvedFrom = resolveProjectPath(input.projectId, input.from)
  const resolvedTo = resolveProjectPath(input.projectId, input.to)
  if (!fs.existsSync(resolvedFrom))
    throw new Error(`Source not found: ${input.from}`)
  const toDir = path.dirname(resolvedTo)
  fs.mkdirSync(toDir, { recursive: true })
  fs.renameSync(resolvedFrom, resolvedTo)
  return { ok: true, from: input.from, to: input.to }
}

export function filesDelete(input: {
  projectId: string
  path: string
}) {
  const resolved = resolveProjectPath(input.projectId, input.path)
  if (!fs.existsSync(resolved))
    throw new Error(`Path not found: ${input.path}`)
  const stat = fs.statSync(resolved)
  if (stat.isDirectory()) {
    fs.rmSync(resolved, { recursive: true })
  } else {
    fs.unlinkSync(resolved)
  }
  return { ok: true, path: input.path }
}

export function filesSearch(input: {
  projectId: string
  query: string
}) {
  const root = resolveProjectPath(input.projectId, "")
  const results: Array<{ name: string; path: string; type: string }> =
    []
  const maxResults = 500
  const maxDepth = 6
  const lowerQuery = input.query.toLowerCase()

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= maxResults) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(root, fullPath)
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? "directory" : "file",
        })
      }
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      }
    }
  }

  walk(root, 0)
  return { results }
}
