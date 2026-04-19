import fs from "node:fs"
import path from "node:path"
import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  boolToSql,
  profileRowToJson,
  type ProfileRow,
} from "../db/helpers.js"
import {
  getProfileToken,
  setProfileToken,
  deleteProfileToken,
} from "../auth/secrets.js"

function detectCapabilities(workspaceRoot: string) {
  const exists = fs.existsSync(workspaceRoot)
  return { openclaw: true, files: exists, git: exists, terminal: exists, bootstrap: false }
}

const PROFILE_COLUMNS = "id, name, mode, gateway_url, workspace_root, is_default, status, last_used_at, capabilities_json, metadata_json, last_error, created_at, updated_at"

function fetchProfile(id: string) {
  const db = getDb()
  const row = db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = ?`).get(id) as ProfileRow | undefined
  if (!row) throw new Error(`Profile not found: ${id}`)
  return profileRowToJson(row)
}

export function profilesList() {
  const db = getDb()
  const rows = db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY updated_at DESC`).all() as ProfileRow[]
  return { profiles: rows.map(profileRowToJson) }
}

export function profilesCreate(input: {
  name: string
  mode: string
  gatewayUrl: string
  workspaceRoot: string
  token?: string
  isDefault?: boolean
}) {
  if (!input.name.trim()) throw new Error("Name cannot be empty")
  const db = getDb()
  const id = generateId("prof")
  const now = nowIso()
  const capabilities = detectCapabilities(input.workspaceRoot)
  const isDefault = input.isDefault ?? false

  const tx = db.transaction(() => {
    if (isDefault) {
      db.prepare("UPDATE profiles SET is_default = 0").run()
    }
    db.prepare(
      "INSERT INTO profiles (id, name, mode, gateway_url, workspace_root, is_default, status, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?, ?, ?)",
    ).run(id, input.name, input.mode, input.gatewayUrl, input.workspaceRoot, boolToSql(isDefault), JSON.stringify(capabilities), now, now)
  })
  tx()

  if (input.token) setProfileToken(id, input.token)
  return { profile: fetchProfile(id) }
}

export function profilesUpdate(input: {
  profileId: string
  name?: string
  gatewayUrl?: string
  workspaceRoot?: string
  token?: string
  isDefault?: boolean
}) {
  const db = getDb()
  const existing = db.prepare("SELECT name, gateway_url, workspace_root, is_default FROM profiles WHERE id = ?").get(input.profileId) as
    | { name: string; gateway_url: string; workspace_root: string; is_default: number }
    | undefined
  if (!existing) throw new Error(`Profile not found: ${input.profileId}`)

  const isDefault = input.isDefault ?? existing.is_default !== 0
  const workspace = input.workspaceRoot ?? existing.workspace_root
  const capabilities = detectCapabilities(workspace)

  if (isDefault) {
    db.prepare("UPDATE profiles SET is_default = 0").run()
  }
  db.prepare(
    "UPDATE profiles SET name = ?, gateway_url = ?, workspace_root = ?, is_default = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
  ).run(
    input.name ?? existing.name,
    input.gatewayUrl ?? existing.gateway_url,
    workspace,
    boolToSql(isDefault),
    JSON.stringify(capabilities),
    nowIso(),
    input.profileId,
  )

  if (input.token) setProfileToken(input.profileId, input.token)
  return { profile: fetchProfile(input.profileId) }
}

export function profilesDelete(input: { profileId: string }) {
  const db = getDb()
  const exists = (db.prepare("SELECT COUNT(*) as c FROM profiles WHERE id = ?").get(input.profileId) as { c: number }).c > 0
  if (!exists) throw new Error(`Profile not found: ${input.profileId}`)

  const refCount = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE profile_id = ?").get(input.profileId) as { c: number }).c
  if (refCount > 0) {
    throw new Error(`Cannot delete profile ${input.profileId}: ${refCount} project(s) still reference it. Reassign or delete them first.`)
  }

  db.prepare("DELETE FROM profiles WHERE id = ?").run(input.profileId)
  deleteProfileToken(input.profileId)
  return { ok: true, deletedProfileId: input.profileId }
}

export function profileTokenSet(input: { profileId: string; token: string }) {
  if (!input.token) throw new Error("token is required")
  setProfileToken(input.profileId, input.token)
  return { ok: true, profileId: input.profileId }
}

export function profileTokenGet(input: { profileId: string }) {
  return { profileId: input.profileId, token: getProfileToken(input.profileId) }
}

export function profileTokenDelete(input: { profileId: string }) {
  deleteProfileToken(input.profileId)
  return { ok: true, profileId: input.profileId }
}

export function environmentConnect(input: { profileId: string }) {
  const db = getDb()
  const row = db.prepare("SELECT workspace_root FROM profiles WHERE id = ?").get(input.profileId) as { workspace_root: string } | undefined
  if (!row) throw new Error(`Profile not found: ${input.profileId}`)

  const capabilities = detectCapabilities(row.workspace_root)
  const now = nowIso()
  db.prepare(
    "UPDATE profiles SET status = 'connected', last_used_at = ?, last_error = NULL, capabilities_json = ?, updated_at = ? WHERE id = ?",
  ).run(now, JSON.stringify(capabilities), now, input.profileId)
  return { ok: true, profileId: input.profileId, status: "connected", capabilities }
}

export function environmentStatus(input: { profileId: string }) {
  const db = getDb()
  const row = db.prepare("SELECT status, capabilities_json, workspace_root FROM profiles WHERE id = ?").get(input.profileId) as
    | { status: string; capabilities_json: string | null; workspace_root: string }
    | undefined
  if (!row) throw new Error(`Profile not found: ${input.profileId}`)

  let capabilities = null
  try {
    capabilities = row.capabilities_json ? JSON.parse(row.capabilities_json) : null
  } catch {}
  if (!capabilities) capabilities = detectCapabilities(row.workspace_root)

  return { profileId: input.profileId, status: row.status, capabilities }
}

export function environmentDetect(input: { profileId: string }) {
  const db = getDb()
  const row = db.prepare("SELECT workspace_root FROM profiles WHERE id = ?").get(input.profileId) as { workspace_root: string } | undefined
  if (!row) throw new Error(`Profile not found: ${input.profileId}`)
  return { capabilities: detectCapabilities(row.workspace_root) }
}
