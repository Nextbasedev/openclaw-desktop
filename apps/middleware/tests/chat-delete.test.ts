import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import request from "supertest"
import { createApp } from "../src/app.js"
import { loadConfig } from "../src/config.js"
import { Store } from "../src/services/store.js"

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocmw-chat-delete-"))
  const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: "secret", MIDDLEWARE_DB: path.join(root, "state.json"), WORKSPACE_ROOT: root })
  const store = new Store(config)
  const app = createApp(config, store)
  return { app, store }
}

describe("chat delete API", () => {
  it("allows browser DELETE preflight with reflected request headers", async () => {
    const { app } = fixture()
    const res = await request(app)
      .options("/api/chats/chat_1")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "DELETE")
      .set("Access-Control-Request-Headers", "authorization,content-type,x-requested-with")

    expect(res.status).toBe(204)
    expect(res.header["access-control-allow-origin"]).toBe("http://localhost:3000")
    expect(res.header["access-control-allow-methods"]).toContain("DELETE")
    expect(res.header["access-control-allow-headers"].toLowerCase()).toContain("x-requested-with")
  })

  it("deletes chat and matching session from middleware state", async () => {
    const { app, store } = fixture()
    const create = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer secret")
      .send({ name: "Delete me", sessionKey: "agent:main:desktop:test-delete", spaceId: "space_default" })
    expect(create.status).toBe(200)

    const state = store.read()
    state.sessions = [{ key: "agent:main:desktop:test-delete", sessionKey: "agent:main:desktop:test-delete", label: "Delete me" }]
    store.write(state)

    const deleted = await request(app)
      .delete(`/api/chats/${create.body.chat.id}`)
      .set("Origin", "http://localhost:3000")
      .set("Authorization", "Bearer secret")
      .set("Content-Type", "application/json")
      .send("")
    expect(deleted.status).toBe(200)
    expect(deleted.body).toMatchObject({ ok: true, chatId: create.body.chat.id, sessionKey: "agent:main:desktop:test-delete" })

    const chats = await request(app).get("/api/chats?spaceId=space_default").set("Authorization", "Bearer secret")
    expect(chats.body.chats.some((chat: { id: string }) => chat.id === create.body.chat.id)).toBe(false)
    const sessions = await request(app).get("/api/sessions").set("Authorization", "Bearer secret")
    expect(sessions.body.sessions.some((session: { key?: string; sessionKey?: string }) => session.key === "agent:main:desktop:test-delete" || session.sessionKey === "agent:main:desktop:test-delete")).toBe(false)
  })
})
