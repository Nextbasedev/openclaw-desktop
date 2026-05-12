import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  boolToSql,
  chatRowToJson,
  recordSyncTombstone,
  type ChatRow,
} from "../db/helpers.js"
import { enqueue } from "../sync/outbox.js"
import { kickSyncEngine } from "../sync/engine.js"
import { rememberAnchor } from "../sync/anchor.js"
import { removeIndexedSessionMessages } from "./search.service.js"

const CHAT_COLUMNS =
  "id, name, session_key, space_id, agent_id, archived, pinned, last_active_at, created_at, updated_at"

function fetchChat(id: string) {
  const db = getDb()
  const row = db
    .prepare(`SELECT ${CHAT_COLUMNS} FROM chats WHERE id = ?`)
    .get(id) as ChatRow | undefined
  if (!row) throw new Error(`Chat not found: ${id}`)
  return chatRowToJson(row)
}

export function chatsList(input?: { archived?: boolean; spaceId?: string | null }) {
  const db = getDb()
  const showArchived = input?.archived ?? false
  const rows = input?.spaceId
    ? db
      .prepare(
        `SELECT ${CHAT_COLUMNS} FROM chats WHERE archived = ? AND space_id = ? ORDER BY pinned DESC, updated_at DESC`,
      )
      .all(boolToSql(showArchived), input.spaceId) as ChatRow[]
    : db
      .prepare(
        `SELECT ${CHAT_COLUMNS} FROM chats WHERE archived = ? ORDER BY pinned DESC, updated_at DESC`,
      )
      .all(boolToSql(showArchived)) as ChatRow[]
  return { chats: rows.map(chatRowToJson) }
}

export function chatsCreate(input?: {
  name?: string
  agentId?: string
  sessionKey?: string
  spaceId?: string | null
}) {
  const db = getDb()
  const id = generateId("chat")
  const now = nowIso()
  const name = input?.name?.trim() || "New Chat"
  const agentId = input?.agentId || "main"

  db.prepare(
    `INSERT INTO chats (${CHAT_COLUMNS}) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(id, name, input?.sessionKey ?? null, input?.spaceId ?? null, agentId, now, now, now)

  enqueue("chat", id, "upsert")
  kickSyncEngine()
  return { chat: fetchChat(id) }
}

export function chatsGet(input: { chatId: string }) {
  return { chat: fetchChat(input.chatId) }
}

export function chatsUpdate(input: {
  chatId: string
  name?: string
  pinned?: boolean
  archived?: boolean
}) {
  const db = getDb()
  const existing = db
    .prepare("SELECT name, pinned, archived FROM chats WHERE id = ?")
    .get(input.chatId) as
    | { name: string; pinned: number; archived: number }
    | undefined
  if (!existing) throw new Error(`Chat not found: ${input.chatId}`)

  db.prepare(
    "UPDATE chats SET name = ?, pinned = ?, archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
  ).run(
    input.name ?? existing.name,
    input.pinned !== undefined
      ? boolToSql(input.pinned)
      : existing.pinned,
    input.archived !== undefined
      ? boolToSql(input.archived)
      : existing.archived,
    nowIso(),
    input.chatId,
  )
  enqueue("chat", input.chatId, "upsert")
  kickSyncEngine()
  return { chat: fetchChat(input.chatId) }
}

export function chatsRename(input: {
  chatId: string
  name: string
}) {
  if (!input.name.trim()) throw new Error("Name cannot be empty")
  const db = getDb()
  const trimmed = input.name.trim()
  const now = nowIso()
  const changes = db
    .prepare(
      "UPDATE chats SET name = ?, updated_at = ? WHERE id = ?",
    )
    .run(trimmed, now, input.chatId)
  if (changes.changes === 0)
    throw new Error(`Chat not found: ${input.chatId}`)
  return { chat: fetchChat(input.chatId) }
}

export function chatsArchive(input: {
  chatId: string
  archived?: boolean
}) {
  const archived = input.archived ?? true
  const db = getDb()
  const changes = db
    .prepare(
      "UPDATE chats SET archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    )
    .run(boolToSql(archived), nowIso(), input.chatId)
  if (changes.changes === 0)
    throw new Error(`Chat not found: ${input.chatId}`)
  enqueue("chat", input.chatId, "upsert")
  kickSyncEngine()
  return { ok: true, chatId: input.chatId, archived }
}

export function chatsDelete(input: { chatId: string }) {
  const db = getDb()
  const existing = db
    .prepare("SELECT session_key FROM chats WHERE id = ?")
    .get(input.chatId) as { session_key: string | null } | undefined
  if (!existing)
    throw new Error(`Chat not found: ${input.chatId}`)

  if (existing.session_key) rememberAnchor("chat", input.chatId, existing.session_key)

  enqueue("chat", input.chatId, "delete")
  db.prepare("DELETE FROM chats WHERE id = ?").run(input.chatId)
  if (existing.session_key) removeIndexedSessionMessages(existing.session_key)
  recordSyncTombstone(db, "chat", input.chatId)
  kickSyncEngine()
  return { ok: true, chatId: input.chatId }
}

export function chatsAttachSession(input: {
  chatId: string
  sessionKey: string
}) {
  const db = getDb()
  const changes = db
    .prepare(
      "UPDATE chats SET session_key = ?, last_active_at = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    )
    .run(input.sessionKey, nowIso(), nowIso(), input.chatId)
  if (changes.changes === 0)
    throw new Error(`Chat not found: ${input.chatId}`)
  rememberAnchor("chat", input.chatId, input.sessionKey)
  enqueue("chat", input.chatId, "upsert")
  kickSyncEngine()
  return {
    ok: true,
    chatId: input.chatId,
    sessionKey: input.sessionKey,
  }
}

export function chatsUpdateActivity(input: {
  chatId: string
}) {
  const db = getDb()
  db.prepare(
    "UPDATE chats SET last_active_at = ?, updated_at = ? WHERE id = ?",
  ).run(nowIso(), nowIso(), input.chatId)
  enqueue("chat", input.chatId, "upsert")
  kickSyncEngine()
}
