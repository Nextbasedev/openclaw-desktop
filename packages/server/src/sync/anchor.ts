import type Database from "better-sqlite3"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"
import type { SyncKind } from "./encoding.js"

export function getAnchorSessionKey(
  kind: SyncKind,
  entityId: string,
  db: Database.Database = getDb(),
): string | null {
  const row = db
    .prepare(
      "SELECT session_key FROM anchor_sessions WHERE entity_type = ? AND entity_id = ?",
    )
    .get(kind, entityId) as { session_key: string } | undefined
  return row?.session_key ?? null
}

export function rememberAnchor(
  kind: SyncKind,
  entityId: string,
  sessionKey: string,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `INSERT OR REPLACE INTO anchor_sessions (entity_type, entity_id, session_key, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(kind, entityId, sessionKey, nowIso())
}

export function forgetAnchor(
  kind: SyncKind,
  entityId: string,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    "DELETE FROM anchor_sessions WHERE entity_type = ? AND entity_id = ?",
  ).run(kind, entityId)
}
