import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  boolToSql,
  sqlToBool,
  projectRowToJson,
  topicRowToJson,
  sessionRowToJson,
  recordSyncTombstone,
  type ProjectRow,
  type TopicRow,
  type SessionRow,
} from "../db/helpers.js"
import { enqueue } from "../sync/outbox.js"
import { kickSyncEngine } from "../sync/engine.js"
import { removeIndexedSessionMessages } from "./search.service.js"

const PROJECT_COLUMNS = "id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at, pinned"

function fetchProject(id: string) {
  const db = getDb()
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project not found: ${id}`)
  return projectRowToJson(row)
}

function repoSummary(root: string) {
  if (!root || !fs.existsSync(root)) return null
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, timeout: 5000 }).toString().trim()
    const dirty = execSync("git status --porcelain", { cwd: root, timeout: 5000 }).toString().trim()
    return { branch, dirty: dirty.length > 0, dirtyCount: dirty ? dirty.split("\n").length : 0 }
  } catch {
    return null
  }
}

export function projectsList() {
  const db = getDb()
  const rows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY pinned DESC, updated_at DESC`).all() as ProjectRow[]
  return { projects: rows.map(projectRowToJson) }
}

export function projectsCreate(input: {
  name: string
  profileId: string
  workspaceRoot: string
  repoRoot?: string
}) {
  if (!input.name.trim()) throw new Error("Name cannot be empty")
  const db = getDb()

  const dup = db.prepare("SELECT COUNT(*) as c FROM projects WHERE name = ? COLLATE NOCASE").get(input.name.trim()) as { c: number }
  if (dup.c > 0) throw new Error(`A project named '${input.name.trim()}' already exists`)

  const id = generateId("proj")
  const now = nowIso()
  db.prepare(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)",
  ).run(id, input.name, input.profileId, input.workspaceRoot, input.repoRoot ?? null, now, now)
  enqueue("project", id, "upsert")
  kickSyncEngine()
  return { project: fetchProject(id) }
}

export function projectsGet(input: { projectId: string }) {
  const project = fetchProject(input.projectId)
  const root = (project.repoRoot || project.workspaceRoot) as string
  return { project: { ...project, repo: repoSummary(root) } }
}

export function projectsUpdate(input: {
  projectId: string
  name?: string
  workspaceRoot?: string
  repoRoot?: string
  archived?: boolean
}) {
  const db = getDb()
  const existing = db.prepare("SELECT name, workspace_root, repo_root, archived FROM projects WHERE id = ?").get(input.projectId) as
    | { name: string; workspace_root: string; repo_root: string | null; archived: number }
    | undefined
  if (!existing) throw new Error(`Project not found: ${input.projectId}`)

  db.prepare(
    "UPDATE projects SET name = ?, workspace_root = ?, repo_root = ?, archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
  ).run(
    input.name ?? existing.name,
    input.workspaceRoot ?? existing.workspace_root,
    input.repoRoot ?? existing.repo_root,
    boolToSql(input.archived ?? sqlToBool(existing.archived)),
    nowIso(),
    input.projectId,
  )
  enqueue("project", input.projectId, "upsert")
  kickSyncEngine()
  return { project: fetchProject(input.projectId) }
}

export function projectsArchive(input: { projectId: string; archived?: boolean }) {
  const archived = input.archived ?? true
  const db = getDb()
  db.prepare("UPDATE projects SET archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?").run(boolToSql(archived), nowIso(), input.projectId)
  enqueue("project", input.projectId, "upsert")
  kickSyncEngine()
  return { ok: true, projectId: input.projectId, archived }
}

export function projectsPin(input: { projectId: string; pinned?: boolean }) {
  const pinned = input.pinned ?? true
  const db = getDb()
  const changes = db.prepare("UPDATE projects SET pinned = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?").run(boolToSql(pinned), nowIso(), input.projectId)
  if (changes.changes === 0) throw new Error(`Project not found: ${input.projectId}`)
  enqueue("project", input.projectId, "upsert")
  kickSyncEngine()
  return { ok: true, projectId: input.projectId, pinned }
}

export function projectsDelete(input: { projectId: string }) {
  const db = getDb()
  const exists = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE id = ?").get(input.projectId) as { c: number }).c > 0
  if (!exists) throw new Error(`Project not found: ${input.projectId}`)

  const topicIds = db
    .prepare("SELECT id FROM topics WHERE project_id = ?")
    .all(input.projectId) as Array<{ id: string }>
  const chatIds = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN session_mappings sm ON sm.session_key = c.session_key
       WHERE sm.project_id = ?`,
    )
    .all(input.projectId) as Array<{ id: string }>
  const sessionKeys = db
    .prepare("SELECT session_key FROM session_mappings WHERE project_id = ?")
    .all(input.projectId) as Array<{ session_key: string }>

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM branches WHERE source_session_key IN (SELECT session_key FROM session_mappings WHERE project_id = ?)").run(input.projectId)
    db.prepare("DELETE FROM topic_git_context WHERE project_id = ?").run(input.projectId)
    db.prepare("DELETE FROM session_mappings WHERE project_id = ?").run(input.projectId)
    db.prepare("DELETE FROM topics WHERE project_id = ?").run(input.projectId)
    db.prepare("DELETE FROM projects WHERE id = ?").run(input.projectId)
    recordSyncTombstone(db, "project", input.projectId)
    for (const t of topicIds) recordSyncTombstone(db, "topic", t.id)
    for (const c of chatIds) recordSyncTombstone(db, "chat", c.id)
  })
  tx()
  for (const c of chatIds) enqueue("chat", c.id, "delete")
  for (const t of topicIds) enqueue("topic", t.id, "delete")
  for (const session of sessionKeys) removeIndexedSessionMessages(session.session_key)
  enqueue("project", input.projectId, "delete")
  kickSyncEngine()
  return { ok: true, projectId: input.projectId }
}

export function projectsSidebar(input: { projectId: string }) {
  const db = getDb()
  const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(input.projectId) as { name: string } | undefined
  if (!project) throw new Error(`Project not found: ${input.projectId}`)

  const topics = (db.prepare(
    "SELECT id, project_id, name, archived, unread_count, sort_order, created_at, updated_at FROM topics WHERE project_id = ? AND archived = 0 ORDER BY sort_order ASC, updated_at DESC",
  ).all(input.projectId) as TopicRow[]).map(topicRowToJson)

  const sessions = (db.prepare(
    "SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source FROM session_mappings WHERE project_id = ? AND hidden = 0 ORDER BY pinned DESC, updated_at DESC",
  ).all(input.projectId) as SessionRow[]).map(sessionRowToJson)

  return {
    project: { id: input.projectId, name: project.name },
    topics: topics.map((t) => ({ id: t.id, name: t.name, unreadCount: t.unreadCount })),
    agents: [{ id: "main", name: "Main", status: "online" }],
    sessions: sessions.map((s) => ({ key: s.key, title: s.label, status: s.status })),
    sessionVisibility: "jarvis-only",
  }
}
