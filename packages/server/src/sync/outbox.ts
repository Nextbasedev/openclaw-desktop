import type Database from "better-sqlite3"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"
import type { SyncKind } from "./encoding.js"

export type OutboxOp = "upsert" | "delete"

export type OutboxRow = {
  id: number
  entity_type: SyncKind
  entity_id: string
  op: OutboxOp
  enqueued_at: string
  attempts: number
  next_attempt_at: string
  last_error: string | null
}

export function enqueue(
  entityType: SyncKind,
  entityId: string,
  op: OutboxOp,
  db: Database.Database = getDb(),
): void {
  const now = nowIso()
  db.prepare(
    "DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ?",
  ).run(entityType, entityId)
  db.prepare(
    `INSERT INTO sync_outbox (entity_type, entity_id, op, enqueued_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entityType, entityId, op, now, now)
}

export function claimDueTasks(
  limit: number = 25,
  db: Database.Database = getDb(),
): OutboxRow[] {
  return db
    .prepare(
      `SELECT * FROM sync_outbox WHERE next_attempt_at <= ? ORDER BY id LIMIT ?`,
    )
    .all(nowIso(), limit) as OutboxRow[]
}

export function markDone(id: number, db: Database.Database = getDb()): void {
  db.prepare("DELETE FROM sync_outbox WHERE id = ?").run(id)
}

export function markFailed(
  id: number,
  error: string,
  db: Database.Database = getDb(),
): void {
  const row = db
    .prepare("SELECT attempts FROM sync_outbox WHERE id = ?")
    .get(id) as { attempts: number } | undefined
  if (!row) return
  const attempts = row.attempts + 1
  const backoffMs = Math.min(60_000, 1000 * Math.pow(2, attempts))
  const next = new Date(Date.now() + backoffMs).toISOString()
  db.prepare(
    "UPDATE sync_outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
  ).run(attempts, error.slice(0, 500), next, id)
}
