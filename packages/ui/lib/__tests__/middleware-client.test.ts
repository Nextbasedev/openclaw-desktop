import { afterEach, describe, expect, it, vi, beforeEach } from "vitest"
import {
  clearMiddlewareConnection,
  clearMiddlewareManualDisconnect,
  getMiddlewareConnection,
  initMiddlewareConnectionCrossWindowSync,
  saveMiddlewareConnection,
  testMiddlewareConnection,
  claimMiddlewarePairing,
  detectLocalMiddleware,
  isOpenClawConnected,
  wasMiddlewareManuallyDisconnected,
  MIDDLEWARE_CONNECTION_CHANGED_EVENT,
  MIDDLEWARE_DISCONNECTED_EVENT,
  middlewareFetch,
} from "../middleware-client"
import { clearDedupeForTests } from "../requestDedupe"

function mockStorage() {
  const data = new Map<string, string>()
  const eventTarget = new EventTarget()
  vi.stubGlobal("window", {
    ...globalThis,
    location: { hostname: "localhost" },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  })
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
    configurable: true,
  })
  return { data, eventTarget }
}

describe("middleware onboarding client", () => {
  beforeEach(() => {
    mockStorage()
    vi.restoreAllMocks()
    clearDedupeForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearDedupeForTests()
  })

  it("saves and clears middleware connection", () => {
    saveMiddlewareConnection({ url: "http://server:8787/", token: "abc" })
    expect(getMiddlewareConnection()).toEqual({ url: "http://server:8787", token: "abc" })
    clearMiddlewareConnection()
    expect(getMiddlewareConnection()).toBeNull()
  })

  it("tracks manual disconnect intent until explicit reconnect", () => {
    saveMiddlewareConnection({ url: "http://server:8787/", token: "abc" })
    expect(wasMiddlewareManuallyDisconnected()).toBe(false)

    clearMiddlewareConnection()
    expect(wasMiddlewareManuallyDisconnected()).toBe(true)

    clearMiddlewareManualDisconnect()
    expect(wasMiddlewareManuallyDisconnected()).toBe(false)
  })

  it("clears manual disconnect intent when saving a new connection", () => {
    saveMiddlewareConnection({ url: "http://server:8787/", token: "abc" })
    clearMiddlewareConnection()
    expect(wasMiddlewareManuallyDisconnected()).toBe(true)

    saveMiddlewareConnection({ url: "http://127.0.0.1:8787/", token: "" })
    expect(wasMiddlewareManuallyDisconnected()).toBe(false)
  })

  it("keeps local middleware connection even when token is empty", () => {
    saveMiddlewareConnection({ url: "http://127.0.0.1:8787/", token: "" })
    expect(getMiddlewareConnection()).toEqual({ url: "http://127.0.0.1:8787", token: "" })
  })

  it("does not emit workspace reset when only the token changes for the same middleware URL", () => {
    const listener = vi.fn()
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, listener)
    saveMiddlewareConnection({ url: "http://127.0.0.1:8787", token: "old-token" })
    saveMiddlewareConnection({ url: "http://127.0.0.1:8787/", token: "new-token" })
    expect(getMiddlewareConnection()).toEqual({ url: "http://127.0.0.1:8787", token: "new-token" })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, listener)
  })

  it("syncs middleware disconnects from another app window", () => {
    const { data, eventTarget } = mockStorage()
    data.set("openclaw.middleware.url", "http://127.0.0.1:8787")
    data.set("openclaw.middleware.token", "token")
    const disconnected = vi.fn()
    const changed = vi.fn()
    window.addEventListener(MIDDLEWARE_DISCONNECTED_EVENT, disconnected)
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, changed)

    initMiddlewareConnectionCrossWindowSync()
    data.delete("openclaw.middleware.url")
    const event = new Event("storage") as StorageEvent
    Object.defineProperties(event, {
      key: { value: "openclaw.middleware.url" },
      oldValue: { value: "http://127.0.0.1:8787" },
      newValue: { value: null },
    })
    eventTarget.dispatchEvent(event)

    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ url: null })
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

  it("dedupes concurrent safe GET middleware reads", async () => {
    saveMiddlewareConnection({ url: "http://server:8787", token: "abc" })
    let resolveFetch!: (response: Response) => void
    const pendingFetch = new Promise<Response>((resolve) => { resolveFetch = resolve })
    const fetchMock = vi.fn(() => pendingFetch)
    vi.stubGlobal("fetch", fetchMock)

    const first = middlewareFetch("/api/projects")
    const second = middlewareFetch("/api/projects")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({ projects: [] }), { status: 200 }))
    await expect(Promise.all([first, second])).resolves.toEqual([{ projects: [] }, { projects: [] }])
  })

  it("does not dedupe no-cache middleware reads", async () => {
    saveMiddlewareConnection({ url: "http://server:8787", token: "abc" })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([
      middlewareFetch("/api/projects/p1/git/status", { headers: { "Cache-Control": "no-cache" } }),
      middlewareFetch("/api/projects/p1/git/status", { headers: { "Cache-Control": "no-cache" } }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("invalidates short read cache after middleware mutations", async () => {
    vi.useFakeTimers()
    saveMiddlewareConnection({ url: "http://server:8787", token: "abc" })
    let projectsCall = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/projects") && (init?.method ?? "GET") === "GET") {
        projectsCall += 1
        return new Response(JSON.stringify({ projects: [projectsCall] }), { status: 200 })
      }
      if (url.endsWith("/api/projects") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(middlewareFetch("/api/projects")).resolves.toEqual({ projects: [1] })
    await expect(middlewareFetch("/api/projects")).resolves.toEqual({ projects: [1] })
    await expect(middlewareFetch("/api/projects", { method: "POST", body: JSON.stringify({ name: "x" }) })).resolves.toEqual({ ok: true })
    await expect(middlewareFetch("/api/projects")).resolves.toEqual({ projects: [2] })
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
      return new Response("not found", { status: 404 })
    }))

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toEqual({ ok: true, url: "http://127.0.0.1:8787", token: "", mode: "local" })
  })

  it("accepts middleware gateway.connected health shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0", gateway: { connected: true } }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toEqual({ ok: true, url: "http://127.0.0.1:8787", token: "", mode: "local" })
    expect(isOpenClawConnected({ ok: true, service: "openclaw-middleware", version: "0.1.0", gateway: { connected: true } })).toBe(true)
  })

  it("does not auto-detect middleware when OpenClaw gateway is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "openclaw-middleware", version: "0.1.0", openclaw: { connected: false } }), { status: 200 })
      if (url.endsWith("/pairing/local")) return new Response(JSON.stringify({ ok: true, url: "http://127.0.0.1:8787", token: "local-token" }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toBeNull()
  })

  it("does not probe localhost middleware when opened from a remote host", async () => {
    Object.defineProperty(window, "location", { value: { hostname: "100.79.189.15" }, configurable: true })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(detectLocalMiddleware(["http://127.0.0.1:8787"])).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps loopback middleware URLs when opened inside Tauri", () => {
    Object.defineProperty(window, "location", { value: { hostname: "tauri.localhost" }, configurable: true })
    saveMiddlewareConnection({ url: "http://127.0.0.1:8787/", token: "abc" })

    expect(getMiddlewareConnection()).toEqual({ url: "http://127.0.0.1:8787", token: "abc" })
  })

  it("rewrites stale loopback middleware URLs when opened from a remote host", () => {
    Object.defineProperty(window, "location", { value: { hostname: "100.79.189.15" }, configurable: true })
    saveMiddlewareConnection({ url: "http://127.0.0.1:8787/", token: "abc" })

    expect(getMiddlewareConnection()).toEqual({ url: "http://100.79.189.15:8787", token: "abc" })
  })

  it("claims remote pairing code and receives token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/pairing/claim")) return new Response(JSON.stringify({ ok: true, url: "https://server.test", token: "server-token", mode: "remote" }), { status: 200 })
      return new Response("not found", { status: 404 })
    }))

    await expect(claimMiddlewarePairing({ url: "https://server.test/", code: "ABC-123" })).resolves.toEqual({ ok: true, url: "https://server.test", token: "server-token", mode: "remote" })
  })
})
