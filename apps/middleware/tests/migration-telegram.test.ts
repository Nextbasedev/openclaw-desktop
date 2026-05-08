import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const gatewayRequests = vi.hoisted(() => [] as Array<{ method: string; params: any }>)
const gatewayState = vi.hoisted(() => ({ created: [] as Array<{ key: string; file: string }> }))

vi.mock("../src/services/gateway.js", () => ({
  withGatewayReadRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  connectGateway: vi.fn(async () => ({
    request: vi.fn(async (method: string, params: any) => {
      gatewayRequests.push({ method, params })
      if (method === "sessions.create") {
        const file = path.join(process.env.HOME || os.tmpdir(), ".openclaw", "agents", "main", "sessions", `${params.key.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ type: "session", id: params.key, version: 1 }) + "\n")
        gatewayState.created.push({ key: params.key, file })
        return { ok: true, payload: { entry: { sessionId: params.key, sessionFile: file } } }
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-migration-"))
  tempRoots.push(root)
  return root
}

function makeApp(root: string) {
  const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: token, MIDDLEWARE_DB: path.join(root, "state.json"), WORKSPACE_ROOT: root })
  return createApp(config)
}

function auth(req: request.Test) { return req.set("Authorization", `Bearer ${token}`) }

function writeTelegramSession(root: string, key: string, entry: any, messages: any[]) {
  const sessionsDir = path.join(root, ".openclaw", "agents", "main", "sessions")
  fs.mkdirSync(sessionsDir, { recursive: true })
  const file = path.join(sessionsDir, `${entry.sessionId}.jsonl`)
  fs.writeFileSync(file, [
    JSON.stringify({ type: "session", id: entry.sessionId, version: 1 }),
    ...messages.map((message, index) => JSON.stringify({ type: "message", id: `m${index}`, timestamp: `2026-05-04T00:00:0${index}.000Z`, message })),
  ].join("\n") + "\n")
  const sessionsJson = path.join(sessionsDir, "sessions.json")
  const existing = fs.existsSync(sessionsJson) ? JSON.parse(fs.readFileSync(sessionsJson, "utf8")) : {}
  existing[key] = { ...entry, sessionFile: file, updatedAt: 1770000000000 }
  fs.writeFileSync(sessionsJson, JSON.stringify(existing, null, 2))
  return file
}

afterEach(() => {
  gatewayRequests.length = 0
  gatewayState.created.length = 0
  vi.unstubAllEnvs()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Telegram migration", () => {
  it("scans direct chats and group topics separately", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    writeTelegramSession(root, "agent:main:telegram:direct:124", { sessionId: "direct", origin: { label: "Dixit id:124" } }, [
      { role: "user", content: [{ type: "text", text: "normal direct message should name this" }] },
    ])
    writeTelegramSession(root, "agent:main:telegram:group:-100:topic:42", { sessionId: "group-topic", subject: "New world 🌍", origin: { label: "New world 🌍 id:-100 topic:42" } }, [
      { role: "user", content: [{ type: "text", text: "topic migration request goes here" }] },
    ])

    const res = await auth(request(makeApp(root)).get("/api/migration/telegram/scan"))

    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ total: 2, direct: 1, groups: 1, topics: 1 })
    expect(res.body.sessions.map((s: any) => s.proposedName)).toEqual(["normal direct m", "topic migration"])
    expect(res.body.groups).toEqual([{ groupId: "-100", name: "New world 🌍", topics: 1 }])
  })

  it("imports direct chats as chats and group topics as project topics", async () => {
    const root = tempRoot()
    vi.stubEnv("HOME", root)
    writeTelegramSession(root, "agent:main:telegram:direct:124", { sessionId: "direct", origin: { label: "Dixit id:124" } }, [
      { role: "user", content: [{ type: "text", text: "direct import conversation" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ])
    writeTelegramSession(root, "agent:main:telegram:group:-100:topic:42", { sessionId: "group-topic", subject: "New world 🌍", origin: { label: "New world 🌍 id:-100 topic:42" } }, [
      { role: "user", content: [{ type: "text", text: "group topic import conversation" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ])

    const app = makeApp(root)
    const res = await auth(request(app).post("/api/migration/telegram/import")).send({})

    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ imported: 2, skipped: 0, failed: 0 })
    expect(gatewayRequests.filter((r) => r.method === "sessions.create")).toHaveLength(2)

    const projects = await auth(request(app).get("/api/projects"))
    expect(projects.body.projects).toHaveLength(1)
    expect(projects.body.projects[0]).toMatchObject({ name: "New world 🌍" })

    const topics = await auth(request(app).get(`/api/topics?projectId=${projects.body.projects[0].id}`))
    expect(topics.body.topics).toHaveLength(1)
    expect(topics.body.topics[0].name).toBe("group topic imp")

    const chats = await auth(request(app).get("/api/chats"))
    expect(chats.body.chats).toHaveLength(1)
    expect(chats.body.chats[0].name).toBe("direct import c")

    const second = await auth(request(app).post("/api/migration/telegram/import")).send({})
    expect(second.body.summary).toMatchObject({ imported: 0, skipped: 2, failed: 0 })
  })
})
