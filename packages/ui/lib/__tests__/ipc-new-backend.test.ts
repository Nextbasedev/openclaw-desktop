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

  it("routes spaces and project scope through canonical middleware REST endpoints", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await invoke("middleware_spaces_create", { input: { name: "Design" } })
    await invoke("middleware_projects_list", { input: { spaceId: "space_1" } })
    await invoke("middleware_projects_create", { input: { name: "P", workspaceRoot: "/tmp", spaceId: "space_1" } })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://middleware.test/api/spaces",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Design" }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://middleware.test/api/projects?spaceId=space_1",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://middleware.test/api/projects",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "P", workspaceRoot: "/tmp", spaceId: "space_1" }) }),
    )
  })

  it("falls back to legacy command endpoint when spaces REST routes are unavailable", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
    })
    const response = { spaces: [], activeSpaceId: null }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://middleware.test/api/spaces") {
        return new Response(JSON.stringify({ error: { message: "Route not found: GET /api/spaces" } }), { status: 404 })
      }
      return new Response(JSON.stringify(response), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await expect(invoke("middleware_spaces_list", { input: {} })).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://middleware.test/api/commands/middleware_spaces_list",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: {} }),
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    )
  })

  it("preserves project/topic filters when listing sessions", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await invoke("middleware_sessions_list", {
      input: { projectId: "project_1", topicId: "topic_1" },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "http://middleware.test/api/sessions?projectId=project_1&topicId=topic_1",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    )
  })
})
