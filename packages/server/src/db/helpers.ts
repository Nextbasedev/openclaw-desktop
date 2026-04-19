import crypto from "node:crypto"

export function nowIso(): string {
  return new Date().toISOString()
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

export function sqlToBool(value: number): boolean {
  return value !== 0
}

export function boolToSql(value: boolean): number {
  return value ? 1 : 0
}

export function parseJsonColumn(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export interface ProfileRow {
  id: string
  name: string
  mode: string
  gateway_url: string
  workspace_root: string
  is_default: number
  status: string
  last_used_at: string | null
  last_error: string | null
  capabilities_json: string | null
  metadata_json: string | null
  created_at: string
  updated_at: string
}

export function profileRowToJson(row: ProfileRow) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    gatewayUrl: row.gateway_url,
    workspaceRoot: row.workspace_root,
    isDefault: sqlToBool(row.is_default),
    status: row.status,
    lastUsedAt: row.last_used_at ?? undefined,
    lastError: row.last_error ?? undefined,
    capabilities: parseJsonColumn(row.capabilities_json),
    metadata: parseJsonColumn(row.metadata_json),
  }
}

export interface ProjectRow {
  id: string
  name: string
  profile_id: string
  workspace_root: string
  repo_root: string | null
  archived: number
  unread_count: number
  last_activity_at: string | null
  created_at: string
  updated_at: string
  pinned: number
}

export function projectRowToJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    profileId: row.profile_id,
    workspaceRoot: row.workspace_root,
    repoRoot: row.repo_root ?? undefined,
    archived: sqlToBool(row.archived),
    unreadCount: row.unread_count,
    lastActivityAt: row.last_activity_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: sqlToBool(row.pinned),
  }
}

export interface TopicRow {
  id: string
  project_id: string
  name: string
  archived: number
  unread_count: number
  sort_order: number
  created_at: string
  updated_at: string
}

export function topicRowToJson(row: TopicRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    archived: sqlToBool(row.archived),
    unreadCount: row.unread_count,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface SessionRow {
  session_key: string
  session_id: string | null
  project_id: string | null
  topic_id: string | null
  agent_id: string
  label: string
  status: string
  created_at: string
  updated_at: string
  pinned: number
  hidden: number
  source: string
}

export function sessionRowToJson(row: SessionRow) {
  return {
    key: row.session_key,
    sessionId: row.session_id ?? undefined,
    projectId: row.project_id ?? undefined,
    topicId: row.topic_id ?? undefined,
    agentId: row.agent_id,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: sqlToBool(row.pinned),
    hidden: sqlToBool(row.hidden),
    source: row.source,
  }
}

export interface TerminalRow {
  id: string
  project_id: string
  topic_id: string | null
  title: string
  cwd: string
  status: string
  last_active_at: string
  runtime_id: string | null
}

export function terminalRowToJson(row: TerminalRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    topicId: row.topic_id ?? undefined,
    title: row.title,
    cwd: row.cwd,
    status: row.status,
    lastActiveAt: row.last_active_at,
    runtimeId: row.runtime_id ?? undefined,
  }
}

export interface BranchRow {
  id: string
  source_session_key: string
  source_message_id: string
  branch_session_key: string
  branch_topic_id: string | null
  branch_reason: string | null
  created_at: string
  metadata_json: string | null
}

export function branchRowToJson(row: BranchRow) {
  return {
    id: row.id,
    sourceSessionKey: row.source_session_key,
    sourceMessageId: row.source_message_id,
    branchSessionKey: row.branch_session_key,
    branchTopicId: row.branch_topic_id ?? undefined,
    branchReason: row.branch_reason ?? undefined,
    createdAt: row.created_at,
    metadata: parseJsonColumn(row.metadata_json),
  }
}

export interface ChatRow {
  id: string
  name: string
  session_key: string | null
  agent_id: string
  archived: number
  pinned: number
  last_active_at: string | null
  created_at: string
  updated_at: string
}

export function chatRowToJson(row: ChatRow) {
  return {
    id: row.id,
    name: row.name,
    sessionKey: row.session_key ?? undefined,
    agentId: row.agent_id,
    archived: sqlToBool(row.archived),
    pinned: sqlToBool(row.pinned),
    lastActiveAt: row.last_active_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getAppSetting(db: import("better-sqlite3").Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function setAppSetting(db: import("better-sqlite3").Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, nowIso())
}

export function recordSyncTombstone(db: import("better-sqlite3").Database, entityType: string, entityId: string): void {
  const now = nowIso()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const deviceId = getAppSetting(db, "sync.device_id") ?? ""
  db.prepare(
    "INSERT OR REPLACE INTO sync_tombstones (entity_type, entity_id, deleted_at, deleted_by, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(entityType, entityId, now, deviceId, expiresAt)
}
