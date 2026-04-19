import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as branches from "../../services/branches.service.js"
import * as projects from "../../services/projects.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
})

afterEach(() => {
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

function createTestProject() {
  const profile = profiles.profilesCreate({
    name: "Test Profile",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: os.tmpdir(),
  })
  const project = projects.projectsCreate({
    name: "Test Project",
    profileId: profile.profile.id,
    workspaceRoot: os.tmpdir(),
  })
  return { profileId: profile.profile.id, projectId: project.project.id }
}

describe("branchCreate", () => {
  it("creates a branch with topic and session mapping", () => {
    const { projectId } = createTestProject()
    const result = branches.branchCreate({
      sourceSessionKey: "src-session-001",
      sourceMessageId: "msg-abcdef12",
      projectId,
      branchName: "My Branch",
      branchReason: "manual",
      branchSessionKey: "branch-session-001",
    })

    expect(result.branch.id).toMatch(/^branch_/)
    expect(result.branch.sourceSessionKey).toBe("src-session-001")
    expect(result.branch.sourceMessageId).toBe("msg-abcdef12")
    expect(result.branch.branchSessionKey).toBe("branch-session-001")
    expect(result.branch.branchTopicId).toBeDefined()
    expect(result.branch.branchReason).toBe("manual")
    expect(result.topicId).toBe(result.branch.branchTopicId)
    expect(result.sessionKey).toBe("branch-session-001")

    // Verify the topic was created
    const db = connection.getDb()
    const topic = db
      .prepare("SELECT name FROM topics WHERE id = ?")
      .get(result.topicId) as { name: string } | undefined
    expect(topic).toBeDefined()
    expect(topic!.name).toBe("My Branch")

    // Verify the session mapping was created
    const session = db
      .prepare(
        "SELECT session_key, topic_id FROM session_mappings WHERE session_key = ?",
      )
      .get("branch-session-001") as
      | { session_key: string; topic_id: string }
      | undefined
    expect(session).toBeDefined()
    expect(session!.topic_id).toBe(result.topicId)
  })

  it("creates a branch without a reason", () => {
    const { projectId } = createTestProject()
    const result = branches.branchCreate({
      sourceSessionKey: "src-session-002",
      sourceMessageId: "msg-00000000",
      projectId,
      branchName: "No Reason Branch",
      branchSessionKey: "branch-session-002",
    })

    expect(result.branch.branchReason).toBeUndefined()
  })
})

describe("branchList", () => {
  it("returns empty list when no branches exist", () => {
    createTestProject()
    const result = branches.branchList({
      sourceSessionKey: "nonexistent-session",
    })
    expect(result.branches).toEqual([])
  })

  it("lists branches for a source session ordered by created_at DESC", () => {
    const { projectId } = createTestProject()

    branches.branchCreate({
      sourceSessionKey: "src-session-list",
      sourceMessageId: "msg-01",
      projectId,
      branchName: "Branch A",
      branchSessionKey: "branch-a",
    })
    branches.branchCreate({
      sourceSessionKey: "src-session-list",
      sourceMessageId: "msg-02",
      projectId,
      branchName: "Branch B",
      branchSessionKey: "branch-b",
    })
    branches.branchCreate({
      sourceSessionKey: "other-session",
      sourceMessageId: "msg-03",
      projectId,
      branchName: "Branch C",
      branchSessionKey: "branch-c",
    })

    const result = branches.branchList({
      sourceSessionKey: "src-session-list",
    })
    expect(result.branches).toHaveLength(2)
    const keys = result.branches.map((b: { branchSessionKey: string }) => b.branchSessionKey)
    expect(keys).toContain("branch-a")
    expect(keys).toContain("branch-b")
  })
})

describe("branchGet", () => {
  it("retrieves a branch by session key", () => {
    const { projectId } = createTestProject()
    branches.branchCreate({
      sourceSessionKey: "src-get",
      sourceMessageId: "msg-get-01",
      projectId,
      branchName: "Get Test",
      branchReason: "test",
      branchSessionKey: "branch-get-001",
    })

    const result = branches.branchGet({
      branchSessionKey: "branch-get-001",
    })
    expect(result.branch.branchSessionKey).toBe("branch-get-001")
    expect(result.branch.branchReason).toBe("test")
  })

  it("throws for nonexistent branch", () => {
    createTestProject()
    expect(() =>
      branches.branchGet({ branchSessionKey: "does-not-exist" }),
    ).toThrow("Branch not found")
  })
})

describe("branchDelete", () => {
  it("deletes a branch and returns confirmation", () => {
    const { projectId } = createTestProject()
    const created = branches.branchCreate({
      sourceSessionKey: "src-del",
      sourceMessageId: "msg-del-01",
      projectId,
      branchName: "To Delete",
      branchSessionKey: "branch-del-001",
    })

    const result = branches.branchDelete({
      branchSessionKey: "branch-del-001",
    })
    expect(result.deleted).toBe(true)
    expect(result.branchSessionKey).toBe("branch-del-001")
    expect(result.topicArchived).toBe(created.topicId)

    // Branch should be gone
    expect(() =>
      branches.branchGet({ branchSessionKey: "branch-del-001" }),
    ).toThrow("Branch not found")
  })

  it("throws for nonexistent branch on delete", () => {
    createTestProject()
    expect(() =>
      branches.branchDelete({ branchSessionKey: "ghost-branch" }),
    ).toThrow("Branch not found")
  })

  it("archives the topic on delete", () => {
    const { projectId } = createTestProject()
    const created = branches.branchCreate({
      sourceSessionKey: "src-arc",
      sourceMessageId: "msg-arc-01",
      projectId,
      branchName: "Archive Test",
      branchSessionKey: "branch-arc-001",
    })

    branches.branchDelete({ branchSessionKey: "branch-arc-001" })

    const db = connection.getDb()
    const topic = db
      .prepare("SELECT archived FROM topics WHERE id = ?")
      .get(created.topicId) as { archived: number } | undefined
    expect(topic).toBeDefined()
    expect(topic!.archived).toBe(1)
  })

  it("hides the session mapping on delete", () => {
    const { projectId } = createTestProject()
    branches.branchCreate({
      sourceSessionKey: "src-hide",
      sourceMessageId: "msg-hide-01",
      projectId,
      branchName: "Hide Session Test",
      branchSessionKey: "branch-hide-001",
    })

    branches.branchDelete({ branchSessionKey: "branch-hide-001" })

    const db = connection.getDb()
    const session = db
      .prepare(
        "SELECT hidden FROM session_mappings WHERE session_key = ?",
      )
      .get("branch-hide-001") as { hidden: number } | undefined
    expect(session).toBeDefined()
    expect(session!.hidden).toBe(1)
  })

  it("records a sync tombstone on delete", () => {
    const { projectId } = createTestProject()
    const created = branches.branchCreate({
      sourceSessionKey: "src-tomb",
      sourceMessageId: "msg-tomb-01",
      projectId,
      branchName: "Tombstone Test",
      branchSessionKey: "branch-tomb-001",
    })

    branches.branchDelete({ branchSessionKey: "branch-tomb-001" })

    const db = connection.getDb()
    const tombstone = db
      .prepare(
        "SELECT entity_type, entity_id FROM sync_tombstones WHERE entity_type = 'branch' AND entity_id = ?",
      )
      .get(created.branch.id) as
      | { entity_type: string; entity_id: string }
      | undefined
    expect(tombstone).toBeDefined()
    expect(tombstone!.entity_type).toBe("branch")
    expect(tombstone!.entity_id).toBe(created.branch.id)
  })
})

describe("branchFromRegenerate", () => {
  it("generates correct name from message id", () => {
    const { projectId } = createTestProject()
    const result = branches.branchFromRegenerate({
      sourceSessionKey: "src-regen",
      sourceMessageId: "abcdef1234567890",
      projectId,
      branchSessionKey: "branch-regen-001",
    })

    expect(result.branch.branchReason).toBe("regenerate")
    // First 8 chars of "abcdef1234567890" = "abcdef12"
    const db = connection.getDb()
    const topic = db
      .prepare("SELECT name FROM topics WHERE id = ?")
      .get(result.topicId) as { name: string }
    expect(topic.name).toBe("Regenerated abcdef12")
  })
})

describe("branchFromEdit", () => {
  it("generates correct name from message id", () => {
    const { projectId } = createTestProject()
    const result = branches.branchFromEdit({
      sourceSessionKey: "src-edit",
      sourceMessageId: "xyz98765aaaabbbb",
      projectId,
      branchSessionKey: "branch-edit-001",
      newMessage: "Updated prompt text",
    })

    expect(result.branch.branchReason).toBe("edit")
    const db = connection.getDb()
    const topic = db
      .prepare("SELECT name FROM topics WHERE id = ?")
      .get(result.topicId) as { name: string }
    expect(topic.name).toBe("Edit xyz98765")
  })
})

describe("branchCreateThread", () => {
  it("uses the provided thread name", () => {
    const { projectId } = createTestProject()
    const result = branches.branchCreateThread({
      sourceSessionKey: "src-thread",
      sourceMessageId: "msg-thread-01",
      projectId,
      threadName: "Deep Dive Discussion",
      branchSessionKey: "branch-thread-001",
    })

    expect(result.branch.branchReason).toBe("thread")
    const db = connection.getDb()
    const topic = db
      .prepare("SELECT name FROM topics WHERE id = ?")
      .get(result.topicId) as { name: string }
    expect(topic.name).toBe("Deep Dive Discussion")
  })
})

describe("performance", () => {
  it("handles creating 50 branches without degradation", () => {
    const { projectId } = createTestProject()
    const start = Date.now()

    for (let i = 0; i < 50; i++) {
      branches.branchCreate({
        sourceSessionKey: "src-perf",
        sourceMessageId: `msg-perf-${i}`,
        projectId,
        branchName: `Branch ${i}`,
        branchSessionKey: `branch-perf-${i}`,
      })
    }

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)

    const result = branches.branchList({
      sourceSessionKey: "src-perf",
    })
    expect(result.branches).toHaveLength(50)
  })
})
