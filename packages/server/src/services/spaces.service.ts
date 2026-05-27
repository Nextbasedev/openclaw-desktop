import { getDb } from "../db/connection.js"
import { generateId, nowIso } from "../db/helpers.js"

type SpaceRow = {
  id: string
  name: string
  icon_image_json: string | null
  repo_root: string | null
  project_id: string | null
  sort_order: number
  archived: number
  created_at: string
  updated_at: string
}

type SpaceIconImage = {
  name: string
  mimeType: string
  content: string
  encoding: "base64"
  size: number
}

const SPACE_COLUMNS = "id, name, icon_image_json, repo_root, project_id, sort_order, archived, created_at, updated_at"
const ACTIVE_SPACE_SETTING = "spaces.active_space_id"

function parseIconImage(value: string | null): SpaceIconImage | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<SpaceIconImage>
    if (
      typeof parsed.name === "string" &&
      typeof parsed.mimeType === "string" &&
      parsed.mimeType.startsWith("image/") &&
      typeof parsed.content === "string" &&
      parsed.encoding === "base64" &&
      typeof parsed.size === "number"
    ) {
      return parsed as SpaceIconImage
    }
  } catch {}
  return undefined
}

function serializeIconImage(input?: SpaceIconImage | null): string | null {
  if (!input) return null
  if (!input.mimeType?.startsWith("image/")) throw new Error("Space icon must be an image")
  if (input.encoding !== "base64") throw new Error("Space icon must be base64 encoded")
  return JSON.stringify({
    name: input.name,
    mimeType: input.mimeType,
    content: input.content,
    encoding: input.encoding,
    size: input.size,
  })
}

function rowToJson(row: SpaceRow) {
  return {
    id: row.id,
    name: row.name,
    iconImage: parseIconImage(row.icon_image_json),
    repoRoot: row.repo_root ?? undefined,
    projectId: row.project_id ?? undefined,
    sortOrder: row.sort_order,
    archived: row.archived !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function ensureDefaultSpace(): SpaceRow {
  const db = getDb()
  const existing = db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE archived = 0 ORDER BY sort_order ASC, created_at ASC LIMIT 1`).get() as SpaceRow | undefined
  if (existing) return existing

  const now = nowIso()
  const id = generateId("space")
  db.prepare(`INSERT INTO spaces (${SPACE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, "General", null, null, null, 0, now, now)
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(ACTIVE_SPACE_SETTING, id, now)
  db.prepare("UPDATE chats SET space_id = ? WHERE space_id IS NULL").run(id)
  return db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`).get(id) as SpaceRow
}

export function spacesList() {
  const db = getDb()
  const defaultSpace = ensureDefaultSpace()
  let activeSpaceId = (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(ACTIVE_SPACE_SETTING) as { value: string | null } | undefined)?.value ?? defaultSpace.id
  const rows = db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE archived = 0 ORDER BY sort_order ASC, created_at ASC`).all() as SpaceRow[]
  if (!rows.some((space) => space.id === activeSpaceId)) {
    activeSpaceId = rows[0]?.id ?? defaultSpace.id
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(ACTIVE_SPACE_SETTING, activeSpaceId, nowIso())
  }
  return { spaces: rows.map(rowToJson), activeSpaceId }
}

export function spacesCreate(input?: { name?: string; iconImage?: SpaceIconImage | null; repoRoot?: string; projectId?: string }) {
  const db = getDb()
  ensureDefaultSpace()
  const now = nowIso()
  const id = generateId("space")
  const maxSort = (db.prepare("SELECT MAX(sort_order) AS maxSort FROM spaces").get() as { maxSort: number | null } | undefined)?.maxSort ?? 0
  const name = input?.name?.trim() || "New Space"
  db.prepare(`INSERT INTO spaces (${SPACE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, name, serializeIconImage(input?.iconImage), input?.repoRoot?.trim() || null, input?.projectId?.trim() || null, maxSort + 1, now, now)
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(ACTIVE_SPACE_SETTING, id, now)
  return { space: rowToJson(db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`).get(id) as SpaceRow), activeSpaceId: id }
}

export function spacesUpdate(input: { spaceId: string; name?: string; iconImage?: SpaceIconImage | null; repoRoot?: string | null; projectId?: string | null }) {
  const db = getDb()
  const existing = db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ? AND archived = 0`).get(input.spaceId) as SpaceRow | undefined
  if (!existing) throw new Error(`Space not found: ${input.spaceId}`)
  const name = input.name !== undefined ? input.name.trim() : existing.name
  if (!name) throw new Error("Space name cannot be empty")
  db.prepare("UPDATE spaces SET name = ?, icon_image_json = ?, repo_root = ?, project_id = ?, updated_at = ? WHERE id = ?")
    .run(
      name,
      input.iconImage !== undefined ? serializeIconImage(input.iconImage) : existing.icon_image_json,
      input.repoRoot !== undefined ? input.repoRoot?.trim() || null : existing.repo_root,
      input.projectId !== undefined ? input.projectId?.trim() || null : existing.project_id,
      nowIso(),
      input.spaceId,
    )
  return { space: rowToJson(db.prepare(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`).get(input.spaceId) as SpaceRow) }
}

export function spacesSwitch(input: { spaceId: string }) {
  const db = getDb()
  const existing = db.prepare("SELECT id FROM spaces WHERE id = ? AND archived = 0").get(input.spaceId) as { id: string } | undefined
  if (!existing) throw new Error(`Space not found: ${input.spaceId}`)
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(ACTIVE_SPACE_SETTING, input.spaceId, nowIso())
  return { activeSpaceId: input.spaceId }
}

export function spacesDelete(input: { spaceId: string }) {
  const db = getDb()
  const spaces = db.prepare("SELECT id FROM spaces WHERE archived = 0 ORDER BY sort_order ASC, created_at ASC").all() as Array<{ id: string }>
  if (spaces.length <= 1) throw new Error("Cannot delete the last space")
  if (!spaces.some((space) => space.id === input.spaceId)) throw new Error(`Space not found: ${input.spaceId}`)
  const currentActiveSpaceId = (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(ACTIVE_SPACE_SETTING) as { value: string | null } | undefined)?.value
  const nextSpaceId = currentActiveSpaceId && currentActiveSpaceId !== input.spaceId
    ? currentActiveSpaceId
    : spaces.find((space) => space.id !== input.spaceId)?.id
  if (!nextSpaceId) throw new Error("No fallback space available")
  const now = nowIso()
  db.prepare("UPDATE spaces SET archived = 1, updated_at = ? WHERE id = ?").run(now, input.spaceId)
  db.prepare("UPDATE chats SET archived = 1, updated_at = ? WHERE space_id = ?").run(now, input.spaceId)
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(ACTIVE_SPACE_SETTING, nextSpaceId, now)
  return { ok: true, activeSpaceId: nextSpaceId }
}
