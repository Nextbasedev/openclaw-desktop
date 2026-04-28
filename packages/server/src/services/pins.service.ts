import { getDb } from "../db/connection.js"
import { nowIso, generateId } from "../db/helpers.js"

interface PinnedRow {
  id: string
  session_key: string
  message_id: string
  message_text: string
  pinned_at: string
}

function rowToJson(row: PinnedRow) {
  return {
    id: row.id,
    sessionKey: row.session_key,
    messageId: row.message_id,
    messageText: row.message_text,
    pinnedAt: row.pinned_at,
  }
}

export function pinsList(input: { sessionKey: string }) {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT * FROM pinned_messages WHERE session_key = ? ORDER BY pinned_at ASC",
    )
    .all(input.sessionKey) as PinnedRow[]
  return { pins: rows.map(rowToJson) }
}

export function pinsAdd(input: {
  sessionKey: string
  messageId: string
  messageText: string
}) {
  const db = getDb()
  console.log("[pins] add request:", JSON.stringify({ sessionKey: input.sessionKey, messageId: input.messageId, textPreview: input.messageText?.slice(0, 30) }))
  const id = generateId("pin")
  const now = nowIso()
  db.prepare(
    "INSERT OR IGNORE INTO pinned_messages (id, session_key, message_id, message_text, pinned_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.sessionKey, input.messageId, input.messageText, now)
  return { ok: true }
}

export function pinsRemove(input: {
  sessionKey: string
  messageId: string
  messageText?: string
}) {
  const db = getDb()
  const result = db
    .prepare(
      "DELETE FROM pinned_messages WHERE session_key = ? AND message_id = ?",
    )
    .run(input.sessionKey, input.messageId)
  if (result.changes === 0 && input.messageText) {
    db.prepare(
      "DELETE FROM pinned_messages WHERE session_key = ? AND message_text = ?",
    ).run(input.sessionKey, input.messageText)
  }
  return { ok: true }
}
