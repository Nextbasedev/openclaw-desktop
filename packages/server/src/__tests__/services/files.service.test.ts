import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as files from "../../services/files.service.js"
import * as projects from "../../services/projects.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string
let workspaceDir: string
let projectId: string

function setupProject() {
  const prof = profiles.profilesCreate({
    name: "TestProf",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: workspaceDir,
  }).profile
  const proj = projects.projectsCreate({
    name: "TestProject",
    profileId: prof.id,
    workspaceRoot: workspaceDir,
  }).project
  return proj.id
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()

  workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "jarvis-files-"),
  )
  projectId = setupProject()
})

afterEach(() => {
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  try {
    fs.rmSync(workspaceDir, { recursive: true })
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("filesTree", () => {
  it("lists directory contents", () => {
    fs.writeFileSync(path.join(workspaceDir, "hello.txt"), "hi")
    fs.mkdirSync(path.join(workspaceDir, "subdir"))

    const result = files.filesTree({
      projectId,
      path: ".",
    })
    expect(result.entries.length).toBeGreaterThanOrEqual(2)
    const names = result.entries.map((e) => e.name)
    expect(names).toContain("hello.txt")
    expect(names).toContain("subdir")

    const fileEntry = result.entries.find(
      (e) => e.name === "hello.txt",
    )
    expect(fileEntry?.type).toBe("file")
    expect(fileEntry?.size).toBe(2)
    expect(fileEntry?.modifiedAt).toBeTruthy()

    const dirEntry = result.entries.find(
      (e) => e.name === "subdir",
    )
    expect(dirEntry?.type).toBe("directory")
  })
})

describe("filesRead", () => {
  it("reads a file", () => {
    fs.writeFileSync(
      path.join(workspaceDir, "data.txt"),
      "file content here",
    )
    const result = files.filesRead({ projectId, path: "data.txt" })
    expect(result.file.content).toBe("file content here")
    expect(result.file.encoding).toBe("utf-8")
    expect(result.file.path).toBe("data.txt")
  })

  it("rejects file over 50MB", () => {
    // Create a file just over the limit using a sparse approach
    const filePath = path.join(workspaceDir, "huge.bin")
    const fd = fs.openSync(filePath, "w")
    // Write 1 byte at offset 50MB to create a sparse file
    const buf = Buffer.alloc(1, 0)
    fs.writeSync(fd, buf, 0, 1, 50 * 1024 * 1024)
    fs.closeSync(fd)

    expect(() =>
      files.filesRead({ projectId, path: "huge.bin" }),
    ).toThrow("exceeds maximum size")
  })

  it("throws for nonexistent file", () => {
    expect(() =>
      files.filesRead({ projectId, path: "ghost.txt" }),
    ).toThrow("File not found")
  })
})

describe("filesWrite", () => {
  it("creates a file and parent dirs", () => {
    const result = files.filesWrite({
      projectId,
      path: "deep/nested/dir/file.txt",
      content: "nested content",
    })
    expect(result.ok).toBe(true)

    const written = fs.readFileSync(
      path.join(workspaceDir, "deep/nested/dir/file.txt"),
      "utf-8",
    )
    expect(written).toBe("nested content")
  })
})

describe("filesMkdir", () => {
  it("creates nested directories", () => {
    const result = files.filesMkdir({
      projectId,
      path: "a/b/c",
    })
    expect(result.ok).toBe(true)

    const stat = fs.statSync(path.join(workspaceDir, "a/b/c"))
    expect(stat.isDirectory()).toBe(true)
  })
})

describe("filesRename", () => {
  it("moves a file", () => {
    fs.writeFileSync(
      path.join(workspaceDir, "old.txt"),
      "rename me",
    )
    const result = files.filesRename({
      projectId,
      from: "old.txt",
      to: "new.txt",
    })
    expect(result.ok).toBe(true)
    expect(
      fs.existsSync(path.join(workspaceDir, "old.txt")),
    ).toBe(false)
    expect(
      fs.readFileSync(path.join(workspaceDir, "new.txt"), "utf-8"),
    ).toBe("rename me")
  })
})

describe("filesDelete", () => {
  it("deletes a file", () => {
    fs.writeFileSync(
      path.join(workspaceDir, "doomed.txt"),
      "bye",
    )
    const result = files.filesDelete({
      projectId,
      path: "doomed.txt",
    })
    expect(result.ok).toBe(true)
    expect(
      fs.existsSync(path.join(workspaceDir, "doomed.txt")),
    ).toBe(false)
  })

  it("deletes a directory", () => {
    fs.mkdirSync(path.join(workspaceDir, "tempdir/sub"), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(workspaceDir, "tempdir/sub/file.txt"),
      "x",
    )
    const result = files.filesDelete({
      projectId,
      path: "tempdir",
    })
    expect(result.ok).toBe(true)
    expect(
      fs.existsSync(path.join(workspaceDir, "tempdir")),
    ).toBe(false)
  })
})

describe("filesSearch", () => {
  it("finds files by name", () => {
    fs.mkdirSync(path.join(workspaceDir, "src"), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(workspaceDir, "src/index.ts"),
      "export {}",
    )
    fs.writeFileSync(
      path.join(workspaceDir, "src/utils.ts"),
      "export {}",
    )
    fs.writeFileSync(
      path.join(workspaceDir, "readme.md"),
      "# Hi",
    )

    const result = files.filesSearch({
      projectId,
      query: "index",
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].name).toBe("index.ts")
    expect(result.results[0].type).toBe("file")
  })
})

describe("filesPrepareAttachment", () => {
  it("returns correct MIME type for text file", () => {
    fs.writeFileSync(
      path.join(workspaceDir, "notes.md"),
      "# Notes",
    )
    const result = files.filesPrepareAttachment({
      projectId,
      path: "notes.md",
    })
    expect(result.name).toBe("notes.md")
    expect(result.mimeType).toBe("text/markdown")
    expect(result.encoding).toBe("utf-8")
    expect(result.content).toBe("# Notes")
    expect(result.size).toBe(7)
  })

  it("returns correct MIME type for PNG", () => {
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    fs.writeFileSync(path.join(workspaceDir, "img.png"), pngData)
    const result = files.filesPrepareAttachment({
      projectId,
      path: "img.png",
    })
    expect(result.name).toBe("img.png")
    expect(result.mimeType).toBe("image/png")
    expect(result.encoding).toBe("base64")
    expect(result.content).toBe(pngData.toString("base64"))
    expect(result.size).toBe(8)
  })

  it("returns application/octet-stream for unknown extension", () => {
    fs.writeFileSync(
      path.join(workspaceDir, "data.xyz"),
      "something",
    )
    const result = files.filesPrepareAttachment({
      projectId,
      path: "data.xyz",
    })
    expect(result.mimeType).toBe("application/octet-stream")
  })
})

describe("path traversal protection", () => {
  it("rejects path that escapes project root", () => {
    expect(() =>
      files.filesRead({
        projectId,
        path: "../../etc/passwd",
      }),
    ).toThrow("Path escapes project root")
  })
})

describe("project not found", () => {
  it("throws for nonexistent project", () => {
    expect(() =>
      files.filesRead({
        projectId: "proj_nonexistent",
        path: "anything.txt",
      }),
    ).toThrow("Project not found")
  })
})

describe("unicode filenames", () => {
  it("handles unicode filenames", () => {
    const unicodeName = "\u6587\u4ef6_\u30c6\u30b9\u30c8.txt"
    fs.writeFileSync(
      path.join(workspaceDir, unicodeName),
      "unicode content",
    )

    const result = files.filesRead({
      projectId,
      path: unicodeName,
    })
    expect(result.file.content).toBe("unicode content")

    const tree = files.filesTree({ projectId, path: "." })
    const names = tree.entries.map((e) => e.name)
    expect(names).toContain(unicodeName)
  })
})
