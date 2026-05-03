import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import request from "supertest"
import { createApp } from "../src/app.js"
import { loadConfig } from "../src/config.js"

const token = "secret"
const tempRoots: string[] = []

function makeApp(root: string) {
  const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: token, MIDDLEWARE_DB: path.join(root, "state.json"), WORKSPACE_ROOT: root })
  return createApp(config)
}

function auth(req: request.Test) { return req.set("Authorization", `Bearer ${token}`) }

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-")); tempRoots.push(root)
  execFileSync("git", ["init"], { cwd: root })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
  fs.writeFileSync(path.join(root, "README.md"), "hello\n")
  execFileSync("git", ["add", "README.md"], { cwd: root })
  execFileSync("git", ["commit", "-m", "init"], { cwd: root })
  return root
}

function commitFile(repo: string, file: string, content: string, message: string) {
  fs.writeFileSync(path.join(repo, file), content)
  execFileSync("git", ["add", file], { cwd: repo })
  execFileSync("git", ["commit", "-m", message], { cwd: repo })
}

afterEach(() => { for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe("projects/git/workspace", () => {
  it("creates project and reports git diff from middleware host filesystem", async () => {
    const repo = createRepo(); const app = makeApp(repo)
    const created = await auth(request(app).post("/api/projects")).send({ name: "repo", workspaceRoot: repo, repoRoot: repo })
    expect(created.status).toBe(200)
    const projectId = created.body.project.id
    fs.appendFileSync(path.join(repo, "README.md"), "change\n")

    const status = await auth(request(app).get(`/api/projects/${projectId}/git/status`))
    expect(status.status).toBe(200)
    expect(status.body.dirty).toBe(true)
    expect(status.body.files[0].path).toBe("README.md")

    const diff = await auth(request(app).get(`/api/projects/${projectId}/git/diff`).query({ path: "README.md" }))
    expect(diff.status).toBe(200)
    expect(diff.body.patch).toContain("+change")
  })

  it("reads and writes workspace files with path traversal protection", async () => {
    const repo = createRepo(); const app = makeApp(repo)
    const created = await auth(request(app).post("/api/projects")).send({ name: "repo", workspaceRoot: repo, repoRoot: repo })
    const projectId = created.body.project.id

    const write = await auth(request(app).put(`/api/projects/${projectId}/workspace/file`)).send({ path: "src/test.txt", content: "hello" })
    expect(write.status).toBe(200)
    const read = await auth(request(app).get(`/api/projects/${projectId}/workspace/file`).query({ path: "src/test.txt" }))
    expect(read.body.file.content).toBe("hello")

    const blocked = await auth(request(app).get(`/api/projects/${projectId}/workspace/file`).query({ path: "../../etc/passwd" }))
    expect(blocked.status).toBe(403)
  })

  it("shows latest tracked remote commits after refresh without pulling", async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-remote-")); tempRoots.push(remote)
    execFileSync("git", ["init", "--bare"], { cwd: remote })
    const source = createRepo()
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: source })
    execFileSync("git", ["push", "-u", "origin", "HEAD:main"], { cwd: source })

    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-clone-")); tempRoots.push(clone)
    fs.rmSync(clone, { recursive: true, force: true })
    execFileSync("git", ["clone", remote, clone])
    execFileSync("git", ["checkout", "main"], { cwd: clone })

    commitFile(source, "README.md", "hello\nremote\n", "remote latest")
    execFileSync("git", ["push", "origin", "HEAD:main"], { cwd: source })

    const app = makeApp(clone)
    const status = await auth(request(app).get("/api/repos/git/status").query({ path: clone }))

    expect(status.status).toBe(200)
    expect(status.body.behind).toBe(1)
    expect(status.body.recentCommits[0].message).toBe("remote latest")
    expect(execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: clone, encoding: "utf8" }).trim()).toBe("init")
  })
})
