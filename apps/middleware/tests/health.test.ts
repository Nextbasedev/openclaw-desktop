import { describe, expect, it } from "vitest"
import request from "supertest"
import { createApp } from "../src/app.js"
import { loadConfig } from "../src/config.js"

const config = loadConfig({ NODE_ENV: "test", MIDDLEWARE_TOKEN: "secret" })
const app = createApp(config)

describe("health/auth", () => {
  it("returns public health", async () => {
    const res = await request(app).get("/health")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.service).toBe("openclaw-middleware")
  })

  it("allows loopback protected routes without token", async () => {
    const res = await request(app).get("/api/version")
    expect(res.status).toBe(200)
  })

  it("allows protected routes with token", async () => {
    const res = await request(app).get("/api/version").set("Authorization", "Bearer secret")
    expect(res.status).toBe(200)
    expect(res.body.version).toBe("0.1.0")
  })

  it("returns startup bootstrap data in one protected call", async () => {
    const res = await request(app).get("/api/bootstrap").set("Authorization", "Bearer secret")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(Array.isArray(res.body.spaces)).toBe(true)
    expect(Array.isArray(res.body.chats)).toBe(true)
    expect(Array.isArray(res.body.projects)).toBe(true)
    expect(Array.isArray(res.body.sessions)).toBe(true)
    expect(res.body.activeSpaceId).toBeTruthy()
  })
})
