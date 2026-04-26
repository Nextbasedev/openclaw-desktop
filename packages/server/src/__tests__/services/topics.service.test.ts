import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as topics from "../../services/topics.service.js"
import * as projects from "../../services/projects.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

function createTestProject() {
  const prof = profiles.profilesCreate({
    name: "TestProf",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: os.tmpdir(),
  }).profile
  return projects.projectsCreate({
    name: `Project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profileId: prof.id,
    workspaceRoot: os.tmpdir(),
  }).project
}

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

describe("topics CRUD", () => {
  it("lists empty topics for a project", () => {
    const proj = createTestProject()
    const result = topics.topicsList({ projectId: proj.id })
    expect(result.topics).toEqual([])
  })

  it("creates and retrieves a topic", () => {
    const proj = createTestProject()
    const result = topics.topicsCreate({ projectId: proj.id, name: "My Topic" })
    expect(result.topic.name).toBe("My Topic")
    expect(result.topic.id).toMatch(/^topic_/)
    expect(result.topic.projectId).toBe(proj.id)
    expect(result.topic.archived).toBe(false)
    expect(result.topic.sortOrder).toBe(0)

    const list = topics.topicsList({ projectId: proj.id })
    expect(list.topics).toHaveLength(1)
  })

  it("auto-increments sort_order", () => {
    const proj = createTestProject()
    const t1 = topics.topicsCreate({ projectId: proj.id, name: "First" })
    const t2 = topics.topicsCreate({ projectId: proj.id, name: "Second" })
    const t3 = topics.topicsCreate({ projectId: proj.id, name: "Third" })
    expect(t1.topic.sortOrder).toBe(0)
    expect(t2.topic.sortOrder).toBe(1)
    expect(t3.topic.sortOrder).toBe(2)
  })

  it("rejects empty name", () => {
    const proj = createTestProject()
    expect(() =>
      topics.topicsCreate({ projectId: proj.id, name: "  " }),
    ).toThrow("Name cannot be empty")
  })

  it("rejects whitespace-only name", () => {
    const proj = createTestProject()
    expect(() =>
      topics.topicsCreate({ projectId: proj.id, name: "\t\n" }),
    ).toThrow("Name cannot be empty")
  })

  it("rejects duplicate name within same project (case-insensitive)", () => {
    const proj = createTestProject()
    topics.topicsCreate({ projectId: proj.id, name: "Alpha" })
    expect(() =>
      topics.topicsCreate({ projectId: proj.id, name: "alpha" }),
    ).toThrow("already exists")
  })

  it("allows same name in different projects", () => {
    const proj1 = createTestProject()
    const proj2 = createTestProject()
    topics.topicsCreate({ projectId: proj1.id, name: "SameName" })
    expect(() =>
      topics.topicsCreate({ projectId: proj2.id, name: "SameName" }),
    ).not.toThrow()
  })

  it("handles unicode topic names", () => {
    const proj = createTestProject()
    const result = topics.topicsCreate({ projectId: proj.id, name: "Тема 日本語 🚀" })
    expect(result.topic.name).toBe("Тема 日本語 🚀")
  })

  it("updates topic fields", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "Original" })
    const updated = topics.topicsUpdate({ topicId: created.topic.id, name: "Renamed" })
    expect(updated.topic.name).toBe("Renamed")
  })

  it("updates sort order", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "Reorder" })
    const updated = topics.topicsUpdate({ topicId: created.topic.id, sortOrder: 99 })
    expect(updated.topic.sortOrder).toBe(99)
  })

  it("update rejects nonexistent topic", () => {
    expect(() =>
      topics.topicsUpdate({ topicId: "topic_nonexistent", name: "X" }),
    ).toThrow("Topic not found")
  })

  it("archives and unarchives a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "ToArchive" })

    const archived = topics.topicsArchive({ topicId: created.topic.id })
    expect(archived.archived).toBe(true)

    const unarchived = topics.topicsArchive({ topicId: created.topic.id, archived: false })
    expect(unarchived.archived).toBe(false)
  })

  it("archive rejects nonexistent topic", () => {
    expect(() => topics.topicsArchive({ topicId: "topic_ghost" })).toThrow("Topic not found")
  })

  it("deletes a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "ToDelete" })
    const result = topics.topicsDelete({ topicId: created.topic.id })
    expect(result.ok).toBe(true)
    expect(topics.topicsList({ projectId: proj.id }).topics).toHaveLength(0)
  })

  it("delete rejects nonexistent topic", () => {
    expect(() => topics.topicsDelete({ topicId: "topic_ghost" })).toThrow("Topic not found")
  })

  it("delete detaches sessions and records tombstone", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "Cascade" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run("sk_1", proj.id, created.topic.id, "main", "S", now, now)

    topics.topicsDelete({ topicId: created.topic.id })

    const session = db.prepare("SELECT topic_id FROM session_mappings WHERE session_key = ?").get("sk_1") as { topic_id: string | null }
    expect(session.topic_id).toBeNull()

    const tombstone = db.prepare("SELECT * FROM sync_tombstones WHERE entity_id = ?").get(created.topic.id)
    expect(tombstone).toBeTruthy()
  })
})

describe("topic session attach/detach", () => {
  it("attaches a session to a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "Attach" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run("sk_attach", proj.id, "main", "S", now, now)

    const result = topics.topicsAttachSession({ topicId: created.topic.id, sessionKey: "sk_attach" })
    expect(result.ok).toBe(true)

    const session = db.prepare("SELECT topic_id FROM session_mappings WHERE session_key = ?").get("sk_attach") as { topic_id: string | null }
    expect(session.topic_id).toBe(created.topic.id)
  })

  it("enqueues owning chat when attaching a session to a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "AttachSync" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run("sk_attach_sync", proj.id, "main", "S", now, now)
    db.prepare(
      "INSERT INTO chats (id, name, session_key, agent_id, archived, pinned, last_active_at, created_at, updated_at, sync_dirty) VALUES (?, ?, ?, 'main', 0, 0, ?, ?, ?, 0)",
    ).run("chat_attach_sync", "Chat", "sk_attach_sync", now, now, now)

    topics.topicsAttachSession({ topicId: created.topic.id, sessionKey: "sk_attach_sync" })

    const outbox = db.prepare("SELECT entity_type, entity_id, op FROM sync_outbox WHERE entity_type = 'chat'").get() as { entity_type: string; entity_id: string; op: string }
    expect(outbox).toEqual({ entity_type: "chat", entity_id: "chat_attach_sync", op: "upsert" })
  })

  it("attach rejects nonexistent session", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "NoSession" })
    expect(() =>
      topics.topicsAttachSession({ topicId: created.topic.id, sessionKey: "sk_ghost" }),
    ).toThrow("Session mapping not found")
  })

  it("detaches a session from a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "Detach" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run("sk_detach", proj.id, created.topic.id, "main", "S", now, now)

    const result = topics.topicsDetachSession({ topicId: created.topic.id, sessionKey: "sk_detach" })
    expect(result.ok).toBe(true)

    const session = db.prepare("SELECT topic_id FROM session_mappings WHERE session_key = ?").get("sk_detach") as { topic_id: string | null }
    expect(session.topic_id).toBeNull()
  })

  it("enqueues owning chat when detaching a session from a topic", () => {
    const proj = createTestProject()
    const created = topics.topicsCreate({ projectId: proj.id, name: "DetachSync" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run("sk_detach_sync", proj.id, created.topic.id, "main", "S", now, now)
    db.prepare(
      "INSERT INTO chats (id, name, session_key, agent_id, archived, pinned, last_active_at, created_at, updated_at, sync_dirty) VALUES (?, ?, ?, 'main', 0, 0, ?, ?, ?, 0)",
    ).run("chat_detach_sync", "Chat", "sk_detach_sync", now, now, now)

    topics.topicsDetachSession({ topicId: created.topic.id, sessionKey: "sk_detach_sync" })

    const outbox = db.prepare("SELECT entity_type, entity_id, op FROM sync_outbox WHERE entity_type = 'chat'").get() as { entity_type: string; entity_id: string; op: string }
    expect(outbox).toEqual({ entity_type: "chat", entity_id: "chat_detach_sync", op: "upsert" })
  })

  it("detach rejects nonexistent session", () => {
    expect(() =>
      topics.topicsDetachSession({ topicId: "topic_1", sessionKey: "sk_ghost" }),
    ).toThrow("Session mapping not found")
  })
})

describe("performance", () => {
  it("handles creating 100 topics without degradation", () => {
    const proj = createTestProject()
    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      topics.topicsCreate({ projectId: proj.id, name: `Topic ${i}` })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)

    const list = topics.topicsList({ projectId: proj.id })
    expect(list.topics).toHaveLength(100)
  })
})
