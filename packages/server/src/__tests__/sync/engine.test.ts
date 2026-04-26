import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

const upsertGatewaySession = jest.fn(async (input: { key: string; label: string }) => ({
  sessionKey: input.key,
  created: false,
}))
const deleteChatSession = jest.fn(async (sessionKey: string) => ({ deleted: true, sessionKey }))
const listGatewaySessions = jest.fn(async () => ({ sessions: [] }))
const gatewayOn = jest.fn()

jest.unstable_mockModule("middleware", () => ({
  upsertGatewaySession,
  deleteChatSession,
  listGatewaySessions,
}))

jest.unstable_mockModule("../../gateway/client.js", () => ({
  isGatewayConnected: () => true,
  gatewayEvents: { on: gatewayOn },
}))

let connection: typeof import("../../db/connection.js")
let outbox: typeof import("../../sync/outbox.js")
let engine: typeof import("../../sync/engine.js")
let anchor: typeof import("../../sync/anchor.js")

beforeAll(async () => {
  connection = await import("../../db/connection.js")
  outbox = await import("../../sync/outbox.js")
  engine = await import("../../sync/engine.js")
  anchor = await import("../../sync/anchor.js")
})

let testDbPath: string

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function insertProfileProject(projectId = "proj_sync", dirty = 1) {
  const db = connection.getDb()
  const now = nowIso()
  db.prepare(
    "INSERT INTO profiles (id, name, mode, gateway_url, workspace_root, is_default, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'connected', ?, ?)",
  ).run("prof_sync", "Profile", "local", "http://localhost:18789", os.tmpdir(), now, now)
  db.prepare(
    "INSERT INTO projects (id, name, profile_id, workspace_root, archived, unread_count, created_at, updated_at, pinned, sync_dirty) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0, ?)",
  ).run(projectId, "Project", "prof_sync", os.tmpdir(), now, now, dirty)
  return projectId
}

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `jarvis-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
  upsertGatewaySession.mockClear()
  deleteChatSession.mockClear()
  listGatewaySessions.mockClear()
})

afterEach(() => {
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("sync push engine", () => {
  it("pushes project upserts and clears dirty state", async () => {
    const projectId = insertProfileProject()
    outbox.enqueue("project", projectId, "upsert")

    const result = await engine.pushDueTasks()

    expect(result).toEqual({ pushed: 1, failed: 0 })
    expect(upsertGatewaySession).toHaveBeenCalledTimes(1)
    const db = connection.getDb()
    const project = db.prepare("SELECT sync_dirty FROM projects WHERE id = ?").get(projectId) as { sync_dirty: number }
    const pending = db.prepare("SELECT COUNT(*) as c FROM sync_outbox").get() as { c: number }
    expect(project.sync_dirty).toBe(0)
    expect(pending.c).toBe(0)
  })

  it("does not clear a newer local edit that lands while an older payload is pushed", async () => {
    const projectId = insertProfileProject()
    outbox.enqueue("project", projectId, "upsert")
    upsertGatewaySession.mockImplementationOnce(async (input: { key: string; label: string }) => {
      connection.getDb().prepare("UPDATE projects SET updated_at = ?, sync_dirty = 1 WHERE id = ?").run(nowIso(5000), projectId)
      return { sessionKey: input.key, created: false }
    })

    await engine.pushDueTasks()

    const project = connection.getDb().prepare("SELECT sync_dirty FROM projects WHERE id = ?").get(projectId) as { sync_dirty: number }
    expect(project.sync_dirty).toBe(1)
  })

  it("deletes remote chat sessions using remembered anchors after local row deletion", async () => {
    anchor.rememberAnchor("chat", "chat_delete", "sess_delete")
    outbox.enqueue("chat", "chat_delete", "delete")

    const result = await engine.pushDueTasks()

    expect(result).toEqual({ pushed: 1, failed: 0 })
    expect(deleteChatSession).toHaveBeenCalledWith("sess_delete")
    expect(anchor.getAnchorSessionKey("chat", "chat_delete")).toBeNull()
  })
})
