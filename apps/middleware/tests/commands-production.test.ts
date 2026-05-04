import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
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

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-commands-"))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("production command behavior", () => {
  it("computes usage from real OpenClaw session transcripts instead of returning zeros", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    const sessionsDir = path.join(root, ".openclaw", "agents", "main", "sessions")
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, "session.jsonl"), JSON.stringify({
      type: "message",
      timestamp: "2026-05-02T07:00:00.000Z",
      message: {
        provider: "test-provider",
        model: "test-model",
        usage: { input: 10, output: 5, cacheRead: 2, totalTokens: 17, cost: { total: 0.12 } },
      },
    }) + "\n")

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_usage")).send({ input: {} })

    expect(res.status).toBe(200)
    expect(res.body.source).toBe("openclaw-session-transcripts")
    expect(res.body.summary.totalTokens).toBe(17)
    expect(res.body.summary.totalCost).toBe(0.12)
    expect(res.body.unavailable).toBe(false)
  })

  it("requires a real session key for chat stop instead of fake success", async () => {
    const root = tempRoot()
    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_stop")).send({ input: {} })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("BAD_REQUEST")
  })

  it("returns frontend-compatible command and autonaming shapes", async () => {
    const root = tempRoot()
    const app = makeApp(root)

    const commands = await auth(request(app).post("/api/commands/middleware_commands_list")).send({ input: {} })
    expect(commands.status).toBe(200)
    expect(commands.body.commands[0]).toMatchObject({ name: expect.any(String), description: expect.any(String), source: "native", scope: expect.any(String), acceptsArgs: expect.any(Boolean) })

    const name = await auth(request(app).post("/api/commands/middleware_autonaming_quick")).send({ input: { text: "hello world" } })
    expect(name.status).toBe(200)
    expect(name.body.name).toBe("hello world")
    expect(name.body.title).toBe("hello world")
  })

  it("filters project topic sessions instead of returning unrelated sessions", async () => {
    const root = tempRoot()
    const app = makeApp(root)

    await auth(request(app).post("/api/sessions")).send({
      projectId: "project_a",
      topicId: "topic_a",
      label: "A",
    })
    const target = await auth(request(app).post("/api/sessions")).send({
      projectId: "project_b",
      topicId: "topic_b",
      label: "B",
    })

    const filtered = await auth(request(app).get("/api/sessions?projectId=project_b&topicId=topic_b"))

    expect(filtered.status).toBe(200)
    expect(filtered.body.sessions).toHaveLength(1)
    expect(filtered.body.sessions[0].key).toBe(target.body.session.key)
  })

  it("returns large git commit details without hitting the default exec buffer", async () => {
    const root = tempRoot()
    execFileSync("git", ["init"], { cwd: root })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
    fs.writeFileSync(path.join(root, "large.txt"), `${"x".repeat(2 * 1024 * 1024)}\n`)
    execFileSync("git", ["add", "large.txt"], { cwd: root })
    execFileSync("git", ["commit", "-m", "large commit"], { cwd: root })

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_git_commit_details")).send({
      input: { repoRoot: root, commit: "HEAD" },
    })

    expect(res.status).toBe(200)
    expect(res.body.diff).toContain("diff --git")
    expect(res.body.diff).toContain("large.txt")
  })

  it("resolves git commit details from project repo root", async () => {
    const workspace = tempRoot()
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-project-repo-")); tempRoots.push(repo)
    execFileSync("git", ["init"], { cwd: repo })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo })
    fs.writeFileSync(path.join(repo, "README.md"), "project repo\n")
    execFileSync("git", ["add", "README.md"], { cwd: repo })
    execFileSync("git", ["commit", "-m", "project repo commit"], { cwd: repo })
    const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()
    const app = makeApp(workspace)
    const created = await auth(request(app).post("/api/projects")).send({
      name: "repo",
      workspaceRoot: repo,
      repoRoot: repo,
    })

    const res = await auth(request(app).post("/api/commands/middleware_git_commit_details")).send({
      input: { projectId: created.body.project.id, hash },
    })

    expect(res.status).toBe(200)
    expect(res.body.diff).toContain("project repo commit")
    expect(res.body.diff).toContain("README.md")
  })

  it("returns frontend-compatible usage and cron pause shapes", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    const sessionsDir = path.join(root, ".openclaw", "agents", "main", "sessions")
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, "session.jsonl"), JSON.stringify({
      timestamp: "2026-05-02T07:00:00.000Z",
      message: { usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.12 } } },
    }) + "\n")
    const app = makeApp(root)

    const usage = await auth(request(app).post("/api/commands/middleware_usage")).send({ input: { days: 7 } })
    expect(usage.body.summary).toMatchObject({ totalInputTokens: 10, totalOutputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, totalTokens: 18, totalCost: 0.12 })
    const daily = await auth(request(app).post("/api/commands/middleware_usage_daily")).send({ input: { days: 7 } })
    expect(daily.body.daily[0]).toMatchObject({ date: "2026-05-02", input_tokens: 10, total_tokens: 18, cost_usd: 0.12 })

    const created = await auth(request(app).post("/api/commands/middleware_cron_create_job")).send({ input: { name: "job", enabled: true, paused: false } })
    const paused = await auth(request(app).post("/api/commands/middleware_cron_pause_job")).send({ input: { id: created.body.job.id, paused: true } })
    expect(paused.body.job).toMatchObject({ paused: true, enabled: false, status: "paused" })
    const resumed = await auth(request(app).post("/api/commands/middleware_cron_pause_job")).send({ input: { id: created.body.job.id, paused: false } })
    expect(resumed.body.job).toMatchObject({ paused: false, enabled: true, status: "active" })
  })
})

it("persists provider API key and voice settings through command endpoints", async () => {
  const root = tempRoot()
  const configPath = path.join(root, ".openclaw", "openclaw.json")
  vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath)
  const app = makeApp(root)

  const details = await auth(request(app).post("/api/commands/middleware_onboarding_provider_details")).send({ input: { providerId: "groq" } })
  expect(details.status).toBe(200)
  expect(details.body.provider.submit.payloadShape.values.fields.credentials[0]).toMatchObject({ envVar: "GROQ_API_KEY", required: true })

  const access = await auth(request(app).post("/api/commands/middleware_onboarding_provider_submit")).send({
    input: {
      providerId: "groq",
      authMethod: "api-key",
      values: { "api-key": "gsk_fake_wrong_key_for_e2e" },
      setDefault: false,
    },
  })
  expect(access.status).toBe(200)
  expect(access.body.saved.envVars).toEqual(["GROQ_API_KEY"])

  const voice = await auth(request(app).post("/api/commands/middleware_voice_settings_set")).send({
    input: {
      provider: "groq",
      model: "whisper-large-v3-turbo",
      language: "en",
      echoTranscript: false,
    },
  })
  expect(voice.status).toBe(200)
  expect(voice.body.settings).toMatchObject({ provider: "groq", model: "whisper-large-v3-turbo" })

  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
  expect(cfg.env.vars.GROQ_API_KEY).toBe("gsk_fake_wrong_key_for_e2e")
  expect(cfg.tools.media.audio.models).toEqual([
    { type: "provider", provider: "groq", model: "whisper-large-v3-turbo" },
  ])
})
