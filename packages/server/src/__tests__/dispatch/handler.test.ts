import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import request from "supertest"
import { app } from "../../index.js"
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

describe("POST /api/ipc/:command", () => {
  it("returns 404 for unknown command", async () => {
    const res = await request(app)
      .post("/api/ipc/nonexistent_command")
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toContain("Unknown command")
  })

  it("routes middleware_runtime_info correctly", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_runtime_info")
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.contractVersion).toBeTruthy()
  })

  it("routes middleware_profiles_list correctly", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_profiles_list")
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.profiles).toEqual([])
  })

  it("routes middleware_profiles_create correctly", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_profiles_create")
      .send({
        name: "HTTP Profile",
        mode: "local",
        gatewayUrl: "http://localhost:18789",
        workspaceRoot: os.tmpdir(),
      })
    expect(res.status).toBe(200)
    expect(res.body.profile.name).toBe("HTTP Profile")
  })

  it("returns 500 for validation errors", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_profiles_create")
      .send({ name: "  ", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    expect(res.status).toBe(500)
    expect(res.body.error).toContain("Name cannot be empty")
  })

  it("accepts JSON body with nested data", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_openclaw_bot_name_set")
      .send({ botName: "TestBot" })
    expect(res.status).toBe(200)
    expect(res.body.botName).toBe("TestBot")
  })

  it("handles empty body gracefully", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_runtime_info")
      .send()
    expect(res.status).toBe(200)
  })
})

describe("GET /health", () => {
  it("returns health check", async () => {
    const res = await request(app).get("/health")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.timestamp).toBeTruthy()
  })
})

describe("CORS", () => {
  it("sets CORS headers", async () => {
    const res = await request(app)
      .post("/api/ipc/middleware_runtime_info")
      .send({})
    expect(res.headers["access-control-allow-origin"]).toBe("*")
  })
})
