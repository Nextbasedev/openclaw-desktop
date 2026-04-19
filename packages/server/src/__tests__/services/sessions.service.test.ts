import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as sessions from "../../services/sessions.service.js"
import * as projects from "../../services/projects.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as topics from "../../services/topics.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

function setupProjectAndTopic() {
  const prof = profiles.profilesCreate({
    name: "TestProf",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: os.tmpdir(),
  }).profile
  const proj = projects.projectsCreate({
    name: `Project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profileId: prof.id,
    workspaceRoot: os.tmpdir(),
  }).project
  const topic = topics.topicsCreate({
    projectId: proj.id,
    name: `Topic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }).topic
  return { prof, proj, topic }
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

describe("sessions CRUD", () => {
  it("lists empty sessions", () => {
    const result = sessions.sessionsList()
    expect(result.sessions).toEqual([])
    expect(result.sessionVisibility).toBe("jarvis-only")
  })

  it("creates a session", () => {
    const { proj } = setupProjectAndTopic()
    const result = sessions.sessionsCreate({
      projectId: proj.id,
      agentId: "main",
      label: "Test Session",
      sessionKey: "sk_test_1",
    })
    expect(result.session.key).toBe("sk_test_1")
    expect(result.session.label).toBe("Test Session")
    expect(result.session.status).toBe("idle")
    expect(result.session.pinned).toBe(false)
    expect(result.session.hidden).toBe(false)
    expect(result.session.source).toBe("jarvis")
  })

  it("creates a session with topic", () => {
    const { proj, topic } = setupProjectAndTopic()
    const result = sessions.sessionsCreate({
      projectId: proj.id,
      topicId: topic.id,
      agentId: "main",
      label: "Scoped Session",
      sessionKey: "sk_topic_1",
    })
    expect(result.session.topicId).toBe(topic.id)
  })

  it("lists sessions filtered by project", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "S1", sessionKey: "sk_1" })
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "S2", sessionKey: "sk_2" })

    const result = sessions.sessionsList({ projectId: proj.id })
    expect(result.sessions).toHaveLength(2)
  })

  it("lists sessions filtered by topic", () => {
    const { proj, topic } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, topicId: topic.id, agentId: "main", label: "S1", sessionKey: "sk_t1" })
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "S2", sessionKey: "sk_t2" })

    const result = sessions.sessionsList({ topicId: topic.id })
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].key).toBe("sk_t1")
  })

  it("filters by source when includeExisting is false", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Jarvis", sessionKey: "sk_j" })

    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO session_mappings (session_key, project_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'external')",
    ).run("sk_ext", proj.id, "main", "External", now, now)

    const filtered = sessions.sessionsList({ projectId: proj.id })
    expect(filtered.sessions).toHaveLength(1)
    expect(filtered.sessionVisibility).toBe("jarvis-only")

    const all = sessions.sessionsList({ projectId: proj.id, includeExisting: true })
    expect(all.sessions).toHaveLength(2)
    expect(all.sessionVisibility).toBe("all-visible")
  })

  it("updates session label", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Old", sessionKey: "sk_up" })
    const updated = sessions.sessionsUpdate({ sessionKey: "sk_up", label: "New" })
    expect(updated.session.label).toBe("New")
  })

  it("pins and unpins a session", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Pin", sessionKey: "sk_pin" })

    const pinned = sessions.sessionsUpdate({ sessionKey: "sk_pin", pinned: true })
    expect(pinned.session.pinned).toBe(true)

    const unpinned = sessions.sessionsUpdate({ sessionKey: "sk_pin", pinned: false })
    expect(unpinned.session.pinned).toBe(false)
  })

  it("hides a session", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Hide", sessionKey: "sk_hide" })
    const hidden = sessions.sessionsUpdate({ sessionKey: "sk_hide", hidden: true })
    expect(hidden.session.hidden).toBe(true)
  })

  it("reassigns session to different topic", () => {
    const { proj, topic } = setupProjectAndTopic()
    const topic2 = topics.topicsCreate({ projectId: proj.id, name: "Topic2" }).topic
    sessions.sessionsCreate({ projectId: proj.id, topicId: topic.id, agentId: "main", label: "Move", sessionKey: "sk_move" })

    const updated = sessions.sessionsUpdate({ sessionKey: "sk_move", topicId: topic2.id })
    expect(updated.session.topicId).toBe(topic2.id)
  })

  it("detaches session from topic via null", () => {
    const { proj, topic } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, topicId: topic.id, agentId: "main", label: "Detach", sessionKey: "sk_det" })

    const updated = sessions.sessionsUpdate({ sessionKey: "sk_det", topicId: null })
    expect(updated.session.topicId).toBeUndefined()
  })

  it("update rejects nonexistent session", () => {
    expect(() =>
      sessions.sessionsUpdate({ sessionKey: "sk_ghost", label: "X" }),
    ).toThrow("Session mapping not found")
  })

  it("deletes a session and records tombstone", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Del", sessionKey: "sk_del" })

    const result = sessions.sessionsDelete({ sessionKey: "sk_del" })
    expect(result.ok).toBe(true)

    const db = connection.getDb()
    const tombstone = db.prepare("SELECT * FROM sync_tombstones WHERE entity_id = ?").get("sk_del")
    expect(tombstone).toBeTruthy()

    const remaining = sessions.sessionsList()
    expect(remaining.sessions).toHaveLength(0)
  })

  it("updateSessionMappingStatus changes status", () => {
    const { proj } = setupProjectAndTopic()
    sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: "Status", sessionKey: "sk_st" })

    sessions.updateSessionMappingStatus("sk_st", "active")
    const db = connection.getDb()
    const row = db.prepare("SELECT status FROM session_mappings WHERE session_key = ?").get("sk_st") as { status: string }
    expect(row.status).toBe("active")
  })
})

describe("performance", () => {
  it("handles creating 100 sessions without degradation", () => {
    const { proj } = setupProjectAndTopic()
    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      sessions.sessionsCreate({ projectId: proj.id, agentId: "main", label: `Session ${i}`, sessionKey: `sk_perf_${i}` })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)

    const list = sessions.sessionsList({ projectId: proj.id })
    expect(list.sessions).toHaveLength(100)
  })
})
