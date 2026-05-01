import { beforeEach, describe, expect, it, vi } from "vitest"

function mockStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
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

describe("new backend IPC routing", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("throws instead of falling back to old local backend when middleware is not configured", async () => {
    mockStorage()
    const { invoke } = await import("../ipc")
    await expect(invoke("middleware_projects_list", { input: {} })).rejects.toThrow("Middleware connection is not configured")
  })

  it("routes middleware commands to external middleware command endpoint", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await expect(invoke("middleware_unknown_future_command", { input: { hello: "world" } })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      "http://middleware.test/api/commands/middleware_unknown_future_command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: { hello: "world" } }),
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    )
  })

  it("routes chat and pty streams directly to middleware with token query", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok value",
    })
    const { streamUrl } = await import("../ipc")

    expect(streamUrl("/api/stream/chat/agent%3Amain%3Aabc")).toBe(
      "http://middleware.test/api/stream/chat/agent%3Amain%3Aabc?token=tok%20value",
    )
    expect(streamUrl("/api/stream/pty/pty-1")).toBe(
      "http://middleware.test/api/terminal/pty-1/stream?token=tok%20value",
    )
  })
})
