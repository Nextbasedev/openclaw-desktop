import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const VALID_CATEGORIES = [
  "preference",
  "fact",
  "decision",
  "entity",
  "other",
]

function openclawWorkspaceRoot(): string {
  return path.join(os.homedir(), ".openclaw", "workspace")
}

function isSafeMemoryPath(p: string): boolean {
  return !p.includes("..") && !p.startsWith("/")
}

function validateCategory(cat: string): void {
  if (!VALID_CATEGORIES.includes(cat)) {
    throw new Error(
      `Invalid category '${cat}'. Valid: ${VALID_CATEGORIES.join(", ")}`,
    )
  }
}

function readLinesRange(
  content: string,
  start: number,
  end: number,
): string {
  return content
    .split("\n")
    .filter((_, i) => {
      const ln = i + 1
      return ln >= start && ln <= end
    })
    .join("\n")
}

function resolveMemoryPath(filePath: string): string {
  if (filePath.startsWith("project:")) {
    const rest = filePath.slice("project:".length)
    if (!isSafeMemoryPath(rest)) {
      throw new Error("Unsafe memory path")
    }
    return path.join(openclawWorkspaceRoot(), rest)
  }
  if (!isSafeMemoryPath(filePath)) {
    throw new Error("Unsafe memory path")
  }
  return path.join(openclawWorkspaceRoot(), filePath)
}

function scanMemoryFiles(
  dir: string,
): Array<{ path: string; name: string; size: number }> {
  const results: Array<{ path: string; name: string; size: number }> = []
  if (!fs.existsSync(dir)) return results

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = fs.statSync(fullPath)
        results.push({
          path: path.relative(openclawWorkspaceRoot(), fullPath),
          name: entry.name,
          size: stat.size,
        })
      } else if (entry.isDirectory() && entry.name === "memory") {
        const subEntries = fs.readdirSync(fullPath, {
          withFileTypes: true,
        })
        for (const sub of subEntries) {
          if (sub.isFile() && sub.name.endsWith(".md")) {
            const subPath = path.join(fullPath, sub.name)
            const stat = fs.statSync(subPath)
            results.push({
              path: path.relative(openclawWorkspaceRoot(), subPath),
              name: sub.name,
              size: stat.size,
            })
          }
        }
      }
    }
  } catch {
    /* ignore read errors */
  }

  return results
}

export function memoryList(input?: { projectId?: string }) {
  const root = openclawWorkspaceRoot()
  const documents = scanMemoryFiles(root)
  return { documents }
}

export function memoryRead(input: {
  path: string
  startLine?: number
  endLine?: number
}) {
  const resolved = resolveMemoryPath(input.path)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Memory file not found: ${input.path}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Memory path is a directory: ${input.path}`)
  }

  let content = fs.readFileSync(resolved, "utf-8")

  if (input.startLine !== undefined && input.endLine !== undefined) {
    content = readLinesRange(content, input.startLine, input.endLine)
  }

  return { content, path: input.path }
}

export function memoryWrite(input: {
  path: string
  content: string
  category?: string
  importance?: number
}) {
  if (!isSafeMemoryPath(input.path)) {
    throw new Error("Unsafe memory path")
  }

  if (input.category) {
    validateCategory(input.category)
  }

  if (input.importance !== undefined) {
    if (input.importance < 0 || input.importance > 1) {
      throw new Error("Importance must be between 0 and 1")
    }
  }

  const resolved = path.join(openclawWorkspaceRoot(), input.path)
  const dir = path.dirname(resolved)
  fs.mkdirSync(dir, { recursive: true })

  let body = input.content
  if (input.category || input.importance !== undefined) {
    const frontmatter: string[] = ["---"]
    if (input.category) frontmatter.push(`category: ${input.category}`)
    if (input.importance !== undefined) {
      frontmatter.push(`importance: ${input.importance}`)
    }
    frontmatter.push("---")
    body = frontmatter.join("\n") + "\n" + input.content
  }

  fs.writeFileSync(resolved, body, "utf-8")
  return { ok: true, path: input.path }
}

export function memorySearch(input: { query: string; limit?: number }) {
  return { query: input.query, hits: [] }
}

export function memoryStore(input: {
  content: string
  category?: string
  importance?: number
  tags?: string[]
}) {
  if (input.category) {
    validateCategory(input.category)
  }

  if (input.importance !== undefined) {
    if (input.importance < 0 || input.importance > 1) {
      throw new Error("Importance must be between 0 and 1")
    }
  }

  const root = openclawWorkspaceRoot()
  const memoryDir = path.join(root, "memory")
  fs.mkdirSync(memoryDir, { recursive: true })

  const now = new Date()
  const dateStr = now.toISOString().replace(/[:.]/g, "-")
  const filename = `${dateStr}.md`
  const filePath = path.join(memoryDir, filename)

  const frontmatter: string[] = ["---"]
  frontmatter.push(`date: ${now.toISOString()}`)
  if (input.category) frontmatter.push(`category: ${input.category}`)
  if (input.importance !== undefined) {
    frontmatter.push(`importance: ${input.importance}`)
  }
  if (input.tags && input.tags.length > 0) {
    frontmatter.push(`tags: [${input.tags.join(", ")}]`)
  }
  frontmatter.push("---")

  const body = frontmatter.join("\n") + "\n" + input.content
  fs.writeFileSync(filePath, body, "utf-8")

  return { ok: true, path: `memory/${filename}` }
}

export function memoryRecall(input?: { path?: string; limit?: number }) {
  const root = openclawWorkspaceRoot()
  const recallPath = path.join(
    root,
    "dreams",
    "short-term-recall.json",
  )

  if (!fs.existsSync(recallPath)) {
    return { entries: [] }
  }

  try {
    const raw = fs.readFileSync(recallPath, "utf-8")
    const data = JSON.parse(raw) as Array<{
      content: string
      totalScore: number
      [key: string]: unknown
    }>

    const sorted = data.sort(
      (a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0),
    )
    const limit = input?.limit ?? 50
    return { entries: sorted.slice(0, limit) }
  } catch {
    return { entries: [] }
  }
}

export function memoryReindex() {
  return { ok: true, queued: false }
}
