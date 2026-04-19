import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

let onDataCb: ((data: string) => void) | null = null
let onExitCb: ((e: { exitCode: number }) => void) | null = null
let writeMock: ReturnType<typeof jest.fn>
let resizeMock: ReturnType<typeof jest.fn>
let killMock: ReturnType<typeof jest.fn>

function createMockPty() {
  writeMock = jest.fn()
  resizeMock = jest.fn()
  killMock = jest.fn()
  return {
    pid: 12345,
    cols: 120,
    rows: 30,
    process: "bash",
    handleFlowControl: false,
    onData: jest.fn((cb: (data: string) => void) => {
      onDataCb = cb
      return { dispose: jest.fn() }
    }),
    onExit: jest.fn((cb: (e: { exitCode: number }) => void) => {
      onExitCb = cb
      return { dispose: jest.fn() }
    }),
    write: writeMock,
    resize: resizeMock,
    kill: killMock,
    pause: jest.fn(),
    resume: jest.fn(),
    clear: jest.fn(),
  }
}

const spawnMock = jest.fn(createMockPty)

jest.unstable_mockModule("node-pty", () => ({
  spawn: spawnMock,
}))

let terminal: typeof import("../../services/terminal.service.js")
let profiles: typeof import("../../services/profiles.service.js")
let projects: typeof import("../../services/projects.service.js")
let connection: typeof import("../../db/connection.js")

beforeAll(async () => {
  terminal = await import("../../services/terminal.service.js")
  profiles = await import("../../services/profiles.service.js")
  projects = await import("../../services/projects.service.js")
  connection = await import("../../db/connection.js")
})

let testDbPath: string
let tempDir: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-term-"))
  onDataCb = null
  onExitCb = null
  spawnMock.mockClear()
  spawnMock.mockImplementation(createMockPty)
  terminal._getActiveTerminals().clear()
})

afterEach(() => {
  terminal._getActiveTerminals().clear()
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  try { fs.rmSync(tempDir, { recursive: true }) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

function createTestProject() {
  const profile = profiles.profilesCreate({
    name: "Test Profile",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: tempDir,
  })
  const project = projects.projectsCreate({
    name: "Test Project",
    profileId: profile.profile.id,
    workspaceRoot: tempDir,
  })
  return { profileId: profile.profile.id, projectId: project.project.id }
}

describe("terminalCreate", () => {
  it("creates a terminal session and stores in DB", async () => {
    const { projectId } = createTestProject()
    const result = await terminal.terminalCreate({ projectId })
    expect(result.terminal.id).toMatch(/^term_/)
    expect(result.terminal.projectId).toBe(projectId)
    expect(result.terminal.title).toBe("Terminal")
    expect(result.terminal.cwd).toBe(tempDir)
    expect(result.terminal.status).toBe("running")
    expect(result.terminal.runtimeId).toMatch(/^rt_/)
  })

  it("uses custom title and cwd", async () => {
    const { projectId } = createTestProject()
    const subDir = path.join(tempDir, "sub")
    fs.mkdirSync(subDir)
    const result = await terminal.terminalCreate({
      projectId, title: "My Shell", cwd: subDir, cols: 200, rows: 50,
    })
    expect(result.terminal.title).toBe("My Shell")
    expect(result.terminal.cwd).toBe(subDir)
    expect(spawnMock).toHaveBeenCalled()
  })

  it("throws for invalid project", async () => {
    createTestProject()
    await expect(terminal.terminalCreate({ projectId: "nonexistent" })).rejects.toThrow("Project not found")
  })

  it("throws for invalid cwd", async () => {
    const { projectId } = createTestProject()
    await expect(terminal.terminalCreate({ projectId, cwd: "/nonexistent/xyz" })).rejects.toThrow("Directory not found")
  })

  it("throws when cwd is a file", async () => {
    const { projectId } = createTestProject()
    const filePath = path.join(tempDir, "afile.txt")
    fs.writeFileSync(filePath, "content")
    await expect(terminal.terminalCreate({ projectId, cwd: filePath })).rejects.toThrow("Not a directory")
  })

  it("throws when MAX_SESSIONS limit reached", async () => {
    const { projectId } = createTestProject()
    for (let i = 0; i < terminal.MAX_SESSIONS; i++) {
      await terminal.terminalCreate({ projectId })
    }
    await expect(terminal.terminalCreate({ projectId })).rejects.toThrow("Maximum session limit reached")
  })
})

describe("terminalList", () => {
  it("returns empty list when no terminals exist", () => {
    const { projectId } = createTestProject()
    const result = terminal.terminalList({ projectId })
    expect(result.terminals).toEqual([])
  })

  it("lists terminals for a project", async () => {
    const { projectId } = createTestProject()
    await terminal.terminalCreate({ projectId, title: "First" })
    await terminal.terminalCreate({ projectId, title: "Second" })
    const result = terminal.terminalList({ projectId })
    expect(result.terminals).toHaveLength(2)
  })
})

describe("terminalWrite", () => {
  it("writes data and updates last_active_at", async () => {
    const { projectId } = createTestProject()
    const created = await terminal.terminalCreate({ projectId })
    const result = terminal.terminalWrite({ sessionId: created.terminal.id, data: "ls -la\n" })
    expect(result.ok).toBe(true)
    expect(writeMock).toHaveBeenCalledWith("ls -la\n")
  })

  it("throws for unknown session", () => {
    createTestProject()
    expect(() => terminal.terminalWrite({ sessionId: "nonexistent", data: "hello" })).toThrow("not found or not active")
  })
})

describe("terminalResize", () => {
  it("resizes the PTY", async () => {
    const { projectId } = createTestProject()
    const created = await terminal.terminalCreate({ projectId })
    const result = terminal.terminalResize({ sessionId: created.terminal.id, cols: 200, rows: 50 })
    expect(result.ok).toBe(true)
    expect(resizeMock).toHaveBeenCalledWith(200, 50)
  })

  it("throws for unknown session", () => {
    createTestProject()
    expect(() => terminal.terminalResize({ sessionId: "nonexistent", cols: 80, rows: 24 })).toThrow("not found or not active")
  })
})

describe("terminalClose", () => {
  it("kills PTY, removes from map, sets status=closed", async () => {
    const { projectId } = createTestProject()
    const created = await terminal.terminalCreate({ projectId })
    const sessionId = created.terminal.id
    const result = terminal.terminalClose({ sessionId })
    expect(result.ok).toBe(true)
    expect(terminal._getActiveTerminals().has(sessionId)).toBe(false)
    const db = connection.getDb()
    const row = db.prepare("SELECT status FROM terminal_sessions WHERE id = ?").get(sessionId) as { status: string }
    expect(row.status).toBe("closed")
  })

  it("throws for unknown session", () => {
    createTestProject()
    expect(() => terminal.terminalClose({ sessionId: "nonexistent" })).toThrow("not found or not active")
  })
})

describe("terminalEvents", () => {
  it("emits output events on PTY data", async () => {
    const { projectId } = createTestProject()
    const created = await terminal.terminalCreate({ projectId })
    const sessionId = created.terminal.id
    const received: unknown[] = []
    terminal.terminalEvents.on(`terminal:output:${sessionId}`, (evt) => received.push(evt))
    if (onDataCb) onDataCb("hello world")
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ sessionId, data: "hello world" })
    terminal.terminalEvents.removeAllListeners()
  })

  it("emits exit events on PTY exit", async () => {
    const { projectId } = createTestProject()
    const created = await terminal.terminalCreate({ projectId })
    const sessionId = created.terminal.id
    const received: unknown[] = []
    terminal.terminalEvents.on(`terminal:exit:${sessionId}`, (evt) => received.push(evt))
    if (onExitCb) onExitCb({ exitCode: 0 })
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ sessionId, code: 0 })
    expect(terminal._getActiveTerminals().has(sessionId)).toBe(false)
    terminal.terminalEvents.removeAllListeners()
  })
})
