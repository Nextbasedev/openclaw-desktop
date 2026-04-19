import crypto from "node:crypto"
import { getDb } from "../db/connection.js"
import {
  nowIso,
  boolToSql,
  sqlToBool,
  sessionRowToJson,
  recordSyncTombstone,
  type SessionRow,
} from "../db/helpers.js"

const SESSION_COLUMNS = "session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source"

export function sessionsList(input?: { projectId?: string; topicId?: string; includeExisting?: boolean }) {
  const db = getDb()
  const filter = input ?? {}
  let sql = `SELECT ${SESSION_COLUMNS} FROM session_mappings WHERE 1=1`
  const params: string[] = []

  if (filter.projectId) {
    sql += " AND project_id = ?"
    params.push(filter.projectId)
  }
  if (filter.topicId) {
    sql += " AND topic_id = ?"
    params.push(filter.topicId)
  }
  if (!filter.includeExisting) {
    sql += " AND source = 'jarvis'"
  }
  sql += " ORDER BY pinned DESC, updated_at DESC"

  const rows = db.prepare(sql).all(...params) as SessionRow[]
  return {
    sessions: rows.map(sessionRowToJson),
    sessionVisibility: filter.includeExisting ? "all-visible" : "jarvis-only",
  }
}

export function sessionsCreate(input: {
  projectId: string
  topicId?: string
  agentId: string
  label: string
  sessionKey?: string
}) {
  const db = getDb()
  const now = nowIso()
  const sessionKey = input.sessionKey ?? `sess_${crypto.randomUUID().replace(/-/g, "")}`
  db.prepare(
    `INSERT OR REPLACE INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')`,
  ).run(sessionKey, input.projectId, input.topicId ?? null, input.agentId, input.label, now, now)

  const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM session_mappings WHERE session_key = ?`).get(sessionKey) as SessionRow
  return { session: sessionRowToJson(row) }
}

export function sessionsUpdate(input: {
  sessionKey: string
  label?: string
  pinned?: boolean
  hidden?: boolean
  topicId?: string | null
}) {
  const db = getDb()
  const existing = db.prepare("SELECT label, pinned, hidden, topic_id FROM session_mappings WHERE session_key = ?").get(input.sessionKey) as
    | { label: string; pinned: number; hidden: number; topic_id: string | null }
    | undefined
  if (!existing) throw new Error(`Session mapping not found: ${input.sessionKey}`)

  db.prepare(
    "UPDATE session_mappings SET label = ?, pinned = ?, hidden = ?, topic_id = ?, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
  ).run(
    input.label ?? existing.label,
    boolToSql(input.pinned ?? sqlToBool(existing.pinned)),
    boolToSql(input.hidden ?? sqlToBool(existing.hidden)),
    input.topicId === undefined ? existing.topic_id : input.topicId,
    nowIso(),
    input.sessionKey,
  )

  const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM session_mappings WHERE session_key = ?`).get(input.sessionKey) as SessionRow
  return { session: sessionRowToJson(row) }
}

export function sessionsDelete(input: { sessionKey: string }) {
  const db = getDb()
  recordSyncTombstone(db, "session_mapping", input.sessionKey)
  db.prepare("DELETE FROM session_mappings WHERE session_key = ?").run(input.sessionKey)
  return { ok: true, sessionKey: input.sessionKey }
}

export function updateSessionMappingStatus(sessionKey: string, status: string): void {
  const db = getDb()
  db.prepare("UPDATE session_mappings SET status = ?, updated_at = ? WHERE session_key = ?").run(status, nowIso(), sessionKey)
}
