import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const gatewayRequests = vi.hoisted(() => [] as Array<{ method: string; params: any }>)
const gatewayState = vi.hoisted(() => ({ transcriptPath: "", sourceMessages: [] as any[], chatSendPayload: {} as any, onChatSend: null as null | (() => void) }))

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
      if (method === "chat.send") {
        gatewayState.onChatSend?.()
        return { ok: true, payload: gatewayState.chatSendPayload }
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
  gatewayState.chatSendPayload = {}
  gatewayState.onChatSend = null
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("middleware_chat_send slash command history", () => {
  it("restores the original transcript when a slash command creates a status-only replacement session", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    const sessionKey = "agent:main:desktop:source"
    const sessionsDir = path.join(root, ".openclaw", "agents", "main", "sessions")
    fs.mkdirSync(sessionsDir, { recursive: true })
    const oldSessionFile = path.join(sessionsDir, "old-session.jsonl")
    const resetFile = `${oldSessionFile}.reset.2026-05-03T05-54-40.350Z`
    const newSessionFile = path.join(sessionsDir, "new-status-session.jsonl")
    const sessionsJson = path.join(sessionsDir, "sessions.json")
    const oldEntry = { sessionId: "old-session", sessionFile: oldSessionFile, updatedAt: 1, status: "done" }
    fs.writeFileSync(sessionsJson, JSON.stringify({ [sessionKey]: oldEntry }, null, 2))
    fs.writeFileSync(oldSessionFile, [
      JSON.stringify({ type: "session", id: "old-session", version: 3 }),
      JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
    ].join("\n") + "\n")

    gatewayState.onChatSend = () => {
      fs.renameSync(oldSessionFile, resetFile)
      fs.writeFileSync(newSessionFile, [
        JSON.stringify({ type: "session", id: "new-status-session", version: 3 }),
        JSON.stringify({ type: "message", id: "status1", parentId: null, message: { role: "assistant", provider: "openclaw", model: "gateway-injected", content: [{ type: "text", text: "status output" }] } }),
      ].join("\n") + "\n")
      fs.writeFileSync(sessionsJson, JSON.stringify({ [sessionKey]: { sessionId: "new-status-session", sessionFile: newSessionFile, updatedAt: 2, status: "done" } }, null, 2))
    }

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_send")).send({ input: { sessionKey, text: "/status" } })

    expect(res.status).toBe(200)
    expect(res.body.commandHistoryRestore).toMatchObject({ restored: true, sessionId: "old-session", sessionFile: oldSessionFile })
    expect(JSON.parse(fs.readFileSync(sessionsJson, "utf8"))[sessionKey]).toMatchObject({ sessionId: "old-session", sessionFile: oldSessionFile })
    const lines = fs.readFileSync(oldSessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines.map((line) => line.message?.role).filter(Boolean)).toEqual(["user", "assistant", "user", "assistant"])
    expect(lines[3]).toMatchObject({ message: { role: "user", content: [{ type: "text", text: "/status" }] } })
    expect(lines[4]).toMatchObject({ id: "status1", parentId: lines[3].id, message: { role: "assistant", content: [{ type: "text", text: "status output" }] } })
  })
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

  it("creates a side-by-side regenerate branch without mutating the original transcript", async () => {
    const root = tempRoot()
    gatewayState.transcriptPath = path.join(root, ".openclaw", "agents", "main", "sessions", "regen-session-id.jsonl")
    fs.mkdirSync(path.dirname(gatewayState.transcriptPath), { recursive: true })
    fs.writeFileSync(gatewayState.transcriptPath, JSON.stringify({ type: "session", version: 1, id: "regen-session-id", timestamp: "2026-05-02T00:00:00.000Z" }) + "\n")
    gatewayState.chatSendPayload = { runId: "regen-run" }
    gatewayState.sourceMessages = [
      { role: "user", content: [{ type: "text", text: "first" }], __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", content: [{ type: "text", text: "first answer" }], __openclaw: { id: "a1", seq: 2 } },
      { role: "user", content: [{ type: "text", text: "try again" }], __openclaw: { id: "u2", seq: 3 } },
      { role: "assistant", content: [{ type: "text", text: "old answer" }], __openclaw: { id: "a2", seq: 4 } },
    ]

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_regenerate")).send({ input: { sessionKey: "agent:main:desktop:source", messageId: "a2", text: "try again" } })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ action: "regenerate", branchSessionKey: expect.stringMatching(/^agent:main:regen:/), sourceUserMessageId: "u2", sourceAssistantMessageId: "a2", runId: "regen-run" })
    expect(res.body.original.assistant).toMatchObject({ role: "assistant", content: [{ type: "text", text: "old answer" }] })
    expect(gatewayRequests.find((r) => r.method === "sessions.create")?.params).toMatchObject({ parentSessionKey: "agent:main:desktop:source", agentId: "main" })
    expect(gatewayRequests.find((r) => r.method === "chat.send")?.params).toMatchObject({ sessionKey: res.body.branchSessionKey, message: "try again" })

    const lines = fs.readFileSync(gatewayState.transcriptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines.map((line) => line.id)).toEqual(["regen-session-id", "u1", "a1"])
    expect(lines.some((line) => line.id === "u2" || line.id === "a2")).toBe(false)
  })
})
