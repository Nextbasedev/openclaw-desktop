import fs from "node:fs"
import os from "node:os"
import path from "node:path"
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
})
