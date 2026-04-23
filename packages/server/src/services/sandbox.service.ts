import { getDb } from "../db/connection.js"
import { chatDeleteSession } from "./chat.service.js"
import { chatsDelete } from "./chats.service.js"
import { sessionsDelete } from "./sessions.service.js"

type CleanupRow = {
  id?: string
  name?: string
  session_key?: string | null
  label?: string
}

const AUDIT_CHAT_PREFIXES = [
  "Jarvis audit smoke ",
]

const AUDIT_SESSION_LABEL_PREFIXES = [
  "Jarvis topic audit smoke ",
]

function startsWithAny(value: string | null | undefined, prefixes: string[]) {
  return Boolean(value && prefixes.some((prefix) => value.startsWith(prefix)))
}

async function deleteGatewaySessionBestEffort(sessionKey: string) {
  try {
    await chatDeleteSession({ sessionKey })
  } catch {
    // Cleanup must not fail just because the Gateway session was already gone.
  }
}

export async function sandboxCleanupAuditData(input?: { dryRun?: boolean }) {
  const dryRun = input?.dryRun ?? false
  const db = getDb()

  const chatRows = db
    .prepare("SELECT id, name, session_key FROM chats WHERE archived = 0 ORDER BY updated_at DESC")
    .all() as CleanupRow[]
  const auditChats = chatRows.filter((row) =>
    startsWithAny(row.name, AUDIT_CHAT_PREFIXES),
  )
  const auditChatSessionKeys = auditChats
    .map((row) => row.session_key)
    .filter((key): key is string => Boolean(key))

  const sessionRows = db
    .prepare("SELECT session_key, label FROM session_mappings ORDER BY updated_at DESC")
    .all() as CleanupRow[]
  const auditSessions = sessionRows.filter((row) =>
    startsWithAny(row.label, AUDIT_SESSION_LABEL_PREFIXES) ||
    (row.session_key ? auditChatSessionKeys.includes(row.session_key) : false),
  )

  if (!dryRun) {
    for (const row of auditChats) {
      if (row.session_key) await deleteGatewaySessionBestEffort(row.session_key)
      if (row.id) chatsDelete({ chatId: row.id })
    }
    for (const row of auditSessions) {
      if (row.session_key) sessionsDelete({ sessionKey: row.session_key })
    }
  }

  return {
    dryRun,
    deleted: dryRun ? false : true,
    chats: auditChats.map((row) => ({
      id: row.id,
      name: row.name,
      sessionKey: row.session_key ?? null,
    })),
    sessions: auditSessions.map((row) => ({
      sessionKey: row.session_key,
      label: row.label,
    })),
  }
}
