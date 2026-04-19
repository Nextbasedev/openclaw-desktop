import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as sync from "../../services/sync.service.js"
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

describe("syncStatus", () => {
  it("returns zero dirty count on fresh db", () => {
    const result = sync.syncStatus()
    expect(result.dirtyCount).toBe(0)
    expect(result.tombstoneCount).toBe(0)
    expect(result.deviceId).toBeNull()
  })

  it("reflects dirty records", () => {
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO profiles (id, name, mode, gateway_url, workspace_root, is_default, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'disconnected', ?, ?)").run(
      "prof_1", "P", "local", "http://x", "/tmp", now, now,
    )
    db.prepare("INSERT INTO projects (id, name, profile_id, workspace_root, created_at, updated_at, sync_dirty) VALUES (?, ?, ?, ?, ?, ?, 1)").run(
      "proj_1", "P", "prof_1", "/tmp", now, now,
    )
    const result = sync.syncStatus()
    expect(result.dirtyCount).toBe(1)
    expect(result.breakdown.projects).toBe(1)
  })
})

describe("syncMarkClean", () => {
  it("marks projects clean", () => {
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO profiles (id, name, mode, gateway_url, workspace_root, is_default, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'disconnected', ?, ?)").run(
      "prof_1", "P", "local", "http://x", "/tmp", now, now,
    )
    db.prepare("INSERT INTO projects (id, name, profile_id, workspace_root, created_at, updated_at, sync_dirty) VALUES (?, ?, ?, ?, ?, ?, 1)").run(
      "proj_1", "P", "prof_1", "/tmp", now, now,
    )

    const result = sync.syncMarkClean({ table: "projects", ids: ["proj_1"] })
    expect(result.ok).toBe(true)
    expect(result.cleaned).toBe(1)

    const status = sync.syncStatus()
    expect(status.breakdown.projects).toBe(0)
  })

  it("rejects unknown table", () => {
    expect(() => sync.syncMarkClean({ table: "users", ids: ["x"] })).toThrow("unknown table")
  })
})

describe("syncPurgeTombstones", () => {
  it("purges expired tombstones", () => {
    const db = connection.getDb()
    const past = new Date(Date.now() - 100000).toISOString()
    db.prepare("INSERT INTO sync_tombstones (entity_type, entity_id, deleted_at, deleted_by, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      "topic", "t_1", past, "", past,
    )
    const result = sync.syncPurgeTombstones()
    expect(result.purged).toBe(1)
  })
})

describe("syncSetDeviceId", () => {
  it("sets and persists device id", () => {
    sync.syncSetDeviceId({ deviceId: "dev_123" })
    const status = sync.syncStatus()
    expect(status.deviceId).toBe("dev_123")
  })
})
