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

  it("routes global archived chats with all=true instead of active-space fallback", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ chats: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await invoke("middleware_chats_list", { input: { archived: true, all: true } })

    expect(fetchMock).toHaveBeenCalledWith(
      "http://middleware.test/api/chats?archived=true&all=true",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
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

  it("routes terminal, git, workspace, project create, and session create through new middleware APIs", async () => {
    mockStorage({
      "openclaw.middleware.url": "http://middleware.test/",
      "openclaw.middleware.token": "tok",
      "openclaw.activeProjectId": "project_1",
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, terminalId: "pty-1", cwd: "/repo" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { invoke } = await import("../ipc")
    await invoke("middleware_projects_create", { input: { name: "P", workspaceRoot: "/repo" } })
    await invoke("middleware_sessions_create", { input: { projectId: "project_1", topicId: "topic_1", label: "New Chat" } })
    await invoke("middleware_chats_delete", { input: { chatId: "chat_1" } })
    await invoke("middleware_git_status", { input: { projectId: "project_1" } })
    await invoke("middleware_git_diff_for_repo", { input: { repoPath: "/repo", path: "README.md" } })
    await invoke("middleware_workspace_tree", { input: { projectId: "project_1", path: "src" } })
    await invoke("middleware_workspace_read", { input: { projectId: "project_1", path: "src/index.ts" } })
    await invoke("middleware_workspace_write", { input: { projectId: "project_1", path: "src/index.ts", content: "x" } })
    await invoke("middleware_pty_spawn", { input: { command: "pnpm dev" } })
    await invoke("middleware_pty_write", { input: { ptyId: "pty-1", data: "ls\\n" } })
    await invoke("middleware_pty_resize", { input: { ptyId: "pty-1", cols: 120, rows: 40 } })
    await invoke("middleware_pty_kill", { input: { ptyId: "pty-1" } })

    const urls = (fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>).map((call) => call[0])
    expect(urls).toEqual([
      "http://middleware.test/api/projects",
      "http://middleware.test/api/sessions",
      "http://middleware.test/api/chats/chat_1",
      "http://middleware.test/api/projects/project_1/git/status",
      "http://middleware.test/api/repos/git/diff?repoPath=%2Frepo&path=README.md",
      "http://middleware.test/api/projects/project_1/workspace/tree?path=src",
      "http://middleware.test/api/projects/project_1/workspace/file?path=src%2Findex.ts",
      "http://middleware.test/api/projects/project_1/workspace/file",
      "http://middleware.test/api/projects/project_1/terminal/spawn",
      "http://middleware.test/api/terminal/pty-1/write",
      "http://middleware.test/api/terminal/pty-1/resize",
      "http://middleware.test/api/terminal/pty-1/kill",
    ])
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
