import { beforeEach, describe, expect, it, vi } from "vitest"

describe("middleware client", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL
  })

  it("defaults to the legacy middleware port", async () => {
    const { getMiddlewareUrl } = await import("../client")
    expect(getMiddlewareUrl()).toBe("http://127.0.0.1:8787")
  })

  it("uses the connected middleware URL for v2 API calls", async () => {
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === "openclaw.middleware.url" ? "http://192.0.2.10:8787/" : null),
    })
    const { getMiddlewareUrl } = await import("../client")
    expect(getMiddlewareUrl()).toBe("http://192.0.2.10:8787")
  })

  it("rewrites loopback v2 URL to the browser host on port 8787", async () => {
    vi.stubGlobal("window", { location: { hostname: "192.0.2.10" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) })
    process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL = "http://127.0.0.1:8787"
    const { getMiddlewareUrl } = await import("../client")
    expect(getMiddlewareUrl()).toBe("http://192.0.2.10:8787")
  })
  it("does not rewrite loopback URLs inside the Tauri localhost origin", async () => {
    vi.stubGlobal("window", { location: { hostname: "tauri.localhost" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) })
    process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL = "http://127.0.0.1:8787"
    const { getMiddlewareUrl } = await import("../client")
    expect(getMiddlewareUrl()).toBe("http://127.0.0.1:8787")
  })

  it("uses the active Connect page middleware URL before the v2 override", async () => {
    const data = new Map<string, string>([
      ["openclaw.middleware.url", "https://remote.example.com/"],
      ["openclaw.middleware.token", "remote-token"],
      ["openclaw.middleware.v2.url", "http://127.0.0.1:8787"],
    ])
    vi.stubGlobal("window", { location: { hostname: "tauri.localhost" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => data.get(key) ?? null) })
    const { getMiddlewareUrl } = await import("../client")
    expect(getMiddlewareUrl()).toBe("https://remote.example.com")
  })

  it("dedupes concurrent session-context usage reads", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) })
    let resolveFetch!: (response: Response) => void
    const pendingFetch = new Promise<Response>((resolve) => { resolveFetch = resolve })
    const fetchMock = vi.fn(() => pendingFetch)
    vi.stubGlobal("fetch", fetchMock)

    const { fetchSessionContextUsage } = await import("../client")
    const first = fetchSessionContextUsage("s1")
    const second = fetchSessionContextUsage("s1")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({ ok: true, sessionKey: "s1", usage: null, updatedAtMs: 1 }), { status: 200 }))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, sessionKey: "s1", usage: null, updatedAtMs: 1 },
      { ok: true, sessionKey: "s1", usage: null, updatedAtMs: 1 },
    ])
  })

  it("continues delivering live patches after backlog replay finishes", async () => {
    const data = new Map<string, string>()
    vi.stubGlobal("window", { location: { hostname: "localhost" }, console, addEventListener: vi.fn(), dispatchEvent: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => data.get(key) ?? null) })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      patches: [{ cursor: 2, type: "chat.message.upsert", sessionKey: "s1", payload: {}, createdAtMs: 2 }],
      hasMore: false,
      latestCursor: 2,
    }), { status: 200 })))

    const sockets: Array<{ onmessage?: (event: { data: string }) => void; close: () => void }> = []
    class FakeWebSocket {
      onmessage?: (event: { data: string }) => void
      onopen?: () => void
      onerror?: () => void
      onclose?: (event: { code: number; wasClean: boolean }) => void
      constructor(_url: string) { sockets.push(this) }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket)

    const { openPatchStreamV2 } = await import("../client")
    const frames: unknown[] = []
    openPatchStreamV2(0, (frame) => frames.push(frame))

    sockets[0].onmessage?.({ data: JSON.stringify({ type: "hello", clientId: "c1", afterCursor: 0, replayCount: 1, replayHasMore: true }) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    sockets[0].onmessage?.({ data: JSON.stringify({ type: "patch", patch: { cursor: 3, type: "chat.status", sessionKey: "s1", payload: {}, createdAtMs: 3 } }) })

    expect(frames).toEqual([
      expect.objectContaining({ type: "hello" }),
      expect.objectContaining({ type: "patch", patch: expect.objectContaining({ cursor: 2 }) }),
      expect.objectContaining({ type: "patch", patch: expect.objectContaining({ cursor: 3 }) }),
    ])
  })

  it("I1: shares ONE websocket across multiple subscribers and fans out frames", async () => {
    const data = new Map<string, string>()
    vi.stubGlobal("window", { location: { hostname: "localhost" }, console, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => data.get(key) ?? null) })

    const sockets: Array<{ onmessage?: (event: { data: string }) => void; closed: boolean }> = []
    class FakeWebSocket {
      onmessage?: (event: { data: string }) => void
      onopen?: () => void
      onerror?: () => void
      onclose?: (event: { code: number; wasClean: boolean }) => void
      closed = false
      readyState = 1
      constructor(_url: string) { sockets.push(this) }
      close() { this.closed = true }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket)

    const { subscribeChatPatches } = await import("../client")
    const a: unknown[] = []
    const b: unknown[] = []
    const c: unknown[] = []
    const relA = subscribeChatPatches(100, (f) => a.push(f))
    const relB = subscribeChatPatches(100, (f) => b.push(f))
    const relC = subscribeChatPatches(100, (f) => c.push(f))

    // PROOF of I1 fix: 3 subscribers, exactly ONE underlying socket.
    expect(sockets).toHaveLength(1)

    sockets[0].onmessage?.({ data: JSON.stringify({ type: "patch", patch: { cursor: 101, type: "chat.status", sessionKey: "s1", payload: {}, createdAtMs: 1 } }) })
    // every subscriber receives the frame
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(c).toHaveLength(1)

    // socket stays open until the LAST subscriber releases
    relA(); relB()
    expect(sockets[0].closed).toBe(false)
    relC()
    // deferred teardown: not closed immediately (survives StrictMode remount gap)
    expect(sockets[0].closed).toBe(false)
    // a new subscriber within the grace window REUSES the same socket
    const relD = subscribeChatPatches(100, () => {})
    expect(sockets).toHaveLength(1)
    relD()
    // after the grace period with no subscribers, the socket finally closes
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(sockets[0].closed).toBe(true)
    expect(sockets).toHaveLength(1)
  })
})
