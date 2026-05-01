import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  clearMiddlewareConnection,
  getMiddlewareConnection,
  saveMiddlewareConnection,
  testMiddlewareConnection,
  claimMiddlewarePairing,
  detectLocalMiddleware,
} from "../middleware-client"

function mockStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal("window", globalThis)
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
    configurable: true,
  })
}

describe("middleware onboarding client", () => {
  beforeEach(() => {
    mockStorage()
    vi.restoreAllMocks()
  })

  it("saves and clears middleware connection", () => {
    saveMiddlewareConnection({ url: "http://server:8787/", token: "abc" })
    expect(getMiddlewareConnection()).toEqual({ url: "http://server:8787", token: "abc" })
    clearMiddlewareConnection()
    expect(getMiddlewareConnection()).toBeNull()
  })

  it("tests health and protected version endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0" }), { status: 200 })
      }
      if (url.endsWith("/api/version")) {
        return new Response(JSON.stringify({ ok: true, version: "0.1.0" }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await testMiddlewareConnection({ url: "http://server:8787/", token: "abc" })
    expect(result.service).toBe("openclaw-middleware")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect((secondCall[1].headers as Record<string, string>).Authorization).toBe("Bearer abc")
  })

  it("fails when token is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0" }), { status: 200 })
      return new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 401 })
    }))

    await expect(testMiddlewareConnection({ url: "http://server:8787", token: "bad" })).rejects.toThrow("Invalid token")
  })

  it("detects local middleware without asking for a token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0", openclaw: { connected: true } }), { status: 200 })
      if (url.endsWith("/pairing/local")) return new Response(JSON.stringify({ ok: true, url: "http://127.0.0.1:8787", token: "local-token" }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toEqual({ ok: true, url: "http://127.0.0.1:8787", token: "local-token", mode: "local" })
  })

  it("does not auto-detect middleware when OpenClaw gateway is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0", openclaw: { connected: false } }), { status: 200 })
      if (url.endsWith("/pairing/local")) return new Response(JSON.stringify({ ok: true, url: "http://127.0.0.1:8787", token: "local-token" }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toBeNull()
  })

  it("claims remote pairing code and receives token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/pairing/claim")) return new Response(JSON.stringify({ ok: true, url: "https://server.test", token: "server-token", mode: "remote" }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(claimMiddlewarePairing({ url: "https://server.test/", code: "ABC-123" })).resolves.toEqual({ ok: true, url: "https://server.test", token: "server-token", mode: "remote" })
  })
})
