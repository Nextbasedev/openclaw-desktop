import fs from "node:fs"
import path from "node:path"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

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

export function fsReadDir(input: { path: string }) {
  if (!fs.existsSync(input.path))
    throw new Error(`Path not found: ${input.path}`)
  const stat = fs.statSync(input.path)
  if (!stat.isDirectory())
    throw new Error(`Not a directory: ${input.path}`)

  const entries = fs.readdirSync(input.path, { withFileTypes: true })
  const items = entries.map((entry) => {
    const fullPath = path.join(input.path, entry.name)
    let size = 0
    let modifiedAt: string | undefined
    try {
      const s = fs.statSync(fullPath)
      size = s.size
      modifiedAt = s.mtime.toISOString()
    } catch {}
    return {
      name: entry.name,
      path: fullPath,
      isFile: entry.isFile(),
      isDir: entry.isDirectory(),
      size,
      modifiedAt,
    }
  })

  return { entries: items }
}

export function fsReadFile(input: { path: string }) {
  if (!fs.existsSync(input.path))
    throw new Error(`File not found: ${input.path}`)
  const stat = fs.statSync(input.path)
  if (stat.size > MAX_FILE_SIZE)
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
    )

  const binary = isBinaryExt(input.path)
  const encoding = binary ? ("base64" as const) : ("utf-8" as const)
  const content = binary
    ? fs.readFileSync(input.path).toString("base64")
    : fs.readFileSync(input.path, "utf-8")

  return { content, encoding }
}

export function fsPrepareAttachment(input: { path: string }) {
  if (!fs.existsSync(input.path))
    throw new Error(`File not found: ${input.path}`)
  const stat = fs.statSync(input.path)
  if (stat.size > MAX_FILE_SIZE)
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
    )

  const filename = path.basename(input.path)
  const mimeType = mimeFromExtension(filename)
  const binary = isBinaryExt(filename)
  const encoding = binary ? ("base64" as const) : ("utf-8" as const)
  const content = binary
    ? fs.readFileSync(input.path).toString("base64")
    : fs.readFileSync(input.path, "utf-8")

  return {
    name: filename,
    mimeType,
    content,
    encoding,
    size: stat.size,
  }
}

export function fsWriteFile(input: {
  path: string
  content: string
}) {
  const dir = path.dirname(input.path)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(input.path, input.content, "utf-8")
  return { ok: true, path: input.path }
}

export function fsCreateDir(input: {
  path: string
  recursive?: boolean
}) {
  const recursive = input.recursive ?? false
  fs.mkdirSync(input.path, { recursive })
  return { ok: true, path: input.path }
}

export function fsRemove(input: {
  path: string
  recursive?: boolean
}) {
  if (!fs.existsSync(input.path))
    throw new Error(`Path not found: ${input.path}`)
  const stat = fs.statSync(input.path)
  if (stat.isDirectory()) {
    fs.rmSync(input.path, { recursive: input.recursive ?? false })
  } else {
    fs.unlinkSync(input.path)
  }
  return { ok: true, path: input.path }
}

export function fsRename(input: {
  oldPath: string
  newPath: string
}) {
  if (!fs.existsSync(input.oldPath))
    throw new Error(`Source not found: ${input.oldPath}`)
  const dir = path.dirname(input.newPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.renameSync(input.oldPath, input.newPath)
  return { ok: true, oldPath: input.oldPath, newPath: input.newPath }
}

export function fsMetadata(input: { path: string }) {
  if (!fs.existsSync(input.path))
    throw new Error(`Path not found: ${input.path}`)
  const stat = fs.statSync(input.path)
  return {
    isFile: stat.isFile(),
    isDir: stat.isDirectory(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  }
}

export function fsSearch(input: {
  path: string
  query: string
  maxResults?: number
}) {
  if (!fs.existsSync(input.path))
    throw new Error(`Path not found: ${input.path}`)

  const maxResults = input.maxResults ?? 500
  const maxDepth = 10
  const lowerQuery = input.query.toLowerCase()
  const results: Array<{ name: string; path: string; type: string }> =
    []

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
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? "directory" : "file",
        })
      }
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      }
    }
  }

  walk(input.path, 0)
  return { results }
}
