import { getDb } from "../db/connection.js"
import { getAppSetting, setAppSetting } from "../db/helpers.js"
import { enqueue } from "./outbox.js"

const BACKFILL_FLAG = "sync.backfill.done"

export function runBackfillIfNeeded(): { enqueued: number; skipped: boolean } {
  const db = getDb()
  if (getAppSetting(db, BACKFILL_FLAG) === "1") {
    return { enqueued: 0, skipped: true }
  }

  const projects = db
    .prepare(
      `SELECT p.id FROM projects p
       LEFT JOIN anchor_sessions a ON a.entity_type = 'project' AND a.entity_id = p.id
       WHERE a.session_key IS NULL`,
    )
    .all() as Array<{ id: string }>

  const topics = db
    .prepare(
      `SELECT t.id FROM topics t
       LEFT JOIN anchor_sessions a ON a.entity_type = 'topic' AND a.entity_id = t.id
       WHERE a.session_key IS NULL`,
    )
    .all() as Array<{ id: string }>

  const chats = db
    .prepare(
      `SELECT id FROM chats WHERE session_key IS NOT NULL AND deleted_at IS NULL`,
    )
    .all() as Array<{ id: string }>

  for (const p of projects) enqueue("project", p.id, "upsert")
  for (const t of topics) enqueue("topic", t.id, "upsert")
  for (const c of chats) enqueue("chat", c.id, "upsert")

  setAppSetting(db, BACKFILL_FLAG, "1")
  return {
    enqueued: projects.length + topics.length + chats.length,
    skipped: false,
  }
}

export function forceBackfill(): { enqueued: number } {
  const db = getDb()
  setAppSetting(db, BACKFILL_FLAG, "0")
  const result = runBackfillIfNeeded()
  return { enqueued: result.enqueued }
}
