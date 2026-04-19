import { jest } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as memory from "../../services/memory.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string
let tempHome: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()

  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-mem-test-"))
  jest
    .spyOn(os, "homedir")
    .mockReturnValue(tempHome)

  const workspaceDir = path.join(tempHome, ".openclaw", "workspace")
  fs.mkdirSync(workspaceDir, { recursive: true })
})

afterEach(() => {
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
  jest.restoreAllMocks()
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {}
})

describe("memoryList", () => {
  it("returns documents (may be empty on fresh workspace)", () => {
    const result = memory.memoryList()
    expect(result).toHaveProperty("documents")
    expect(Array.isArray(result.documents)).toBe(true)
  })

  it("discovers MEMORY.md files in workspace", () => {
    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    fs.writeFileSync(path.join(wsRoot, "MEMORY.md"), "# Memory\n")

    const result = memory.memoryList()
    expect(result.documents.length).toBeGreaterThanOrEqual(1)
    const names = result.documents.map((d) => d.name)
    expect(names).toContain("MEMORY.md")
  })

  it("discovers files in memory/ subdirectory", () => {
    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const memDir = path.join(wsRoot, "memory")
    fs.mkdirSync(memDir, { recursive: true })
    fs.writeFileSync(path.join(memDir, "note.md"), "A note\n")

    const result = memory.memoryList()
    const names = result.documents.map((d) => d.name)
    expect(names).toContain("note.md")
  })
})

describe("memoryWrite and memoryRead", () => {
  it("creates file with content", () => {
    const result = memory.memoryWrite({
      path: "test-note.md",
      content: "Hello world",
    })
    expect(result.ok).toBe(true)
    expect(result.path).toBe("test-note.md")

    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const filePath = path.join(wsRoot, "test-note.md")
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it("reads written file", () => {
    memory.memoryWrite({
      path: "read-test.md",
      content: "Line one\nLine two\nLine three",
    })

    const result = memory.memoryRead({ path: "read-test.md" })
    expect(result.content).toContain("Line one")
    expect(result.content).toContain("Line two")
    expect(result.content).toContain("Line three")
    expect(result.path).toBe("read-test.md")
  })

  it("reads with line range", () => {
    memory.memoryWrite({
      path: "range-test.md",
      content: "Line1\nLine2\nLine3\nLine4\nLine5",
    })

    const result = memory.memoryRead({
      path: "range-test.md",
      startLine: 2,
      endLine: 4,
    })
    expect(result.content).toContain("Line2")
    expect(result.content).toContain("Line3")
    expect(result.content).toContain("Line4")
    expect(result.content).not.toContain("Line1")
    expect(result.content).not.toContain("Line5")
  })

  it("writes with category and importance frontmatter", () => {
    memory.memoryWrite({
      path: "meta-test.md",
      content: "Important fact",
      category: "fact",
      importance: 0.9,
    })

    const result = memory.memoryRead({ path: "meta-test.md" })
    expect(result.content).toContain("category: fact")
    expect(result.content).toContain("importance: 0.9")
    expect(result.content).toContain("Important fact")
  })

  it("rejects invalid category", () => {
    expect(() =>
      memory.memoryWrite({
        path: "bad-cat.md",
        content: "test",
        category: "invalid_category",
      }),
    ).toThrow("Invalid category")
  })

  it("rejects importance outside 0-1 (above)", () => {
    expect(() =>
      memory.memoryWrite({
        path: "bad-imp.md",
        content: "test",
        importance: 1.5,
      }),
    ).toThrow("Importance must be between 0 and 1")
  })

  it("rejects importance outside 0-1 (below)", () => {
    expect(() =>
      memory.memoryWrite({
        path: "bad-imp2.md",
        content: "test",
        importance: -0.1,
      }),
    ).toThrow("Importance must be between 0 and 1")
  })

  it("accepts boundary importance values (0 and 1)", () => {
    expect(() =>
      memory.memoryWrite({
        path: "bound-low.md",
        content: "test",
        importance: 0,
      }),
    ).not.toThrow()

    expect(() =>
      memory.memoryWrite({
        path: "bound-high.md",
        content: "test",
        importance: 1,
      }),
    ).not.toThrow()
  })
})

describe("memoryRead path safety", () => {
  it("rejects path traversal (../)", () => {
    expect(() =>
      memory.memoryRead({ path: "../../../etc/passwd" }),
    ).toThrow("Unsafe memory path")
  })

  it("rejects absolute path", () => {
    expect(() =>
      memory.memoryRead({ path: "/etc/passwd" }),
    ).toThrow("Unsafe memory path")
  })

  it("rejects embedded path traversal", () => {
    expect(() =>
      memory.memoryRead({ path: "memory/../../../etc/passwd" }),
    ).toThrow("Unsafe memory path")
  })

  it("throws for nonexistent file", () => {
    expect(() =>
      memory.memoryRead({ path: "does-not-exist.md" }),
    ).toThrow("Memory file not found")
  })
})

describe("memorySearch", () => {
  it("returns empty hits (placeholder)", () => {
    const result = memory.memorySearch({ query: "anything" })
    expect(result.query).toBe("anything")
    expect(result.hits).toEqual([])
  })
})

describe("memoryStore", () => {
  it("creates dated file in memory/ dir", () => {
    const result = memory.memoryStore({ content: "A stored memory" })
    expect(result.ok).toBe(true)
    expect(result.path).toMatch(/^memory\//)
    expect(result.path).toMatch(/\.md$/)

    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const fullPath = path.join(wsRoot, result.path)
    expect(fs.existsSync(fullPath)).toBe(true)

    const content = fs.readFileSync(fullPath, "utf-8")
    expect(content).toContain("A stored memory")
    expect(content).toContain("date:")
  })

  it("creates file with category and tags", () => {
    const result = memory.memoryStore({
      content: "Tagged memory",
      category: "decision",
      importance: 0.7,
      tags: ["architecture", "db"],
    })
    expect(result.ok).toBe(true)

    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const fullPath = path.join(wsRoot, result.path)
    const content = fs.readFileSync(fullPath, "utf-8")
    expect(content).toContain("category: decision")
    expect(content).toContain("importance: 0.7")
    expect(content).toContain("tags: [architecture, db]")
  })

  it("rejects invalid category", () => {
    expect(() =>
      memory.memoryStore({
        content: "test",
        category: "bogus",
      }),
    ).toThrow("Invalid category")
  })
})

describe("memoryRecall", () => {
  it("returns empty entries when no recall file exists", () => {
    const result = memory.memoryRecall()
    expect(result.entries).toEqual([])
  })

  it("returns entries sorted by totalScore", () => {
    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const dreamsDir = path.join(wsRoot, "dreams")
    fs.mkdirSync(dreamsDir, { recursive: true })

    const data = [
      { content: "low", totalScore: 0.1 },
      { content: "high", totalScore: 0.9 },
      { content: "mid", totalScore: 0.5 },
    ]
    fs.writeFileSync(
      path.join(dreamsDir, "short-term-recall.json"),
      JSON.stringify(data),
    )

    const result = memory.memoryRecall()
    expect(result.entries).toHaveLength(3)
    expect(result.entries[0].content).toBe("high")
    expect(result.entries[1].content).toBe("mid")
    expect(result.entries[2].content).toBe("low")
  })

  it("respects limit", () => {
    const wsRoot = path.join(tempHome, ".openclaw", "workspace")
    const dreamsDir = path.join(wsRoot, "dreams")
    fs.mkdirSync(dreamsDir, { recursive: true })

    const data = Array.from({ length: 10 }, (_, i) => ({
      content: `entry-${i}`,
      totalScore: i * 0.1,
    }))
    fs.writeFileSync(
      path.join(dreamsDir, "short-term-recall.json"),
      JSON.stringify(data),
    )

    const result = memory.memoryRecall({ limit: 3 })
    expect(result.entries).toHaveLength(3)
  })
})

describe("memoryReindex", () => {
  it("returns ok", () => {
    const result = memory.memoryReindex()
    expect(result.ok).toBe(true)
    expect(result.queued).toBe(false)
  })
})
