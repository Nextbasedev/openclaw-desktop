import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as fsService from "../../services/fs.service.js"

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-fs-"))
})

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true })
  } catch {}
})

describe("fsReadDir", () => {
  it("lists temp directory entries", () => {
    fs.writeFileSync(path.join(tempDir, "a.txt"), "aaa")
    fs.mkdirSync(path.join(tempDir, "sub"))

    const result = fsService.fsReadDir({ path: tempDir })
    expect(result.entries.length).toBeGreaterThanOrEqual(2)

    const fileEntry = result.entries.find(
      (e) => e.name === "a.txt",
    )
    expect(fileEntry?.isFile).toBe(true)
    expect(fileEntry?.isDir).toBe(false)
    expect(fileEntry?.size).toBe(3)
    expect(fileEntry?.modifiedAt).toBeTruthy()

    const dirEntry = result.entries.find(
      (e) => e.name === "sub",
    )
    expect(dirEntry?.isFile).toBe(false)
    expect(dirEntry?.isDir).toBe(true)
  })

  it("throws for nonexistent path", () => {
    expect(() =>
      fsService.fsReadDir({
        path: path.join(tempDir, "nope"),
      }),
    ).toThrow("Path not found")
  })

  it("throws for non-directory path", () => {
    const filePath = path.join(tempDir, "file.txt")
    fs.writeFileSync(filePath, "x")
    expect(() =>
      fsService.fsReadDir({ path: filePath }),
    ).toThrow("Not a directory")
  })
})

describe("fsReadFile", () => {
  it("reads a temp file", () => {
    const filePath = path.join(tempDir, "read-me.txt")
    fs.writeFileSync(filePath, "hello world")
    const result = fsService.fsReadFile({ path: filePath })
    expect(result.content).toBe("hello world")
    expect(result.encoding).toBe("utf-8")
  })

  it("reads binary file as base64", () => {
    const filePath = path.join(tempDir, "image.png")
    const data = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    fs.writeFileSync(filePath, data)
    const result = fsService.fsReadFile({ path: filePath })
    expect(result.encoding).toBe("base64")
    expect(result.content).toBe(data.toString("base64"))
  })

  it("throws for nonexistent file", () => {
    expect(() =>
      fsService.fsReadFile({
        path: path.join(tempDir, "ghost.txt"),
      }),
    ).toThrow("File not found")
  })

  it("rejects oversized files", () => {
    const filePath = path.join(tempDir, "huge.bin")
    const fd = fs.openSync(filePath, "w")
    const buf = Buffer.alloc(1, 0)
    fs.writeSync(fd, buf, 0, 1, 50 * 1024 * 1024)
    fs.closeSync(fd)

    expect(() =>
      fsService.fsReadFile({ path: filePath }),
    ).toThrow("exceeds maximum size")
  })
})

describe("fsWriteFile", () => {
  it("writes file and creates parent dirs", () => {
    const filePath = path.join(tempDir, "a/b/c/output.txt")
    const result = fsService.fsWriteFile({
      path: filePath,
      content: "deep content",
    })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("deep content")
  })
})

describe("fsCreateDir", () => {
  it("creates a directory", () => {
    const dirPath = path.join(tempDir, "newdir")
    const result = fsService.fsCreateDir({ path: dirPath })
    expect(result.ok).toBe(true)
    expect(fs.statSync(dirPath).isDirectory()).toBe(true)
  })

  it("creates directories recursively", () => {
    const dirPath = path.join(tempDir, "x/y/z")
    const result = fsService.fsCreateDir({
      path: dirPath,
      recursive: true,
    })
    expect(result.ok).toBe(true)
    expect(fs.statSync(dirPath).isDirectory()).toBe(true)
  })

  it("throws when non-recursive and parent missing", () => {
    const dirPath = path.join(tempDir, "no/parent/here")
    expect(() =>
      fsService.fsCreateDir({ path: dirPath, recursive: false }),
    ).toThrow()
  })
})

describe("fsRemove", () => {
  it("removes a file", () => {
    const filePath = path.join(tempDir, "delete-me.txt")
    fs.writeFileSync(filePath, "bye")
    const result = fsService.fsRemove({ path: filePath })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it("removes a directory recursively", () => {
    const dirPath = path.join(tempDir, "rmdir")
    fs.mkdirSync(path.join(dirPath, "sub"), { recursive: true })
    fs.writeFileSync(path.join(dirPath, "sub/file.txt"), "x")

    const result = fsService.fsRemove({
      path: dirPath,
      recursive: true,
    })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(dirPath)).toBe(false)
  })

  it("throws for nonexistent path", () => {
    expect(() =>
      fsService.fsRemove({
        path: path.join(tempDir, "nothing"),
      }),
    ).toThrow("Path not found")
  })

  it("throws when removing non-empty dir without recursive", () => {
    const dirPath = path.join(tempDir, "notempty")
    fs.mkdirSync(dirPath)
    fs.writeFileSync(path.join(dirPath, "child.txt"), "x")
    expect(() =>
      fsService.fsRemove({ path: dirPath, recursive: false }),
    ).toThrow()
  })
})

describe("fsRename", () => {
  it("moves a file", () => {
    const oldPath = path.join(tempDir, "before.txt")
    const newPath = path.join(tempDir, "after.txt")
    fs.writeFileSync(oldPath, "moving")

    const result = fsService.fsRename({ oldPath, newPath })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(oldPath)).toBe(false)
    expect(fs.readFileSync(newPath, "utf-8")).toBe("moving")
  })

  it("creates parent dirs for target", () => {
    const oldPath = path.join(tempDir, "src.txt")
    const newPath = path.join(tempDir, "new/dir/dest.txt")
    fs.writeFileSync(oldPath, "move deep")

    const result = fsService.fsRename({ oldPath, newPath })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(newPath, "utf-8")).toBe("move deep")
  })

  it("throws for nonexistent source", () => {
    expect(() =>
      fsService.fsRename({
        oldPath: path.join(tempDir, "nope.txt"),
        newPath: path.join(tempDir, "dest.txt"),
      }),
    ).toThrow("Source not found")
  })
})

describe("fsMetadata", () => {
  it("returns correct info for a file", () => {
    const filePath = path.join(tempDir, "meta.txt")
    fs.writeFileSync(filePath, "metadata test")
    const result = fsService.fsMetadata({ path: filePath })
    expect(result.isFile).toBe(true)
    expect(result.isDir).toBe(false)
    expect(result.size).toBe(13)
    expect(result.modifiedAt).toBeTruthy()
    expect(result.createdAt).toBeTruthy()
  })

  it("returns correct info for a directory", () => {
    const dirPath = path.join(tempDir, "metadir")
    fs.mkdirSync(dirPath)
    const result = fsService.fsMetadata({ path: dirPath })
    expect(result.isFile).toBe(false)
    expect(result.isDir).toBe(true)
  })

  it("throws for nonexistent path", () => {
    expect(() =>
      fsService.fsMetadata({
        path: path.join(tempDir, "ghost"),
      }),
    ).toThrow("Path not found")
  })
})

describe("fsSearch", () => {
  it("finds files by name", () => {
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, "src/index.ts"),
      "export {}",
    )
    fs.writeFileSync(
      path.join(tempDir, "src/utils.ts"),
      "export {}",
    )
    fs.writeFileSync(path.join(tempDir, "readme.md"), "# Hi")

    const result = fsService.fsSearch({
      path: tempDir,
      query: "index",
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].name).toBe("index.ts")
    expect(result.results[0].type).toBe("file")
  })

  it("respects maxResults", () => {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(
        path.join(tempDir, `match_${i}.txt`),
        "x",
      )
    }
    const result = fsService.fsSearch({
      path: tempDir,
      query: "match",
      maxResults: 3,
    })
    expect(result.results).toHaveLength(3)
  })

  it("throws for nonexistent path", () => {
    expect(() =>
      fsService.fsSearch({
        path: path.join(tempDir, "nope"),
        query: "anything",
      }),
    ).toThrow("Path not found")
  })

  it("finds directories too", () => {
    fs.mkdirSync(path.join(tempDir, "target_dir"), {
      recursive: true,
    })
    const result = fsService.fsSearch({
      path: tempDir,
      query: "target",
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].type).toBe("directory")
  })
})

describe("fsPrepareAttachment", () => {
  it("returns correct attachment for text file", () => {
    const filePath = path.join(tempDir, "doc.json")
    fs.writeFileSync(filePath, '{"key": "value"}')
    const result = fsService.fsPrepareAttachment({
      path: filePath,
    })
    expect(result.name).toBe("doc.json")
    expect(result.mimeType).toBe("application/json")
    expect(result.encoding).toBe("utf-8")
    expect(result.content).toBe('{"key": "value"}')
    expect(result.size).toBe(16)
  })

  it("returns correct attachment for binary file", () => {
    const filePath = path.join(tempDir, "icon.gif")
    const data = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    ])
    fs.writeFileSync(filePath, data)
    const result = fsService.fsPrepareAttachment({
      path: filePath,
    })
    expect(result.name).toBe("icon.gif")
    expect(result.mimeType).toBe("image/gif")
    expect(result.encoding).toBe("base64")
    expect(result.content).toBe(data.toString("base64"))
  })

  it("throws for nonexistent file", () => {
    expect(() =>
      fsService.fsPrepareAttachment({
        path: path.join(tempDir, "nope.txt"),
      }),
    ).toThrow("File not found")
  })
})
