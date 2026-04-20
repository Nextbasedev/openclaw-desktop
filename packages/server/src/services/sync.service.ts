import { getDb } from "../db/connection.js"
import { nowIso, getAppSetting, setAppSetting, recordSyncTombstone } from "../db/helpers.js"
import { pullOnce } from "../sync/pull.js"
import { forceBackfill } from "../sync/backfill.js"
import { kickSyncEngine } from "../sync/engine.js"

export function syncStatus() {
  const db = getDb()
  const deviceId = getAppSetting(db, "sync.device_id")
  const lastSyncAt = getAppSetting(db, "sync.last_sync_at")

  const dirtyProjects = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE sync_dirty = 1").get() as { c: number }).c
  const dirtyTopics = (db.prepare("SELECT COUNT(*) as c FROM topics WHERE sync_dirty = 1").get() as { c: number }).c
  const dirtySessions = (db.prepare("SELECT COUNT(*) as c FROM session_mappings WHERE sync_dirty = 1").get() as { c: number }).c
  const dirtyBranches = (db.prepare("SELECT COUNT(*) as c FROM branches WHERE sync_dirty = 1").get() as { c: number }).c
  const tombstoneCount = (db.prepare("SELECT COUNT(*) as c FROM sync_tombstones").get() as { c: number }).c

  return {
    deviceId,
    lastSyncAt,
    dirtyCount: dirtyProjects + dirtyTopics + dirtySessions + dirtyBranches,
    tombstoneCount,
    breakdown: {
      projects: dirtyProjects,
      topics: dirtyTopics,
      sessions: dirtySessions,
      branches: dirtyBranches,
    },
  }
}

export function syncMarkClean(input: { table: string; ids: string[] }) {
  const db = getDb()
  const allowed = ["projects", "topics", "session_mappings", "branches"]
  if (!allowed.includes(input.table)) throw new Error(`Cannot mark clean: unknown table '${input.table}'`)
  const idCol = input.table === "session_mappings" ? "session_key" : "id"
  const placeholders = input.ids.map(() => "?").join(",")
  db.prepare(`UPDATE ${input.table} SET sync_dirty = 0 WHERE ${idCol} IN (${placeholders})`).run(...input.ids)
  return { ok: true, table: input.table, cleaned: input.ids.length }
}

export function syncPurgeTombstones() {
  const db = getDb()
  const now = nowIso()
  const result = db.prepare("DELETE FROM sync_tombstones WHERE expires_at < ?").run(now)
  return { ok: true, purged: result.changes }
}

export function syncSetDeviceId(input: { deviceId: string }) {
  const db = getDb()
  setAppSetting(db, "sync.device_id", input.deviceId)
  return { ok: true, deviceId: input.deviceId }
}

export function syncBackfillNow() {
  const result = forceBackfill()
  kickSyncEngine()
  return { ok: true, enqueued: result.enqueued }
}

export async function syncPullNow() {
  const result = await pullOnce()
  const db = getDb()
  const projects = db
    .prepare(
      "SELECT id, name, profile_id, workspace_root, repo_root, archived, pinned, updated_at FROM projects WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC",
    )
    .all()
  const topics = db
    .prepare(
      "SELECT id, project_id, name, archived, sort_order_key, updated_at FROM topics WHERE deleted_at IS NULL ORDER BY project_id, sort_order_key, updated_at DESC",
    )
    .all()
  const chats = db
    .prepare(
      `SELECT c.id, c.name, c.session_key, c.agent_id, c.archived, c.pinned,
              c.last_active_at, c.updated_at, sm.project_id, sm.topic_id
       FROM chats c
       LEFT JOIN session_mappings sm ON sm.session_key = c.session_key
       WHERE c.deleted_at IS NULL
       ORDER BY c.pinned DESC, c.updated_at DESC`,
    )
    .all()
  return {
    pulledAt: nowIso(),
    seen: result.seen,
    applied: result.applied,
    projects,
    topics,
    chats,
  }
}
