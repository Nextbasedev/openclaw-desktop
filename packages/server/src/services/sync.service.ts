import { getDb } from "../db/connection.js"
import { nowIso, getAppSetting, setAppSetting, recordSyncTombstone } from "../db/helpers.js"

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
