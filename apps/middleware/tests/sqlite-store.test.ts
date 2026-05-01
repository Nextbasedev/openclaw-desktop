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
})
