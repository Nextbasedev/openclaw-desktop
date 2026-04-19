import Database from "better-sqlite3"
import { initDb } from "../../db/schema.js"
import * as profiles from "../../services/profiles.service.js"
import * as connection from "../../db/connection.js"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

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

describe("profiles CRUD", () => {
  it("lists empty profiles on fresh db", () => {
    const result = profiles.profilesList()
    expect(result.profiles).toEqual([])
  })

  it("creates and retrieves a profile", () => {
    const result = profiles.profilesCreate({
      name: "Test Profile",
      mode: "local",
      gatewayUrl: "http://localhost:18789",
      workspaceRoot: os.tmpdir(),
    })
    expect(result.profile.name).toBe("Test Profile")
    expect(result.profile.id).toMatch(/^prof_/)
    expect(result.profile.status).toBe("disconnected")

    const list = profiles.profilesList()
    expect(list.profiles).toHaveLength(1)
  })

  it("rejects empty name", () => {
    expect(() =>
      profiles.profilesCreate({ name: "  ", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" }),
    ).toThrow("Name cannot be empty")
  })

  it("rejects whitespace-only name", () => {
    expect(() =>
      profiles.profilesCreate({ name: "\t\n", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" }),
    ).toThrow("Name cannot be empty")
  })

  it("handles unicode profile names", () => {
    const result = profiles.profilesCreate({
      name: "Профиль 日本語 🚀",
      mode: "local",
      gatewayUrl: "http://localhost:18789",
      workspaceRoot: os.tmpdir(),
    })
    expect(result.profile.name).toBe("Профиль 日本語 🚀")
  })

  it("sets isDefault and clears previous default", () => {
    const p1 = profiles.profilesCreate({ name: "P1", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp", isDefault: true })
    expect(p1.profile.isDefault).toBe(true)

    const p2 = profiles.profilesCreate({ name: "P2", mode: "local", gatewayUrl: "http://y", workspaceRoot: "/tmp", isDefault: true })
    expect(p2.profile.isDefault).toBe(true)

    const list = profiles.profilesList()
    const defaults = list.profiles.filter((p: { isDefault: boolean }) => p.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).toBe(p2.profile.id)
  })

  it("updates profile fields", () => {
    const created = profiles.profilesCreate({ name: "Original", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    const updated = profiles.profilesUpdate({ profileId: created.profile.id, name: "Renamed" })
    expect(updated.profile.name).toBe("Renamed")
  })

  it("update rejects nonexistent profile", () => {
    expect(() =>
      profiles.profilesUpdate({ profileId: "prof_nonexistent", name: "X" }),
    ).toThrow("Profile not found")
  })

  it("deletes a profile", () => {
    const created = profiles.profilesCreate({ name: "ToDelete", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    const result = profiles.profilesDelete({ profileId: created.profile.id })
    expect(result.ok).toBe(true)
    expect(profiles.profilesList().profiles).toHaveLength(0)
  })

  it("delete rejects nonexistent profile", () => {
    expect(() => profiles.profilesDelete({ profileId: "prof_ghost" })).toThrow("Profile not found")
  })

  it("delete rejects profile with referencing projects", () => {
    const prof = profiles.profilesCreate({ name: "HasProjects", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO projects (id, name, profile_id, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "proj_1", "P", prof.profile.id, "/tmp", now, now,
    )
    expect(() => profiles.profilesDelete({ profileId: prof.profile.id })).toThrow("project(s) still reference it")
  })
})

describe("profile tokens", () => {
  it("stores and retrieves a token", () => {
    profiles.profilesCreate({ name: "TokenTest", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    profiles.profileTokenSet({ profileId: "prof_test", token: "secret-123" })
    const result = profiles.profileTokenGet({ profileId: "prof_test" })
    expect(result.token).toBe("secret-123")
  })

  it("returns null for missing token", () => {
    const result = profiles.profileTokenGet({ profileId: "prof_missing" })
    expect(result.token).toBeNull()
  })

  it("deletes a token", () => {
    profiles.profileTokenSet({ profileId: "prof_del", token: "x" })
    profiles.profileTokenDelete({ profileId: "prof_del" })
    expect(profiles.profileTokenGet({ profileId: "prof_del" }).token).toBeNull()
  })

  it("rejects empty token", () => {
    expect(() => profiles.profileTokenSet({ profileId: "p", token: "" })).toThrow("token is required")
  })
})

describe("environment", () => {
  it("connect marks profile as connected", () => {
    const prof = profiles.profilesCreate({ name: "Env", mode: "local", gatewayUrl: "http://x", workspaceRoot: os.tmpdir() })
    const result = profiles.environmentConnect({ profileId: prof.profile.id })
    expect(result.status).toBe("connected")
    expect(result.capabilities.openclaw).toBe(true)
  })

  it("connect rejects nonexistent profile", () => {
    expect(() => profiles.environmentConnect({ profileId: "prof_ghost" })).toThrow("Profile not found")
  })

  it("status returns current profile state", () => {
    const prof = profiles.profilesCreate({ name: "Status", mode: "local", gatewayUrl: "http://x", workspaceRoot: os.tmpdir() })
    const result = profiles.environmentStatus({ profileId: prof.profile.id })
    expect(result.status).toBe("disconnected")
    expect(result.capabilities).toBeTruthy()
  })

  it("detect returns capabilities for workspace", () => {
    const prof = profiles.profilesCreate({ name: "Detect", mode: "local", gatewayUrl: "http://x", workspaceRoot: os.tmpdir() })
    const result = profiles.environmentDetect({ profileId: prof.profile.id })
    expect(result.capabilities.files).toBe(true)
  })

  it("detect returns files=false for nonexistent workspace", () => {
    const prof = profiles.profilesCreate({ name: "NoDir", mode: "local", gatewayUrl: "http://x", workspaceRoot: "/nonexistent/path/xyz" })
    const result = profiles.environmentDetect({ profileId: prof.profile.id })
    expect(result.capabilities.files).toBe(false)
  })
})

describe("performance", () => {
  it("handles creating 100 profiles without degradation", () => {
    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      profiles.profilesCreate({ name: `Profile ${i}`, mode: "local", gatewayUrl: "http://x", workspaceRoot: "/tmp" })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)

    const list = profiles.profilesList()
    expect(list.profiles).toHaveLength(100)
  })
})
