import type Database from "better-sqlite3"
import { listGatewaySessions } from "middleware"
import { getDb } from "../db/connection.js"
import { boolToSql, nowIso } from "../db/helpers.js"
import { decodeLabel, isAnchorKey, type SyncPayload } from "./encoding.js"
import { rememberAnchor } from "./anchor.js"

function tombstoneAt(
  db: Database.Database,
  entityType: string,
  entityId: string,
): string | null {
  const row = db
    .prepare(
      "SELECT deleted_at FROM sync_tombstones WHERE entity_type = ? AND entity_id = ?",
    )
    .get(entityType, entityId) as { deleted_at: string } | undefined
  return row?.deleted_at ?? null
}

function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  if (!b) return true
  return a > b
}

function applyProject(payload: SyncPayload, sessionKey: string): void {
  const db = getDb()
  const projectId = payload.ids.projectId
  const tombstone = tombstoneAt(db, "project", projectId)
  if (tombstone && isNewer(tombstone, payload.updatedAt)) return

  rememberAnchor("project", projectId, sessionKey)

  if (payload.deletedAt) {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId)
    return
  }

  const existing = db
    .prepare("SELECT updated_at FROM projects WHERE id = ?")
    .get(projectId) as { updated_at: string } | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO projects (id, name, profile_id, workspace_root, repo_root,
       archived, unread_count, created_at, updated_at, pinned, sync_dirty,
       updated_by_device, sort_order)
       VALUES (?, ?, 'default', '', NULL, ?, 0, ?, ?, ?, 0, ?, ?)`,
    ).run(
      projectId,
      payload.names.projectName ?? "Untitled",
      boolToSql(payload.project?.archived ?? false),
      payload.updatedAt,
      payload.updatedAt,
      boolToSql(payload.project?.pinned ?? false),
      payload.updatedBy,
      payload.project?.sortOrderKey ?? null,
    )
    return
  }

  if (!isNewer(payload.updatedAt, existing.updated_at)) return

  db.prepare(
    `UPDATE projects SET name = ?, archived = ?, pinned = ?, sort_order = ?,
     updated_at = ?, updated_by_device = ?, sync_dirty = 0 WHERE id = ?`,
  ).run(
    payload.names.projectName ?? "Untitled",
    boolToSql(payload.project?.archived ?? false),
    boolToSql(payload.project?.pinned ?? false),
    payload.project?.sortOrderKey ?? null,
    payload.updatedAt,
    payload.updatedBy,
    projectId,
  )
}

function applyTopic(payload: SyncPayload, sessionKey: string): void {
  const db = getDb()
  const topicId = payload.ids.topicId
  if (!topicId) return
  const tombstone = tombstoneAt(db, "topic", topicId)
  if (tombstone && isNewer(tombstone, payload.updatedAt)) return

  rememberAnchor("topic", topicId, sessionKey)

  if (payload.deletedAt) {
    db.prepare("DELETE FROM topics WHERE id = ?").run(topicId)
    return
  }

  const existing = db
    .prepare("SELECT updated_at FROM topics WHERE id = ?")
    .get(topicId) as { updated_at: string } | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order,
       created_at, updated_at, updated_by_device, sort_order_key, sync_dirty)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 0)`,
    ).run(
      topicId,
      payload.ids.projectId,
      payload.names.topicName ?? "Untitled",
      boolToSql(payload.topic?.archived ?? false),
      payload.updatedAt,
      payload.updatedAt,
      payload.updatedBy,
      payload.topic?.sortOrderKey ?? null,
    )
    return
  }

  if (!isNewer(payload.updatedAt, existing.updated_at)) return

  db.prepare(
    `UPDATE topics SET project_id = ?, name = ?, archived = ?,
     sort_order_key = ?, updated_at = ?, updated_by_device = ?, sync_dirty = 0
     WHERE id = ?`,
  ).run(
    payload.ids.projectId,
    payload.names.topicName ?? "Untitled",
    boolToSql(payload.topic?.archived ?? false),
    payload.topic?.sortOrderKey ?? null,
    payload.updatedAt,
    payload.updatedBy,
    topicId,
  )
}

function applyChat(payload: SyncPayload, sessionKey: string): void {
  const db = getDb()
  const chatId = payload.ids.chatId
  if (!chatId) return
  const tombstone = tombstoneAt(db, "chat", chatId)
  if (tombstone && isNewer(tombstone, payload.updatedAt)) return

  if (payload.deletedAt) {
    db.prepare("DELETE FROM chats WHERE id = ?").run(chatId)
    return
  }

  const existingChat = db
    .prepare("SELECT updated_at FROM chats WHERE id = ?")
    .get(chatId) as { updated_at: string } | undefined

  if (!existingChat) {
    db.prepare(
      `INSERT INTO chats (id, name, session_key, agent_id, archived, pinned,
       last_active_at, created_at, updated_at, sync_dirty, updated_by_device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      chatId,
      payload.names.chatName ?? "New Chat",
      sessionKey,
      payload.chat?.agentId ?? "main",
      boolToSql(payload.chat?.archived ?? false),
      boolToSql(payload.chat?.pinned ?? false),
      payload.chat?.lastActiveAt ?? null,
      payload.updatedAt,
      payload.updatedAt,
      payload.updatedBy,
    )
  } else if (isNewer(payload.updatedAt, existingChat.updated_at)) {
    db.prepare(
      `UPDATE chats SET name = ?, session_key = ?, agent_id = ?, archived = ?,
       pinned = ?, last_active_at = ?, updated_at = ?, updated_by_device = ?,
       sync_dirty = 0 WHERE id = ?`,
    ).run(
      payload.names.chatName ?? "New Chat",
      sessionKey,
      payload.chat?.agentId ?? "main",
      boolToSql(payload.chat?.archived ?? false),
      boolToSql(payload.chat?.pinned ?? false),
      payload.chat?.lastActiveAt ?? null,
      payload.updatedAt,
      payload.updatedBy,
      chatId,
    )
  }

  const existingMap = db
    .prepare("SELECT session_key FROM session_mappings WHERE session_key = ?")
    .get(sessionKey) as { session_key: string } | undefined

  if (!existingMap) {
    db.prepare(
      `INSERT INTO session_mappings (session_key, session_id, project_id, topic_id,
       agent_id, label, status, created_at, updated_at, pinned, hidden, source,
       sync_dirty, sort_order_key)
       VALUES (?, NULL, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis', 0, ?)`,
    ).run(
      sessionKey,
      payload.ids.projectId,
      payload.ids.topicId ?? null,
      payload.chat?.agentId ?? "main",
      payload.names.chatName ?? "New Chat",
      payload.updatedAt,
      payload.updatedAt,
      payload.chat?.sortOrderKey ?? null,
    )
  } else {
    db.prepare(
      `UPDATE session_mappings SET project_id = ?, topic_id = ?, agent_id = ?,
       label = ?, updated_at = ?, sort_order_key = ?, sync_dirty = 0
       WHERE session_key = ?`,
    ).run(
      payload.ids.projectId,
      payload.ids.topicId ?? null,
      payload.chat?.agentId ?? "main",
      payload.names.chatName ?? "New Chat",
      payload.updatedAt,
      payload.chat?.sortOrderKey ?? null,
      sessionKey,
    )
  }
}

export async function pullOnce(): Promise<{ seen: number; applied: number }> {
  const { sessions } = await listGatewaySessions({ limit: 500 })
  let applied = 0
  for (const session of sessions) {
    const decoded = decodeLabel(session.label)
    if (!decoded.payload) continue
    const payload = decoded.payload
    try {
      if (payload.kind === "project") applyProject(payload, session.key)
      else if (payload.kind === "topic") applyTopic(payload, session.key)
      else if (payload.kind === "chat") applyChat(payload, session.key)
      applied += 1
    } catch {
      // skip bad rows
    }
    const anchor = isAnchorKey(session.key)
    if (anchor && payload.ids) {
      const id =
        anchor.kind === "project"
          ? payload.ids.projectId
          : anchor.kind === "topic"
            ? (payload.ids.topicId ?? "")
            : (payload.ids.chatId ?? "")
      if (id) rememberAnchor(anchor.kind, id, session.key)
    }
  }
  const db = getDb()
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('sync.last_sync_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(nowIso(), nowIso())
  return { seen: sessions.length, applied }
}
