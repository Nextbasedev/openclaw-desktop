import Database from "better-sqlite3"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { initDb } from "./schema.js"

let db: Database.Database | null = null

function sqlitePath(): string {
  if (process.env.JARVIS_TEST_DB_PATH) {
    return process.env.JARVIS_TEST_DB_PATH
  }
  const dir = path.join(os.homedir(), ".jarvis", "openclaw-desktop")
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, "jarvis.db")
}

export function getDb(): Database.Database {
  if (db) return db
  const dbPath = sqlitePath()
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  initDb(db)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function resetDb(): void {
  closeDb()
  db = null
}
