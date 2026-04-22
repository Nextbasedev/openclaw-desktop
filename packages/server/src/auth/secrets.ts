import { getDb } from "../db/connection.js"
import { getAppSetting, setAppSetting, nowIso } from "../db/helpers.js"

const TOKEN_KEY_PREFIX = "profile_token."

export function getProfileToken(profileId: string): string | null {
  const db = getDb()
  return getAppSetting(db, `${TOKEN_KEY_PREFIX}${profileId}`)
}

export function setProfileToken(profileId: string, token: string): void {
  const db = getDb()
  setAppSetting(db, `${TOKEN_KEY_PREFIX}${profileId}`, token)
}

export function deleteProfileToken(profileId: string): void {
  const db = getDb()
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(`${TOKEN_KEY_PREFIX}${profileId}`)
}
