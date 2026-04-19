import Database from "better-sqlite3"
import { initDb } from "../../db/schema.js"

describe("initDb", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  it("creates all required tables", () => {
    initDb(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)

    expect(names).toContain("profiles")
    expect(names).toContain("projects")
    expect(names).toContain("topics")
    expect(names).toContain("session_mappings")
    expect(names).toContain("branches")
    expect(names).toContain("terminal_sessions")
    expect(names).toContain("app_settings")
    expect(names).toContain("topic_git_context")
    expect(names).toContain("sync_tombstones")
  })

  it("is idempotent — calling twice does not error", () => {
    initDb(db)
    expect(() => initDb(db)).not.toThrow()
  })

  it("adds migration columns on first run", () => {
    initDb(db)
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain("pinned")
    expect(colNames).toContain("sync_dirty")
    expect(colNames).toContain("remotes_json")
  })

  it("migration columns survive re-init without error", () => {
    initDb(db)
    initDb(db)
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain("sync_dirty")
  })

  it("sync_dirty columns exist on all synced tables", () => {
    initDb(db)
    for (const table of ["projects", "topics", "session_mappings", "branches"]) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      expect(cols.map((c) => c.name)).toContain("sync_dirty")
    }
  })

  it("topic_git_context has unique constraint on topic_id + branch_name", () => {
    initDb(db)
    db.prepare(
      "INSERT INTO topic_git_context (id, topic_id, project_id, branch_name, repo_root, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("1", "t1", "p1", "main", "/repo", new Date().toISOString())

    expect(() =>
      db.prepare(
        "INSERT INTO topic_git_context (id, topic_id, project_id, branch_name, repo_root, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("2", "t1", "p1", "main", "/repo", new Date().toISOString()),
    ).toThrow(/UNIQUE/)
  })
})
