import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as projects from "../../services/projects.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

function createTestProfile() {
  return profiles.profilesCreate({
    name: "TestProf",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: os.tmpdir(),
  }).profile
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

describe("projects CRUD", () => {
  it("lists empty projects on fresh db", () => {
    const result = projects.projectsList()
    expect(result.projects).toEqual([])
  })

  it("creates and retrieves a project", () => {
    const prof = createTestProfile()
    const result = projects.projectsCreate({
      name: "My Project",
      profileId: prof.id,
      workspaceRoot: os.tmpdir(),
    })
    expect(result.project.name).toBe("My Project")
    expect(result.project.id).toMatch(/^proj_/)
    expect(result.project.profileId).toBe(prof.id)
    expect(result.project.archived).toBe(false)
    expect(result.project.pinned).toBe(false)

    const list = projects.projectsList()
    expect(list.projects).toHaveLength(1)
  })

  it("rejects empty name", () => {
    const prof = createTestProfile()
    expect(() =>
      projects.projectsCreate({ name: "  ", profileId: prof.id, workspaceRoot: "/tmp" }),
    ).toThrow("Name cannot be empty")
  })

  it("rejects whitespace-only name", () => {
    const prof = createTestProfile()
    expect(() =>
      projects.projectsCreate({ name: "\t\n", profileId: prof.id, workspaceRoot: "/tmp" }),
    ).toThrow("Name cannot be empty")
  })

  it("rejects duplicate name (case-insensitive)", () => {
    const prof = createTestProfile()
    projects.projectsCreate({ name: "Alpha", profileId: prof.id, workspaceRoot: "/tmp" })
    expect(() =>
      projects.projectsCreate({ name: "alpha", profileId: prof.id, workspaceRoot: "/tmp" }),
    ).toThrow("already exists")
  })

  it("handles unicode project names", () => {
    const prof = createTestProfile()
    const result = projects.projectsCreate({
      name: "Проект 日本語 🚀",
      profileId: prof.id,
      workspaceRoot: os.tmpdir(),
    })
    expect(result.project.name).toBe("Проект 日本語 🚀")
  })

  it("gets project with repo summary for valid workspace", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({
      name: "RepoTest",
      profileId: prof.id,
      workspaceRoot: process.cwd(),
      repoRoot: process.cwd(),
    })
    const result = projects.projectsGet({ projectId: created.project.id })
    expect(result.project.repo).toBeTruthy()
    expect(result.project.repo?.branch).toBeTruthy()
  })

  it("gets project with null repo for nonexistent path", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({
      name: "NoRepo",
      profileId: prof.id,
      workspaceRoot: "/nonexistent/path/xyz",
    })
    const result = projects.projectsGet({ projectId: created.project.id })
    expect(result.project.repo).toBeNull()
  })

  it("get rejects nonexistent project", () => {
    expect(() => projects.projectsGet({ projectId: "proj_ghost" })).toThrow("Project not found")
  })

  it("updates project fields", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "Original", profileId: prof.id, workspaceRoot: "/tmp" })
    const updated = projects.projectsUpdate({ projectId: created.project.id, name: "Renamed" })
    expect(updated.project.name).toBe("Renamed")
  })

  it("update rejects nonexistent project", () => {
    expect(() =>
      projects.projectsUpdate({ projectId: "proj_nonexistent", name: "X" }),
    ).toThrow("Project not found")
  })

  it("archives and unarchives a project", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "ToArchive", profileId: prof.id, workspaceRoot: "/tmp" })

    const archived = projects.projectsArchive({ projectId: created.project.id })
    expect(archived.archived).toBe(true)

    const unarchived = projects.projectsArchive({ projectId: created.project.id, archived: false })
    expect(unarchived.archived).toBe(false)
  })

  it("pins and unpins a project", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "ToPin", profileId: prof.id, workspaceRoot: "/tmp" })

    const pinned = projects.projectsPin({ projectId: created.project.id })
    expect(pinned.pinned).toBe(true)

    const unpinned = projects.projectsPin({ projectId: created.project.id, pinned: false })
    expect(unpinned.pinned).toBe(false)
  })

  it("pin rejects nonexistent project", () => {
    expect(() => projects.projectsPin({ projectId: "proj_ghost" })).toThrow("Project not found")
  })

  it("deletes a project with cascade", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "ToDelete", profileId: prof.id, workspaceRoot: "/tmp" })
    const result = projects.projectsDelete({ projectId: created.project.id })
    expect(result.ok).toBe(true)
    expect(projects.projectsList().projects).toHaveLength(0)
  })

  it("delete rejects nonexistent project", () => {
    expect(() => projects.projectsDelete({ projectId: "proj_ghost" })).toThrow("Project not found")
  })

  it("delete cascades topics and sessions", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "Cascade", profileId: prof.id, workspaceRoot: "/tmp" })
    const db = connection.getDb()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?)").run(
      "topic_1", created.project.id, "T", now, now,
    )
    db.prepare("INSERT INTO session_mappings (session_key, project_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')").run(
      "sk_1", created.project.id, "main", "S", now, now,
    )

    projects.projectsDelete({ projectId: created.project.id })

    const topicCount = (db.prepare("SELECT COUNT(*) as c FROM topics WHERE project_id = ?").get(created.project.id) as { c: number }).c
    const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM session_mappings WHERE project_id = ?").get(created.project.id) as { c: number }).c
    expect(topicCount).toBe(0)
    expect(sessionCount).toBe(0)
  })

  it("pinned projects sort before unpinned", () => {
    const prof = createTestProfile()
    projects.projectsCreate({ name: "A-Unpinned", profileId: prof.id, workspaceRoot: "/tmp" })
    const pinned = projects.projectsCreate({ name: "B-Pinned", profileId: prof.id, workspaceRoot: "/tmp" })
    projects.projectsPin({ projectId: pinned.project.id, pinned: true })

    const list = projects.projectsList()
    expect(list.projects[0].name).toBe("B-Pinned")
  })
})

describe("projects sidebar", () => {
  it("returns sidebar data for a project", () => {
    const prof = createTestProfile()
    const created = projects.projectsCreate({ name: "Sidebar", profileId: prof.id, workspaceRoot: "/tmp" })
    const sidebar = projects.projectsSidebar({ projectId: created.project.id })
    expect(sidebar.project.name).toBe("Sidebar")
    expect(sidebar.topics).toEqual([])
    expect(sidebar.sessions).toEqual([])
    expect(sidebar.agents).toHaveLength(1)
  })

  it("sidebar rejects nonexistent project", () => {
    expect(() => projects.projectsSidebar({ projectId: "proj_ghost" })).toThrow("Project not found")
  })
})

describe("performance", () => {
  it("handles creating 100 projects without degradation", () => {
    const prof = createTestProfile()
    const start = Date.now()
    for (let i = 0; i < 100; i++) {
      projects.projectsCreate({ name: `Project ${i}`, profileId: prof.id, workspaceRoot: "/tmp" })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)

    const list = projects.projectsList()
    expect(list.projects).toHaveLength(100)
  })
})
