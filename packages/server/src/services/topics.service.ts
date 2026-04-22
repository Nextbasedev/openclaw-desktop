import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  boolToSql,
  topicRowToJson,
  recordSyncTombstone,
  type TopicRow,
} from "../db/helpers.js"
import { enqueue } from "../sync/outbox.js"
import { kickSyncEngine } from "../sync/engine.js"

const TOPIC_COLUMNS = "id, project_id, name, archived, unread_count, sort_order, created_at, updated_at"

function fetchTopic(id: string) {
  const db = getDb()
  const row = db.prepare(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE id = ?`).get(id) as TopicRow | undefined
  if (!row) throw new Error(`Topic not found: ${id}`)
  return topicRowToJson(row)
}

export function topicsList(input: { projectId: string }) {
  const db = getDb()
  const rows = db.prepare(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE project_id = ? ORDER BY sort_order ASC, updated_at DESC`).all(input.projectId) as TopicRow[]
  return { topics: rows.map(topicRowToJson) }
}

export function topicsCreate(input: { projectId: string; name: string }) {
  if (!input.name.trim()) throw new Error("Name cannot be empty")
  const db = getDb()

  const dup = db.prepare("SELECT COUNT(*) as c FROM topics WHERE project_id = ? AND name = ? COLLATE NOCASE").get(input.projectId, input.name.trim()) as { c: number }
  if (dup.c > 0) throw new Error(`A topic named '${input.name.trim()}' already exists in this project`)

  const id = generateId("topic")
  const sortOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM topics WHERE project_id = ?").get(input.projectId) as { next: number }).next
  const now = nowIso()
  db.prepare(
    "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
  ).run(id, input.projectId, input.name, sortOrder, now, now)
  enqueue("topic", id, "upsert")
  kickSyncEngine()
  return { topic: fetchTopic(id) }
}

export function topicsUpdate(input: { topicId: string; name?: string; sortOrder?: number }) {
  const db = getDb()
  const existing = db.prepare("SELECT name, sort_order FROM topics WHERE id = ?").get(input.topicId) as { name: string; sort_order: number } | undefined
  if (!existing) throw new Error(`Topic not found: ${input.topicId}`)

  db.prepare("UPDATE topics SET name = ?, sort_order = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?").run(
    input.name ?? existing.name,
    input.sortOrder ?? existing.sort_order,
    nowIso(),
    input.topicId,
  )
  enqueue("topic", input.topicId, "upsert")
  kickSyncEngine()
  return { topic: fetchTopic(input.topicId) }
}

export function topicsArchive(input: { topicId: string; archived?: boolean }) {
  const archived = input.archived ?? true
  const db = getDb()
  const changes = db.prepare("UPDATE topics SET archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?").run(boolToSql(archived), nowIso(), input.topicId)
  if (changes.changes === 0) throw new Error(`Topic not found: ${input.topicId}`)
  enqueue("topic", input.topicId, "upsert")
  kickSyncEngine()
  return { ok: true, topicId: input.topicId, archived }
}

export function topicsDelete(input: { topicId: string }) {
  const db = getDb()
  const exists = (db.prepare("SELECT COUNT(*) as c FROM topics WHERE id = ?").get(input.topicId) as { c: number }).c > 0
  if (!exists) throw new Error(`Topic not found: ${input.topicId}`)

  const now = nowIso()
  const tx = db.transaction(() => {
    db.prepare("UPDATE session_mappings SET topic_id = NULL, updated_at = ?, sync_dirty = 1 WHERE topic_id = ?").run(now, input.topicId)
    db.prepare("UPDATE branches SET branch_topic_id = NULL WHERE branch_topic_id = ?").run(input.topicId)
    db.prepare("UPDATE terminal_sessions SET topic_id = NULL WHERE topic_id = ?").run(input.topicId)
    db.prepare("DELETE FROM topic_git_context WHERE topic_id = ?").run(input.topicId)
    db.prepare("DELETE FROM topics WHERE id = ?").run(input.topicId)
    recordSyncTombstone(db, "topic", input.topicId)
  })
  tx()
  enqueue("topic", input.topicId, "delete")
  kickSyncEngine()
  return { ok: true, topicId: input.topicId }
}

export function topicsAttachSession(input: { topicId: string; sessionKey: string }) {
  const db = getDb()
  const changes = db.prepare("UPDATE session_mappings SET topic_id = ?, updated_at = ?, sync_dirty = 1 WHERE session_key = ?").run(input.topicId, nowIso(), input.sessionKey)
  if (changes.changes === 0) throw new Error(`Session mapping not found: ${input.sessionKey}`)
  return { ok: true, topicId: input.topicId, sessionKey: input.sessionKey }
}

export function topicsRename(input: { topicId: string; name: string }) {
  if (!input.name.trim()) throw new Error("Name cannot be empty")
  const db = getDb()
  const changes = db.prepare(
    "UPDATE topics SET name = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
  ).run(input.name.trim(), nowIso(), input.topicId)
  if (changes.changes === 0) throw new Error(`Topic not found: ${input.topicId}`)
  enqueue("topic", input.topicId, "upsert")
  kickSyncEngine()
  return { topic: fetchTopic(input.topicId) }
}

export function topicsDetachSession(input: { topicId: string; sessionKey: string }) {
  const db = getDb()
  const changes = db.prepare("UPDATE session_mappings SET topic_id = NULL, updated_at = ?, sync_dirty = 1 WHERE session_key = ?").run(nowIso(), input.sessionKey)
  if (changes.changes === 0) throw new Error(`Session mapping not found: ${input.sessionKey}`)
  return { ok: true, topicId: input.topicId, sessionKey: input.sessionKey }
}
