import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  branchRowToJson,
  recordSyncTombstone,
  type BranchRow,
} from "../db/helpers.js"

const BRANCH_COLUMNS =
  "id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json"

export function branchCreate(input: {
  sourceSessionKey: string
  sourceMessageId: string
  projectId: string
  branchName: string
  branchReason?: string
  branchSessionKey: string
}) {
  const db = getDb()
  const now = nowIso()
  const branchId = generateId("branch")
  const topicId = generateId("topic")

  const tx = db.transaction(() => {
    const sortOrder = (
      db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM topics WHERE project_id = ?",
        )
        .get(input.projectId) as { next: number }
    ).next

    db.prepare(
      "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
    ).run(topicId, input.projectId, input.branchName, sortOrder, now, now)

    db.prepare(
      "INSERT OR REPLACE INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, 'main', ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    ).run(
      input.branchSessionKey,
      input.projectId,
      topicId,
      input.branchName,
      now,
      now,
    )

    db.prepare(
      `INSERT INTO branches (${BRANCH_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      branchId,
      input.sourceSessionKey,
      input.sourceMessageId,
      input.branchSessionKey,
      topicId,
      input.branchReason ?? null,
      now,
    )
  })
  tx()

  const row = db
    .prepare(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = ?`,
    )
    .get(branchId) as BranchRow

  return {
    branch: branchRowToJson(row),
    topicId,
    sessionKey: input.branchSessionKey,
  }
}

export function branchList(input: { sourceSessionKey: string }) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE source_session_key = ? ORDER BY created_at DESC`,
    )
    .all(input.sourceSessionKey) as BranchRow[]
  return { branches: rows.map(branchRowToJson) }
}

export function branchGet(input: { branchSessionKey: string }) {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE branch_session_key = ?`,
    )
    .get(input.branchSessionKey) as BranchRow | undefined
  if (!row) throw new Error("Branch not found")
  return { branch: branchRowToJson(row) }
}

export function branchDelete(input: { branchSessionKey: string }) {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT id, branch_topic_id FROM branches WHERE branch_session_key = ?",
    )
    .get(input.branchSessionKey) as
    | { id: string; branch_topic_id: string | null }
    | undefined
  if (!row) throw new Error("Branch not found")

  const topicId = row.branch_topic_id

  const tx = db.transaction(() => {
    recordSyncTombstone(db, "branch", row.id)

    db.prepare("DELETE FROM branches WHERE id = ?").run(row.id)

    if (topicId) {
      db.prepare(
        "UPDATE topics SET archived = 1, updated_at = ?, sync_dirty = 1 WHERE id = ?",
      ).run(nowIso(), topicId)
    }

    try {
      db.prepare(
        "UPDATE session_mappings SET hidden = 1, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
      ).run(nowIso(), input.branchSessionKey)
    } catch {
      // ignore errors when hiding session mapping
    }
  })
  tx()

  return {
    deleted: true,
    branchSessionKey: input.branchSessionKey,
    topicArchived: topicId,
  }
}

export function branchFromRegenerate(input: {
  sourceSessionKey: string
  sourceMessageId: string
  projectId: string
  branchSessionKey: string
}) {
  const shortId = input.sourceMessageId.slice(0, 8)
  return branchCreate({
    sourceSessionKey: input.sourceSessionKey,
    sourceMessageId: input.sourceMessageId,
    projectId: input.projectId,
    branchName: `Regenerated ${shortId}`,
    branchReason: "regenerate",
    branchSessionKey: input.branchSessionKey,
  })
}

export function branchFromEdit(input: {
  sourceSessionKey: string
  sourceMessageId: string
  projectId: string
  branchSessionKey: string
  newMessage: string
}) {
  const shortId = input.sourceMessageId.slice(0, 8)
  return branchCreate({
    sourceSessionKey: input.sourceSessionKey,
    sourceMessageId: input.sourceMessageId,
    projectId: input.projectId,
    branchName: `Edit ${shortId}`,
    branchReason: "edit",
    branchSessionKey: input.branchSessionKey,
  })
}

export function branchCreateThread(input: {
  sourceSessionKey: string
  sourceMessageId: string
  projectId: string
  threadName: string
  branchSessionKey: string
}) {
  return branchCreate({
    sourceSessionKey: input.sourceSessionKey,
    sourceMessageId: input.sourceMessageId,
    projectId: input.projectId,
    branchName: input.threadName,
    branchReason: "thread",
    branchSessionKey: input.branchSessionKey,
  })
}
