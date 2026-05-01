import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
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

type State = { projects: Project[]; recentRepos: Array<{ path: string; name: string; selectedAt: string; useCount: number }>; topics?: any[]; chats?: any[]; sessions?: any[] }

export class Store {
  private file: string
  constructor(config: MiddlewareConfig) {
    this.file = config.databasePath.endsWith(".json") ? config.databasePath : `${config.databasePath}.json`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
  }

  read(): State {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")) as State } catch { return { projects: [], recentRepos: [] } }
  }
  write(state: State) { fs.writeFileSync(this.file, JSON.stringify(state, null, 2) + "\n") }

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
