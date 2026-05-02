import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const gatewayRequests = vi.hoisted(() => [] as Array<{ method: string; params: any }>)
const gatewayState = vi.hoisted(() => ({ transcriptPath: "", sourceMessages: [] as any[] }))

vi.mock("../src/services/gateway.js", () => ({
  connectGateway: vi.fn(async () => ({
    request: vi.fn(async (method: string, params: any) => {
      gatewayRequests.push({ method, params })
      if (method === "sessions.create") {
        return {
          ok: true,
          payload: {
            ok: true,
            key: params.key,
            sessionId: "fork-session-id",
            entry: { sessionId: "fork-session-id", sessionFile: gatewayState.transcriptPath },
          },
        }
      }
      if (method === "chat.history") {
        return { ok: true, payload: { messages: gatewayState.sourceMessages } }
      }
      return { ok: true, payload: {} }
    }),
    close: vi.fn(),
  })),
}))

const { createApp } = await import("../src/app.js")
const { loadConfig } = await import("../src/config.js")

const token = "secret"
const tempRoots: string[] = []

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-fork-"))
  tempRoots.push(root)
  return root
}

function makeApp(root: string) {
  const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: token, MIDDLEWARE_DB: path.join(root, "state.json"), WORKSPACE_ROOT: root })
  return createApp(config)
}

function auth(req: request.Test) { return req.set("Authorization", `Bearer ${token}`) }

afterEach(() => {
  gatewayRequests.length = 0
  gatewayState.transcriptPath = ""
  gatewayState.sourceMessages = []
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("middleware_chat_fork", () => {
  it("creates a new linked session and copies source chat history into its transcript", async () => {
    const root = tempRoot()
    gatewayState.transcriptPath = path.join(root, ".openclaw", "agents", "main", "sessions", "fork-session-id.jsonl")
    fs.mkdirSync(path.dirname(gatewayState.transcriptPath), { recursive: true })
    fs.writeFileSync(gatewayState.transcriptPath, JSON.stringify({ type: "session", version: 1, id: "fork-session-id", timestamp: "2026-05-02T00:00:00.000Z" }) + "\n")
    gatewayState.sourceMessages = [
      { role: "system", content: [{ type: "text", text: "Compaction" }], __openclaw: { kind: "compaction", seq: 1 } },
      { role: "user", content: [{ type: "text", text: "hello" }], messageId: "ui-user-id", __openclaw: { id: "user-line-id", seq: 2 }, timestamp: 1770000000000 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], __openclaw: { id: "assistant-line-id", seq: 3 }, timestamp: "2026-05-02T01:00:00.000Z" },
    ]

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_fork")).send({ input: { sessionKey: "agent:main:desktop:source", name: "Forked copy" } })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: "Forked copy", copiedMessages: 2, transcriptPath: gatewayState.transcriptPath })
    expect(res.body.sessionKey).toMatch(/^agent:main:fork:/)
    expect(gatewayRequests.find((r) => r.method === "sessions.create")?.params).toMatchObject({ parentSessionKey: "agent:main:desktop:source", label: "Forked copy", agentId: "main" })

    const lines = fs.readFileSync(gatewayState.transcriptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ type: "session", id: "fork-session-id" })
    expect(lines[1]).toMatchObject({ id: "user-line-id", message: { role: "user", content: [{ type: "text", text: "hello" }] } })
    expect(lines[1].message).not.toHaveProperty("__openclaw")
    expect(lines[1].message).not.toHaveProperty("messageId")
    expect(lines[2]).toMatchObject({ id: "assistant-line-id", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } })
  })
})
