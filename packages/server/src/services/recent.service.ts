import { getDb } from "../db/connection.js"
import { sqlToBool } from "../db/helpers.js"

interface RecentItem {
  type: "chat" | "topic"
  id: string
  name: string
  projectId?: string
  projectName?: string
  sessionKey?: string
  archived: boolean
  pinned: boolean
  updatedAt: string
}

interface RecentRow {
  type: string
  id: string
  name: string
  project_id: string | null
  project_name: string | null
  session_key: string | null
  archived: number
  pinned: number
  updated_at: string
}

export function recentList(input?: {
  limit?: number
  includeArchived?: boolean
}): { items: RecentItem[] } {
  const db = getDb()
  const limit = input?.limit ?? 50
  const includeArchived = input?.includeArchived ?? false

  const archiveClause = includeArchived ? "" : "WHERE archived = 0"

  const sql = `
    SELECT * FROM (
      SELECT 'chat' as type, id, name, NULL as project_id, NULL as project_name,
             session_key, archived, pinned, updated_at
      FROM chats
      ${archiveClause}
      UNION ALL
      SELECT 'topic' as type, t.id, t.name, t.project_id, p.name as project_name,
             NULL as session_key, t.archived, 0 as pinned, t.updated_at
      FROM topics t
      JOIN projects p ON t.project_id = p.id
      ${includeArchived ? "" : "WHERE t.archived = 0"}
    )
    ORDER BY updated_at DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(limit) as RecentRow[]

  const items: RecentItem[] = rows.map((row) => ({
    type: row.type as "chat" | "topic",
    id: row.id,
    name: row.name,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.project_name ? { projectName: row.project_name } : {}),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    archived: sqlToBool(row.archived),
    pinned: sqlToBool(row.pinned),
    updatedAt: row.updated_at,
  }))

  return { items }
}
