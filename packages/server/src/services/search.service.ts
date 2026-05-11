import { createHash } from "node:crypto"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"

type SearchProjectResult = {
  id: string
  name: string
  topicCount: number
  sessionCount: number
}

type SearchTopicResult = {
  id: string
  name: string
  projectId: string
  projectName: string
  sessionCount: number
}

type SearchChatResult = {
  id: string
  name: string
  sessionKey?: string
  projectId?: string
  projectName?: string
  topicId?: string
  topicName?: string
}

type SearchMessageResult = {
  id: string
  sessionKey: string
  messageId?: string
  role: string
  snippet: string
  chatId?: string
  chatName?: string
  projectId?: string
  projectName?: string
  topicId?: string
  topicName?: string
  createdAt?: string
}

function trimmedQuery(value: string) {
  return value.trim()
}

function likePattern(query: string) {
  return `%${query.replace(/[%_]/g, "\\$&")}%`
}

function rankCaseSql(column: string) {
  return `CASE
    WHEN lower(${column}) = lower(?) THEN 0
    WHEN lower(${column}) LIKE lower(?) THEN 1
    ELSE 2
  END`
}

function ftsQuery(query: string) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .slice(0, 8)
  if (terms.length === 0) return null
  return terms.map((term) => `${term}*`).join(" ")
}

function textFromMessage(message: {
  text?: string
  content?: unknown
}) {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim()
  }
  if (!Array.isArray(message.content)) return ""
  const parts = message.content
    .map((item) => {
      if (!item || typeof item !== "object") return ""
      const record = item as { type?: unknown; text?: unknown }
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : ""
    })
    .filter(Boolean)
  return parts.join("\n").trim()
}

function messageIndexId(
  sessionKey: string,
  role: string,
  text: string,
  createdAt?: string,
  messageId?: string,
) {
  return createHash("sha1")
    .update(`${sessionKey}\n${role}\n${createdAt ?? ""}\n${messageId ?? ""}\n${text}`)
    .digest("hex")
}

export function indexChatMessage(input: {
  sessionKey: string
  role: string
  text: string
  createdAt?: string
  messageId?: string
}) {
  const text = input.text.trim()
  if (!text) return
  const db = getDb()
  const id = messageIndexId(
    input.sessionKey,
    input.role,
    text,
    input.createdAt,
    input.messageId,
  )
  db.prepare(
    `INSERT INTO search_messages (id, session_key, message_id, role, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       message_id = excluded.message_id,
       body = excluded.body,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    input.sessionKey,
    input.messageId ?? null,
    input.role,
    text.slice(0, 8000),
    input.createdAt ?? null,
    nowIso(),
  )
}

export function indexChatMessages(input: {
  sessionKey: string
  messages: Array<{
    id?: string
    role?: string
    text?: string
    content?: unknown
    createdAt?: string
  }>
}) {
  for (const message of input.messages) {
    const role = typeof message.role === "string" ? message.role : ""
    if (role !== "user" && role !== "assistant") continue
    const text = textFromMessage(message)
    if (!text) continue
    indexChatMessage({
      sessionKey: input.sessionKey,
      role,
      text,
      createdAt: message.createdAt,
      messageId: message.id,
    })
  }
}

export function removeIndexedSessionMessages(sessionKey: string) {
  getDb().prepare("DELETE FROM search_messages WHERE session_key = ?").run(sessionKey)
}

let backfillPromise: Promise<{ indexedSessions: number }> | null = null

function indexedSessionCount(sessionKey: string) {
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM search_messages WHERE session_key = ?")
    .get(sessionKey) as { c: number }
  return row.c
}

async function backfillSession(sessionKey: string) {
  if (indexedSessionCount(sessionKey) > 0) return false
  const chat = await import("./chat.service.js")
  const history = await chat.chatHistory({ sessionKey })
  indexChatMessages({
    sessionKey,
    messages: (history.messages ?? []) as Array<{
      id?: string
      role?: string
      text?: string
      content?: unknown
      createdAt?: string
    }>,
  })
  return true
}

function loadBackfillCandidates(query?: string, limit = 6) {
  const db = getDb()
  const params: Array<string | number> = []
  let sql = `
    SELECT DISTINCT candidate.session_key AS sessionKey
    FROM (
      SELECT sm.session_key, sm.updated_at, sm.label, c.name AS chat_name, t.name AS topic_name, p.name AS project_name
      FROM session_mappings sm
      LEFT JOIN chats c ON c.session_key = sm.session_key
      LEFT JOIN topics t ON t.id = sm.topic_id
      LEFT JOIN projects p ON p.id = sm.project_id
      WHERE sm.hidden = 0
      UNION
      SELECT c.session_key, c.updated_at, c.name AS label, c.name AS chat_name, NULL AS topic_name, NULL AS project_name
      FROM chats c
      WHERE c.archived = 0 AND c.session_key IS NOT NULL
    ) candidate
    WHERE candidate.session_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM search_messages idx WHERE idx.session_key = candidate.session_key LIMIT 1
      )
  `
  if (query) {
    const pattern = likePattern(query)
    sql += `
      AND (
        candidate.label LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        candidate.chat_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        candidate.topic_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        candidate.project_name LIKE ? ESCAPE '\\' COLLATE NOCASE
      )
    `
    params.push(pattern, pattern, pattern, pattern)
  }
  sql += " ORDER BY candidate.updated_at DESC LIMIT ?"
  params.push(limit)
  return db.prepare(sql).all(...params) as Array<{ sessionKey: string }>
}

export async function searchBackfill(input?: { query?: string; limit?: number }) {
  if (backfillPromise) return backfillPromise
  const limit = Math.max(1, Math.min(input?.limit ?? 6, 20))
  const query = input?.query?.trim()
  backfillPromise = (async () => {
    const candidates = loadBackfillCandidates(query, limit)
    let indexedSessions = 0
    for (const candidate of candidates) {
      try {
        const indexed = await backfillSession(candidate.sessionKey)
        if (indexed) indexedSessions += 1
      } catch {}
    }
    return { indexedSessions }
  })()
  try {
    return await backfillPromise
  } finally {
    backfillPromise = null
  }
}

export function searchGlobal(input: { query: string; limit?: number }) {
  const query = trimmedQuery(input.query)
  if (!query) {
    return { projects: [], topics: [], chats: [], messages: [] }
  }

  const db = getDb()
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20))
  const exact = query
  const prefix = `${query}%`
  const pattern = likePattern(query)

  const projects = db.prepare(
    `SELECT
       p.id,
       p.name,
       (SELECT COUNT(*) FROM topics t WHERE t.project_id = p.id AND t.archived = 0) AS topicCount,
       (SELECT COUNT(*) FROM session_mappings sm WHERE sm.project_id = p.id AND sm.hidden = 0) AS sessionCount
     FROM projects p
     WHERE p.archived = 0 AND p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY ${rankCaseSql("p.name")}, p.pinned DESC, p.updated_at DESC
     LIMIT ?`,
  ).all(pattern, exact, prefix, limit) as SearchProjectResult[]

  const topics = db.prepare(
    `SELECT
       t.id,
       t.name,
       t.project_id AS projectId,
       p.name AS projectName,
       (SELECT COUNT(*) FROM session_mappings sm WHERE sm.topic_id = t.id AND sm.hidden = 0) AS sessionCount
     FROM topics t
     JOIN projects p ON p.id = t.project_id
     WHERE t.archived = 0
       AND p.archived = 0
       AND t.name LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY ${rankCaseSql("t.name")}, t.updated_at DESC
     LIMIT ?`,
  ).all(pattern, exact, prefix, limit) as SearchTopicResult[]

  const chats = db.prepare(
    `SELECT
       c.id,
       c.name,
       c.session_key AS sessionKey,
       sm.project_id AS projectId,
       p.name AS projectName,
       sm.topic_id AS topicId,
       t.name AS topicName
     FROM chats c
     LEFT JOIN session_mappings sm ON sm.session_key = c.session_key
     LEFT JOIN projects p ON p.id = sm.project_id
     LEFT JOIN topics t ON t.id = sm.topic_id
     WHERE c.archived = 0 AND c.name LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY ${rankCaseSql("c.name")}, c.pinned DESC, c.updated_at DESC
     LIMIT ?`,
  ).all(pattern, exact, prefix, limit) as SearchChatResult[]

  const fts = ftsQuery(query)
  const messages = fts
    ? (db.prepare(
        `SELECT
           sm.id,
           sm.session_key AS sessionKey,
           sm.message_id AS messageId,
           sm.role,
           snippet(search_messages_fts, 0, '', '', ' ... ', 14) AS snippet,
           c.id AS chatId,
           c.name AS chatName,
           p.id AS projectId,
           p.name AS projectName,
           t.id AS topicId,
           t.name AS topicName,
           sm.created_at AS createdAt
         FROM search_messages_fts
         JOIN search_messages sm ON sm.rowid = search_messages_fts.rowid
         LEFT JOIN chats c ON c.session_key = sm.session_key AND c.archived = 0
         LEFT JOIN session_mappings map ON map.session_key = sm.session_key AND map.hidden = 0
         LEFT JOIN projects p ON p.id = map.project_id AND p.archived = 0
         LEFT JOIN topics t ON t.id = map.topic_id AND t.archived = 0
         WHERE search_messages_fts MATCH ?
         ORDER BY bm25(search_messages_fts), sm.created_at DESC
         LIMIT ?`,
      ).all(fts, limit) as SearchMessageResult[])
    : []

  return { projects, topics, chats, messages }
}
