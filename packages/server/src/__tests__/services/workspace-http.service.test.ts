import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"

const workspaceTree = jest.fn()
const workspaceCapabilities = jest.fn()
const workspaceStat = jest.fn()
const workspaceRead = jest.fn()
const workspaceWrite = jest.fn()
const workspaceCreateDirectory = jest.fn()
const workspaceMove = jest.fn()
const workspaceDelete = jest.fn()

jest.unstable_mockModule("../../services/workspace.service.js", () => ({
  workspaceCapabilities,
  workspaceCreateDirectory,
  workspaceDelete,
  workspaceMove,
  workspaceTree,
  workspaceStat,
  workspaceRead,
  workspaceWrite,
}))

let workspaceHttp: typeof import("../../services/workspace-http.service.js")

beforeAll(async () => {
  workspaceHttp = await import("../../services/workspace-http.service.js")
})

beforeEach(() => {
  workspaceTree.mockReset()
  workspaceCapabilities.mockReset()
  workspaceStat.mockReset()
  workspaceRead.mockReset()
  workspaceWrite.mockReset()
  workspaceCreateDirectory.mockReset()
  workspaceMove.mockReset()
  workspaceDelete.mockReset()
})

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    send(payload: unknown) {
      this.body = payload
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
  }
  return response
}

describe("workspaceTreeRoute", () => {
  it("forwards session key and all flag", async () => {
    workspaceTree.mockResolvedValue({ entries: [] })
    const req = {
      query: { sessionKey: "sess_123", all: "true" },
      header: () => undefined,
      body: {},
    }
    const res = createResponse()

    await workspaceHttp.workspaceTreeRoute(req as never, res as never)

    expect(workspaceTree).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: undefined,
      all: true,
    })
    expect(res.body).toEqual({ entries: [] })
  })
})

describe("workspaceCapabilitiesRoute", () => {
  it("returns backend capability flags", async () => {
    workspaceCapabilities.mockReturnValue({
      capabilities: {
        canTree: true,
        canStat: true,
      },
    })
    const res = createResponse()

    await workspaceHttp.workspaceCapabilitiesRoute({} as never, res as never)

    expect(res.body).toEqual({
      capabilities: {
        canTree: true,
        canStat: true,
      },
    })
  })
})

describe("workspaceReadRoute", () => {
  it("returns normalized file payload", async () => {
    workspaceRead.mockResolvedValue({
      file: {
        path: "README.md",
        content: "hello",
        encoding: "utf-8",
      },
    })
    const req = {
      params: ["README.md"],
      query: { sessionKey: "sess_123" },
      header: () => undefined,
      body: {},
    }
    const res = createResponse()

    await workspaceHttp.workspaceReadRoute(req as never, res as never)

    expect(res.body).toEqual({
      path: "README.md",
      content: "hello",
      encoding: "utf-8",
      mimeType: "text/plain; charset=utf-8",
    })
  })
})

describe("workspaceWriteRoute", () => {
  it("writes content through workspace service", async () => {
    workspaceWrite.mockResolvedValue({ ok: true, path: "notes.md" })
    const req = {
      params: ["notes.md"],
      query: {},
      header: (name: string) => {
        if (name === "x-session-key") return "sess_123"
        return undefined
      },
      body: { content: "hello" },
    }
    const res = createResponse()

    await workspaceHttp.workspaceWriteRoute(req as never, res as never)

    expect(workspaceWrite).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: "notes.md",
      content: "hello",
    })
    expect(res.body).toEqual({ ok: true, path: "notes.md" })
  })
})

describe("workspaceDownloadRoute", () => {
  it("returns attachment content", async () => {
    workspaceRead.mockResolvedValue({
      file: {
        path: "docs/README.md",
        content: "hello",
        encoding: "utf-8",
      },
    })
    const req = {
      params: ["docs/README.md"],
      query: { sessionKey: "sess_123" },
      header: () => undefined,
      body: {},
    }
    const res = createResponse()

    await workspaceHttp.workspaceDownloadRoute(req as never, res as never)

    expect(res.headers["Content-Type"]).toBe("text/plain; charset=utf-8")
    expect(res.headers["Content-Disposition"]).toContain("README.md")
    expect(res.body).toBe("hello")
  })
})

describe("workspaceCreateDirectoryRoute", () => {
  it("creates directories through workspace service", async () => {
    workspaceCreateDirectory.mockResolvedValue({ ok: true, path: "repo/src" })
    const req = {
      query: {},
      header: (name: string) => {
        if (name === "x-session-key") return "sess_123"
        return undefined
      },
      body: { path: "repo/src" },
    }
    const res = createResponse()

    await workspaceHttp.workspaceCreateDirectoryRoute(req as never, res as never)

    expect(workspaceCreateDirectory).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: "repo/src",
    })
    expect(res.body).toEqual({ ok: true, path: "repo/src" })
  })
})

describe("workspaceMoveRoute", () => {
  it("moves entries through workspace service", async () => {
    workspaceMove.mockResolvedValue({
      ok: true,
      fromPath: "repo/old.md",
      toPath: "repo/new.md",
    })
    const req = {
      query: { sessionKey: "sess_123" },
      header: () => undefined,
      body: { fromPath: "repo/old.md", toPath: "repo/new.md" },
    }
    const res = createResponse()

    await workspaceHttp.workspaceMoveRoute(req as never, res as never)

    expect(workspaceMove).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      fromPath: "repo/old.md",
      toPath: "repo/new.md",
    })
    expect(res.body).toEqual({
      ok: true,
      fromPath: "repo/old.md",
      toPath: "repo/new.md",
    })
  })
})

describe("workspaceDeleteRoute", () => {
  it("deletes entries through workspace service", async () => {
    workspaceDelete.mockResolvedValue({ ok: true, path: "repo/old.md" })
    const req = {
      params: ["repo/old.md"],
      query: { sessionKey: "sess_123" },
      header: () => undefined,
      body: {},
    }
    const res = createResponse()

    await workspaceHttp.workspaceDeleteRoute(req as never, res as never)

    expect(workspaceDelete).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: "repo/old.md",
    })
    expect(res.body).toEqual({ ok: true, path: "repo/old.md" })
  })
})
