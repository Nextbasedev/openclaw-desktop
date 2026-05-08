import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const gatewayRequests = vi.hoisted(() => [] as Array<{ method: string; params: any }>)
const gatewayState = vi.hoisted(() => ({ transcriptPath: "", sourceMessages: [] as any[], chatSendPayload: {} as any, onChatSend: null as null | (() => void), failNextCreateLabel: null as string | null, failHistoryMessage: null as string | null }))

vi.mock("../src/services/gateway.js", () => ({
  withGatewayReadRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  connectGateway: vi.fn(async () => ({
    request: vi.fn(async (method: string, params: any) => {
      gatewayRequests.push({ method, params })
      if (method === "sessions.create") {
        if (gatewayState.failNextCreateLabel && params.label === gatewayState.failNextCreateLabel) {
          gatewayState.failNextCreateLabel = null
          return { ok: false, error: { message: `label already in use: ${params.label}` } }
        }
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
        if (gatewayState.failHistoryMessage) return { ok: false, error: { message: gatewayState.failHistoryMessage } }
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
  gatewayState.failNextCreateLabel = null
  gatewayState.failHistoryMessage = null
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("middleware_chat_send slash command history", () => {
  it("records the slash command input when gateway appends only the command output", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    const sessionKey = "agent:main:desktop:source"
    const sessionsDir = path.join(root, ".openclaw", "agents", "main", "sessions")
    fs.mkdirSync(sessionsDir, { recursive: true })
    const sessionFile = path.join(sessionsDir, "same-session.jsonl")
    const sessionsJson = path.join(sessionsDir, "sessions.json")
    fs.writeFileSync(sessionsJson, JSON.stringify({ [sessionKey]: { sessionId: "same-session", sessionFile, updatedAt: 1, status: "done" } }, null, 2))
    fs.writeFileSync(sessionFile, [
      JSON.stringify({ type: "session", id: "same-session", version: 3 }),
      JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
    ].join("\n") + "\n")

    gatewayState.onChatSend = () => {
      fs.appendFileSync(sessionFile, JSON.stringify({ type: "message", id: "status1", parentId: null, message: { role: "assistant", provider: "openclaw", model: "gateway-injected", content: [{ type: "text", text: "status output" }] } }) + "\n")
    }

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_send")).send({ input: { sessionKey, text: "/status" } })

    expect(res.status).toBe(200)
    expect(res.body.commandHistoryRestore).toMatchObject({ recorded: true, sessionId: "same-session", sessionFile })
    const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines.map((line) => line.message?.role).filter(Boolean)).toEqual(["user", "assistant", "user", "assistant"])
    expect(lines[3]).toMatchObject({ message: { role: "user", content: [{ type: "text", text: "/status" }] } })
    expect(lines[4]).toMatchObject({ id: "status1", parentId: lines[3].id, message: { role: "assistant", content: [{ type: "text", text: "status output" }] } })
  })

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

  it("copies only history up to the clicked message using gatewayIndex fallback", async () => {
    const root = tempRoot()
    gatewayState.transcriptPath = path.join(root, ".openclaw", "agents", "main", "sessions", "fork-session-id.jsonl")
    fs.mkdirSync(path.dirname(gatewayState.transcriptPath), { recursive: true })
    fs.writeFileSync(gatewayState.transcriptPath, JSON.stringify({ type: "session", version: 1, id: "fork-session-id" }) + "\n")
    gatewayState.sourceMessages = [
      { role: "user", content: [{ type: "text", text: "first" }], __openclaw: { id: "u1" } },
      { role: "assistant", content: [{ type: "text", text: "first answer" }], __openclaw: { id: "a1" } },
      { role: "user", content: [{ type: "text", text: "second" }], __openclaw: { id: "u2" } },
      { role: "assistant", content: [{ type: "text", text: "second answer" }], __openclaw: { id: "a2" } },
    ]

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_fork")).send({ input: { sessionKey: "agent:main:desktop:source", messageId: "ui-only-id", gatewayIndex: 1 } })

    expect(res.status).toBe(200)
    expect(res.body.copiedMessages).toBe(2)
    const lines = fs.readFileSync(gatewayState.transcriptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(lines.map((line) => line.id)).toEqual(["fork-session-id", "u1", "a1"])
    expect(lines.some((line) => line.id === "u2" || line.id === "a2")).toBe(false)
  })

  it("uses a unique default fork label and retries label collisions", async () => {
    const root = tempRoot()
    gatewayState.transcriptPath = path.join(root, ".openclaw", "agents", "main", "sessions", "fork-session-id.jsonl")
    fs.mkdirSync(path.dirname(gatewayState.transcriptPath), { recursive: true })
    fs.writeFileSync(gatewayState.transcriptPath, JSON.stringify({ type: "session", version: 1, id: "fork-session-id" }) + "\n")
    gatewayState.sourceMessages = [
      { role: "user", content: [{ type: "text", text: "hello" }], __openclaw: { id: "u1" } },
    ]
    gatewayState.failNextCreateLabel = "Forked chat"

    const explicit = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_fork")).send({ input: { sessionKey: "agent:main:desktop:source", name: "Forked chat" } })
    expect(explicit.status).toBe(200)
    expect(explicit.body.name).toBe("Forked chat (2)")

    gatewayRequests.length = 0
    const implicit = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_fork")).send({ input: { sessionKey: "agent:main:desktop:source" } })
    expect(implicit.status).toBe(200)
    expect(implicit.body.name).toMatch(/^Forked chat \d{4}-\d{2}-\d{2}/)
    expect(gatewayRequests.find((r) => r.method === "sessions.create")?.params.label).not.toBe("Forked chat")
  })

  it("returns empty chat history instead of surfacing pairing errors", async () => {
    const root = tempRoot()
    gatewayState.failHistoryMessage = "Device not paired with gateway"

    const res = await auth(request(makeApp(root)).post("/api/commands/middleware_chat_history")).send({ input: { sessionKey: "agent:main:desktop:source" } })

    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
  })

  it("creates forks from topic sessions as new topics in the same project", async () => {
    const root = tempRoot()
    const app = makeApp(root)
    gatewayState.transcriptPath = path.join(root, ".openclaw", "agents", "main", "sessions", "fork-session-id.jsonl")
    fs.mkdirSync(path.dirname(gatewayState.transcriptPath), { recursive: true })
    fs.writeFileSync(gatewayState.transcriptPath, JSON.stringify({ type: "session", version: 1, id: "fork-session-id" }) + "\n")
    gatewayState.sourceMessages = [
      { role: "user", content: [{ type: "text", text: "topic hello" }], __openclaw: { id: "u1" } },
    ]
    await auth(request(app).post("/api/sessions")).send({
      sessionKey: "agent:main:desktop:topic-source",
      projectId: "project_ampere",
      topicId: "topic_hello",
      label: "hello",
    })

    const res = await auth(request(app).post("/api/commands/middleware_chat_fork")).send({ input: { sessionKey: "agent:main:desktop:topic-source" } })
    const topicSessions = await auth(request(app).get("/api/sessions?projectId=project_ampere&topicId=topic_hello"))
    const chats = await auth(request(app).get("/api/chats"))

    const forkTopics = await auth(request(app).get("/api/topics?projectId=project_ampere"))
    const forkTopicId = res.body.topicId
    const forkTopicSessions = await auth(request(app).get(`/api/sessions?projectId=project_ampere&topicId=${forkTopicId}`))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ chatId: null, projectId: "project_ampere", sourceTopicId: "topic_hello", topicId: expect.stringMatching(/^topic_/), sessionKey: expect.stringMatching(/^agent:main:fork:/) })
    expect(res.body.topicId).not.toBe("topic_hello")
    expect(topicSessions.body.sessions.map((s: any) => s.sessionKey)).not.toContain(res.body.sessionKey)
    expect(forkTopicSessions.body.sessions.map((s: any) => s.sessionKey)).toContain(res.body.sessionKey)
    expect(forkTopics.body.topics.some((topic: any) => topic.id === forkTopicId && topic.projectId === "project_ampere" && topic.forkedFromTopicId === "topic_hello")).toBe(true)
    expect(chats.body.chats.some((chat: any) => chat.sessionKey === res.body.sessionKey)).toBe(false)
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
