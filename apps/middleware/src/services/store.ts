import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import Database from "better-sqlite3"
import type { MiddlewareConfig } from "../config.js"

export type Project = {
  id: string
  name: string
  workspaceRoot: string
  repoRoot: string | null
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

type RecentRepo = { path: string; name: string; selectedAt: string; useCount: number }
type State = {
  projects: Project[]
  recentRepos: RecentRepo[]
  topics?: any[]
  chats?: any[]
  sessions?: any[]
  commandState?: any
}

function defaultState(): State {
  return { projects: [], recentRepos: [], topics: [], chats: [], sessions: [], commandState: {} }
}

function sqlitePath(input: string) {
  if (input.endsWith(".sqlite") || input.endsWith(".sqlite3") || input.endsWith(".db")) return input
  if (input.endsWith(".json")) return input.replace(/\.json$/, ".sqlite")
  return `${input}.sqlite`
}

function maybeJsonPath(input: string) {
  if (input.endsWith(".json")) return input
  if (input.endsWith(".sqlite") || input.endsWith(".sqlite3") || input.endsWith(".db")) return input.replace(/\.(sqlite3?|db)$/, ".json")
  return `${input}.json`
}

function normalizeState(value: unknown): State {
  const state = (value && typeof value === "object" ? value : {}) as State
  state.projects ??= []
  state.recentRepos ??= []
  state.topics ??= []
  state.chats ??= []
  state.sessions ??= []
  state.commandState ??= {}
  return state
}

export class Store {
  private db: Database.Database
  private file: string

  constructor(config: MiddlewareConfig) {
    this.file = sqlitePath(config.databasePath)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.db = new Database(this.file)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.migrate()
    this.importLegacyJsonIfEmpty(maybeJsonPath(config.databasePath))
  }

  databaseFile() { return this.file }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `)
    const existing = this.db.prepare("SELECT value FROM kv_state WHERE key = 'state'").get() as { value: string } | undefined
    if (!existing) this.write(defaultState())
  }

  private importLegacyJsonIfEmpty(jsonFile: string) {
    if (!fs.existsSync(jsonFile)) return
    const current = this.read()
    const hasData = current.projects.length || current.recentRepos.length || current.topics?.length || current.chats?.length || current.sessions?.length || Object.keys(current.commandState ?? {}).length
    if (hasData) return
    try {
      const legacy = normalizeState(JSON.parse(fs.readFileSync(jsonFile, "utf8")))
      this.write(legacy)
    } catch {}
  }

  read(): State {
    const row = this.db.prepare("SELECT value FROM kv_state WHERE key = 'state'").get() as { value: string } | undefined
    if (!row) return defaultState()
    try { return normalizeState(JSON.parse(row.value)) } catch { return defaultState() }
  }

  write(state: State) {
    const normalized = normalizeState(state)
    this.db.prepare(`
      INSERT INTO kv_state(key, value, updated_at) VALUES ('state', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(normalized), new Date().toISOString())
  }

  listProjects() { return this.read().projects }
  getProject(id: string) { return this.read().projects.find(p => p.id === id) ?? null }

  createProject(input: { name: string; workspaceRoot: string; repoRoot?: string | null }) {
    const state = this.read(); const now = new Date().toISOString()
    const project: Project = { id: `proj_${crypto.randomUUID().replace(/-/g, "")}`, name: input.name, workspaceRoot: input.workspaceRoot, repoRoot: input.repoRoot ?? input.workspaceRoot, pinned: false, archived: false, createdAt: now, updatedAt: now }
    state.projects.push(project); this.write(state); return project
  }

  updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) {
    const state = this.read(); const idx = state.projects.findIndex(p => p.id === id)
    if (idx === -1) return null
    state.projects[idx] = { ...state.projects[idx]!, ...patch, updatedAt: new Date().toISOString() }
    this.write(state); return state.projects[idx]!
  }

  deleteProject(id: string) { const state = this.read(); const before = state.projects.length; state.projects = state.projects.filter(p => p.id !== id); this.write(state); return state.projects.length !== before }

  selectRepo(input: { path: string; name: string }) {
    const state = this.read(); const now = new Date().toISOString(); const existing = state.recentRepos.find(r => r.path === input.path)
    if (existing) { existing.selectedAt = now; existing.useCount += 1; existing.name = input.name } else state.recentRepos.push({ ...input, selectedAt: now, useCount: 1 })
    this.write(state); return { ok: true }
  }

  recentRepos() { return this.read().recentRepos.sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt)) }
}
