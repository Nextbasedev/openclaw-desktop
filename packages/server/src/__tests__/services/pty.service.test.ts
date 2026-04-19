import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

// ── Mock node-pty before any service imports (ESM-compatible) ───────
let onDataCb: ((data: string) => void) | null = null
let onExitCb: (() => void) | null = null
let lastWriteMock: jest.Mock
let lastResizeMock: jest.Mock
let lastKillMock: jest.Mock

function createMockPty() {
  lastWriteMock = jest.fn()
  lastResizeMock = jest.fn()
  lastKillMock = jest.fn()
  return {
    pid: 99999,
    cols: 80,
    rows: 24,
    process: "sh",
    handleFlowControl: false,
    onData: jest.fn((cb: (data: string) => void) => {
      onDataCb = cb
      return { dispose: jest.fn() }
    }),
    onExit: jest.fn((cb: () => void) => {
      onExitCb = cb
      return { dispose: jest.fn() }
    }),
    write: lastWriteMock,
    resize: lastResizeMock,
    kill: lastKillMock,
    pause: jest.fn(),
    resume: jest.fn(),
    clear: jest.fn(),
  }
}

const spawnMock = jest.fn(createMockPty)

jest.unstable_mockModule("node-pty", () => ({
  spawn: spawnMock,
}))

// Dynamic imports after mock registration
let ptyService: typeof import("../../services/pty.service.js")
let connection: typeof import("../../db/connection.js")

beforeAll(async () => {
  ptyService = await import("../../services/pty.service.js")
  connection = await import("../../db/connection.js")
})

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()

  onDataCb = null
  onExitCb = null
  spawnMock.mockClear()
  spawnMock.mockImplementation(createMockPty)

  ptyService._getActivePtys().clear()
})

afterEach(() => {
  ptyService._getActivePtys().clear()
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("ptySpawn", () => {
  it("spawns a PTY and returns ptyId and cwd", async () => {
    const result = await ptyService.ptySpawn({})

    expect(result.ptyId).toMatch(/^pty_/)
    expect(result.cwd).toBe(process.cwd())
  })

  it("uses custom cwd, cols, rows", async () => {
    const tmpDir = os.tmpdir()
    const result = await ptyService.ptySpawn({
      cwd: tmpDir,
      cols: 160,
      rows: 48,
    })

    expect(result.cwd).toBe(tmpDir)

    const spawnCall = spawnMock.mock.calls[0]
    expect(spawnCall[2].cols).toBe(160)
    expect(spawnCall[2].rows).toBe(48)
    expect(spawnCall[2].cwd).toBe(tmpDir)
  })

  it("stores PTY handle in active map", async () => {
    const result = await ptyService.ptySpawn({})
    const handle = ptyService._getActivePtys().get(result.ptyId)
    expect(handle).toBeDefined()
    expect(handle!.cwd).toBe(process.cwd())
  })

  it("uses default cols=80 and rows=24", async () => {
    await ptyService.ptySpawn({})

    const spawnCall = spawnMock.mock.calls[0]
    expect(spawnCall[2].cols).toBe(80)
    expect(spawnCall[2].rows).toBe(24)
  })

  it("throws when MAX_SESSIONS limit is reached", async () => {
    for (let i = 0; i < 20; i++) {
      await ptyService.ptySpawn({})
    }

    await expect(ptyService.ptySpawn({})).rejects.toThrow(
      "Maximum session limit reached",
    )
  })
})

describe("ptyWrite", () => {
  it("writes data to the PTY", async () => {
    const { ptyId } = await ptyService.ptySpawn({})

    const result = ptyService.ptyWrite({
      ptyId,
      data: "echo hello\n",
    })
    expect(result.ok).toBe(true)
    expect(lastWriteMock).toHaveBeenCalledWith("echo hello\n")
  })

  it("throws for unknown ptyId", () => {
    expect(() =>
      ptyService.ptyWrite({ ptyId: "nonexistent", data: "test" }),
    ).toThrow("PTY not found")
  })
})

describe("ptyResize", () => {
  it("resizes the PTY", async () => {
    const { ptyId } = await ptyService.ptySpawn({})

    const result = ptyService.ptyResize({
      ptyId,
      cols: 200,
      rows: 60,
    })
    expect(result.ok).toBe(true)
    expect(lastResizeMock).toHaveBeenCalledWith(200, 60)
  })

  it("throws for unknown ptyId", () => {
    expect(() =>
      ptyService.ptyResize({
        ptyId: "nonexistent",
        cols: 80,
        rows: 24,
      }),
    ).toThrow("PTY not found")
  })
})

describe("ptyKill", () => {
  it("kills PTY and removes from map", async () => {
    const { ptyId } = await ptyService.ptySpawn({})

    const result = ptyService.ptyKill({ ptyId })
    expect(result.ok).toBe(true)
    expect(result.ptyId).toBe(ptyId)
    expect(ptyService._getActivePtys().has(ptyId)).toBe(false)
  })

  it("throws for unknown ptyId", () => {
    expect(() =>
      ptyService.ptyKill({ ptyId: "nonexistent" }),
    ).toThrow("PTY not found")
  })
})

describe("ptyEvents", () => {
  it("emits pty:data events on PTY data", async () => {
    const { ptyId } = await ptyService.ptySpawn({})

    const received: unknown[] = []
    ptyService.ptyEvents.on(`pty:data:${ptyId}`, (evt) =>
      received.push(evt),
    )

    if (onDataCb) onDataCb("output text")

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ ptyId, data: "output text" })

    ptyService.ptyEvents.removeAllListeners()
  })

  it("emits pty:exit events on PTY exit", async () => {
    const { ptyId } = await ptyService.ptySpawn({})

    const received: unknown[] = []
    ptyService.ptyEvents.on(`pty:exit:${ptyId}`, (evt) =>
      received.push(evt),
    )

    if (onExitCb) onExitCb()

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ ptyId })

    expect(ptyService._getActivePtys().has(ptyId)).toBe(false)

    ptyService.ptyEvents.removeAllListeners()
  })
})

describe("shell detection", () => {
  it("uses $SHELL env var when set", async () => {
    const original = process.env.SHELL
    process.env.SHELL = "/usr/bin/zsh"

    await ptyService.ptySpawn({})

    expect(spawnMock.mock.calls[0][0]).toBe("/usr/bin/zsh")

    process.env.SHELL = original
  })

  it("falls back to /bin/sh when $SHELL is unset", async () => {
    const original = process.env.SHELL
    delete process.env.SHELL

    await ptyService.ptySpawn({})

    expect(spawnMock.mock.calls[0][0]).toBe("/bin/sh")

    process.env.SHELL = original
  })
})

describe("performance", () => {
  it("spawns and kills many PTYs", async () => {
    const start = Date.now()
    const ids: string[] = []

    for (let i = 0; i < 15; i++) {
      const { ptyId } = await ptyService.ptySpawn({})
      ids.push(ptyId)
    }

    for (const ptyId of ids) {
      ptyService.ptyKill({ ptyId })
    }

    const elapsed = Date.now() - start
    expect(ptyService._getActivePtys().size).toBe(0)
    expect(elapsed).toBeLessThan(5000)
  })
})
