import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as runtime from "../../services/runtime.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
})

afterEach(() => {
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("runtimeInfo", () => {
  it("returns contract version and transport", () => {
    const result = runtime.runtimeInfo()
    expect(result.contractVersion).toBeTruthy()
    expect(result.transport).toContain("http")
    expect(result.transport).toContain("sqlite")
  })
})

describe("botName", () => {
  it("returns null initially", () => {
    const result = runtime.botNameGet()
    expect(result.botName).toBeNull()
  })

  it("sets and gets bot name", () => {
    runtime.botNameSet({ botName: "Jarvis" })
    expect(runtime.botNameGet().botName).toBe("Jarvis")
  })

  it("trims whitespace from bot name", () => {
    runtime.botNameSet({ botName: "  Jarvis  " })
    expect(runtime.botNameGet().botName).toBe("Jarvis")
  })

  it("rejects empty bot name", () => {
    expect(() => runtime.botNameSet({ botName: "  " })).toThrow("Bot name cannot be empty")
  })

  it("rejects whitespace-only bot name", () => {
    expect(() => runtime.botNameSet({ botName: "\t\n" })).toThrow("Bot name cannot be empty")
  })

  it("handles unicode bot names", () => {
    runtime.botNameSet({ botName: "Джарвис 🤖" })
    expect(runtime.botNameGet().botName).toBe("Джарвис 🤖")
  })

  it("botName() is alias for botNameGet()", () => {
    runtime.botNameSet({ botName: "Alias" })
    expect(runtime.botName().botName).toBe("Alias")
  })

  it("overwrites existing bot name", () => {
    runtime.botNameSet({ botName: "First" })
    runtime.botNameSet({ botName: "Second" })
    expect(runtime.botNameGet().botName).toBe("Second")
  })
})

describe("requestAdminAccess", () => {
  it("returns admin request with action id", () => {
    const result = runtime.requestAdminAccess({ actionId: "delete_data" })
    expect(result.status).toBe("needs_admin")
    expect(result.retry.gatewayMethod).toBe("delete_data")
    expect(result.recommendedApprovers).toHaveLength(2)
  })

  it("uses actionLabel in message", () => {
    const result = runtime.requestAdminAccess({ actionId: "reset", actionLabel: "Reset all data" })
    expect(result.message).toContain("Reset all data")
  })

  it("falls back to actionId when no label", () => {
    const result = runtime.requestAdminAccess({ actionId: "shutdown" })
    expect(result.message).toContain("shutdown")
    expect(result.retry.label).toBe("shutdown")
  })
})

describe("approveAdminAccess", () => {
  it("returns approved status", () => {
    const result = runtime.approveAdminAccess({ actionId: "delete_data" })
    expect(result.status).toBe("approved")
    expect(result.approved).toBe(true)
    expect(result.retry.gatewayMethod).toBe("delete_data")
    expect(result.retry.openClawFlow).toEqual(["connect", "delete_data"])
  })
})
