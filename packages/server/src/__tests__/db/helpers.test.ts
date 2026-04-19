import Database from "better-sqlite3"
import { initDb } from "../../db/schema.js"
import {
  nowIso,
  generateId,
  sqlToBool,
  boolToSql,
  parseJsonColumn,
  getAppSetting,
  setAppSetting,
  recordSyncTombstone,
  profileRowToJson,
  type ProfileRow,
} from "../../db/helpers.js"

describe("helper functions", () => {
  describe("nowIso", () => {
    it("returns a valid ISO string", () => {
      const iso = nowIso()
      expect(new Date(iso).toISOString()).toBe(iso)
    })

    it("returns current time within 2 seconds", () => {
      const before = Date.now()
      const iso = nowIso()
      const after = Date.now()
      const ts = new Date(iso).getTime()
      expect(ts).toBeGreaterThanOrEqual(before - 1)
      expect(ts).toBeLessThanOrEqual(after + 1)
    })
  })

  describe("generateId", () => {
    it("starts with the given prefix", () => {
      expect(generateId("prof")).toMatch(/^prof_/)
      expect(generateId("proj")).toMatch(/^proj_/)
      expect(generateId("topic")).toMatch(/^topic_/)
    })

    it("generates unique ids", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId("test")))
      expect(ids.size).toBe(100)
    })

    it("contains no hyphens (UUID stripped)", () => {
      expect(generateId("x")).not.toContain("-")
    })
  })

  describe("sqlToBool / boolToSql", () => {
    it("converts 0 to false", () => expect(sqlToBool(0)).toBe(false))
    it("converts 1 to true", () => expect(sqlToBool(1)).toBe(true))
    it("converts non-zero to true", () => expect(sqlToBool(42)).toBe(true))
    it("converts true to 1", () => expect(boolToSql(true)).toBe(1))
    it("converts false to 0", () => expect(boolToSql(false)).toBe(0))
  })

  describe("parseJsonColumn", () => {
    it("parses valid JSON", () => {
      expect(parseJsonColumn('{"a":1}')).toEqual({ a: 1 })
    })
    it("returns null for null input", () => {
      expect(parseJsonColumn(null)).toBeNull()
    })
    it("returns null for undefined input", () => {
      expect(parseJsonColumn(undefined)).toBeNull()
    })
    it("returns null for invalid JSON", () => {
      expect(parseJsonColumn("{broken")).toBeNull()
    })
    it("returns null for empty string", () => {
      expect(parseJsonColumn("")).toBeNull()
    })
  })

  describe("profileRowToJson", () => {
    it("maps snake_case to camelCase", () => {
      const row: ProfileRow = {
        id: "prof_1",
        name: "Test",
        mode: "local",
        gateway_url: "http://localhost:18789",
        workspace_root: "/tmp/ws",
        is_default: 1,
        status: "connected",
        last_used_at: null,
        last_error: null,
        capabilities_json: '{"openclaw":true}',
        metadata_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }
      const json = profileRowToJson(row)
      expect(json.gatewayUrl).toBe("http://localhost:18789")
      expect(json.workspaceRoot).toBe("/tmp/ws")
      expect(json.isDefault).toBe(true)
      expect(json.capabilities).toEqual({ openclaw: true })
    })

    it("handles null optional fields", () => {
      const row: ProfileRow = {
        id: "prof_2",
        name: "Minimal",
        mode: "remote",
        gateway_url: "ws://host",
        workspace_root: "/ws",
        is_default: 0,
        status: "disconnected",
        last_used_at: null,
        last_error: null,
        capabilities_json: null,
        metadata_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }
      const json = profileRowToJson(row)
      expect(json.isDefault).toBe(false)
      expect(json.capabilities).toBeNull()
      expect(json.lastUsedAt).toBeUndefined()
    })
  })
})

describe("app settings", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    initDb(db)
  })

  afterEach(() => {
    db.close()
  })

  it("returns null for missing key", () => {
    expect(getAppSetting(db, "nonexistent")).toBeNull()
  })

  it("stores and retrieves a value", () => {
    setAppSetting(db, "test.key", "test-value")
    expect(getAppSetting(db, "test.key")).toBe("test-value")
  })

  it("overwrites existing value", () => {
    setAppSetting(db, "key", "v1")
    setAppSetting(db, "key", "v2")
    expect(getAppSetting(db, "key")).toBe("v2")
  })

  it("handles empty string values", () => {
    setAppSetting(db, "empty", "")
    expect(getAppSetting(db, "empty")).toBe("")
  })

  it("handles unicode values", () => {
    setAppSetting(db, "unicode", "Hello 世界 🌍")
    expect(getAppSetting(db, "unicode")).toBe("Hello 世界 🌍")
  })
})

describe("recordSyncTombstone", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    initDb(db)
  })

  afterEach(() => {
    db.close()
  })

  it("inserts a tombstone record", () => {
    recordSyncTombstone(db, "topic", "topic_123")
    const row = db.prepare("SELECT * FROM sync_tombstones WHERE entity_id = ?").get("topic_123") as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.entity_type).toBe("topic")
  })

  it("replaces existing tombstone for same entity", () => {
    recordSyncTombstone(db, "topic", "topic_123")
    recordSyncTombstone(db, "topic", "topic_123")
    const count = (db.prepare("SELECT COUNT(*) as c FROM sync_tombstones WHERE entity_id = ?").get("topic_123") as { c: number }).c
    expect(count).toBe(1)
  })

  it("sets expires_at roughly 30 days in the future", () => {
    recordSyncTombstone(db, "project", "proj_1")
    const row = db.prepare("SELECT expires_at FROM sync_tombstones WHERE entity_id = ?").get("proj_1") as { expires_at: string }
    const expiresMs = new Date(row.expires_at).getTime()
    const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5000)
  })
})
