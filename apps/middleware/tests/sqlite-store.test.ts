import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.js"
import { Store } from "../src/services/store.js"

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-sqlite-"))
}

describe("SQLite store", () => {
  it("persists middleware state in sqlite instead of json", () => {
    const root = tmpdir()
    const dbBase = path.join(root, "state.json")
    const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: "test", MIDDLEWARE_DB: dbBase, WORKSPACE_ROOT: root })
    const store = new Store(config)

    const project = store.createProject({ name: "SQLite Project", workspaceRoot: root, repoRoot: root })
    store.updateProject(project.id, { pinned: true })

    expect(fs.existsSync(path.join(root, "state.sqlite"))).toBe(true)
    expect(fs.existsSync(path.join(root, "state.json"))).toBe(false)

    const restored = new Store(config)
    expect(restored.getProject(project.id)?.pinned).toBe(true)
  })

  it("scopes projects to spaces and migrates legacy projects to the default space", () => {
    const root = tmpdir()
    const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: "test", MIDDLEWARE_DB: path.join(root, "state.json"), WORKSPACE_ROOT: root })
    const store = new Store(config)

    const legacy = store.createProject({ name: "Legacy", workspaceRoot: root })
    const state = store.read()
    state.spaces = [
      { id: "space_general", name: "General", sortOrder: 0, archived: false },
      { id: "space_work", name: "Work", sortOrder: 1, archived: false },
    ]
    state.activeSpaceId = "space_general"
    state.projects = state.projects.map((project) => project.id === legacy.id ? { ...project, spaceId: undefined } : project)
    store.write(state)

    expect(store.listProjects("space_general").map((project) => project.name)).toEqual(["Legacy"])
    expect(store.listProjects("space_work")).toEqual([])

    const work = store.createProject({ name: "Work Project", workspaceRoot: root, spaceId: "space_work" })
    expect(store.listProjects("space_work").map((project) => project.id)).toEqual([work.id])
  })
})
