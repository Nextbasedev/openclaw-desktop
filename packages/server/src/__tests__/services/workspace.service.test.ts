import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"

const listSessionWorkspaceFiles = jest.fn()
const getSessionWorkspaceFile = jest.fn()
const writeSessionWorkspaceFile = jest.fn()
const chatHistory = jest.fn()
const listVirtualWorkspaceEntries = jest.fn()
const listLocalWorkspaceEntries = jest.fn()
const hasLocalWorkspaceMirror = jest.fn(() => false)
const isVirtualWorkspacePath = jest.fn(() => false)
const isLocalWorkspacePath = jest.fn(() => false)
const readVirtualWorkspaceFile = jest.fn()
const readLocalWorkspaceFile = jest.fn()
const writeLocalWorkspaceFile = jest.fn()
const createLocalWorkspaceDirectory = jest.fn()
const moveLocalWorkspaceEntry = jest.fn()
const deleteLocalWorkspaceEntry = jest.fn()
const dbPrepare = jest.fn()
const getDb = jest.fn(() => ({
  prepare: dbPrepare,
}))

let sessionMappingRows: Array<{
  session_key: string
  agent_id: string
  source: string
  hidden?: number
}> = []

jest.unstable_mockModule("middleware", () => ({
  listSessionWorkspaceFiles,
  getSessionWorkspaceFile,
  writeSessionWorkspaceFile,
}))

jest.unstable_mockModule("../../db/connection.js", () => ({
  getDb,
}))

jest.unstable_mockModule("../../services/chat.service.js", () => ({
  chatHistory,
}))

jest.unstable_mockModule("../../services/workspace-virtual-entries.service.js", () => ({
  listVirtualWorkspaceEntries,
  listLocalWorkspaceEntries,
  hasLocalWorkspaceMirror,
  isVirtualWorkspacePath,
  isLocalWorkspacePath,
  readVirtualWorkspaceFile,
  readLocalWorkspaceFile,
  writeLocalWorkspaceFile,
  createLocalWorkspaceDirectory,
  moveLocalWorkspaceEntry,
  deleteLocalWorkspaceEntry,
}))

let workspace: typeof import("../../services/workspace.service.js")
let workspaceEntries: typeof import("../../services/workspace-entries.service.js")

beforeAll(async () => {
  workspace = await import("../../services/workspace.service.js")
  workspaceEntries = await import("../../services/workspace-entries.service.js")
})

beforeEach(() => {
  listSessionWorkspaceFiles.mockReset()
  getSessionWorkspaceFile.mockReset()
  writeSessionWorkspaceFile.mockReset()
  chatHistory.mockReset()
  listVirtualWorkspaceEntries.mockReset()
  listLocalWorkspaceEntries.mockReset()
  hasLocalWorkspaceMirror.mockReset()
  isVirtualWorkspacePath.mockReset()
  isLocalWorkspacePath.mockReset()
  readVirtualWorkspaceFile.mockReset()
  readLocalWorkspaceFile.mockReset()
  writeLocalWorkspaceFile.mockReset()
  createLocalWorkspaceDirectory.mockReset()
  moveLocalWorkspaceEntry.mockReset()
  deleteLocalWorkspaceEntry.mockReset()
  dbPrepare.mockReset()
  workspaceEntries.clearWorkspaceEntryCaches()
  listSessionWorkspaceFiles.mockResolvedValue({ entries: [] })
  chatHistory.mockResolvedValue({ messages: [] })
  listVirtualWorkspaceEntries.mockReturnValue([])
  listLocalWorkspaceEntries.mockReturnValue([])
  hasLocalWorkspaceMirror.mockReturnValue(false)
  isVirtualWorkspacePath.mockReturnValue(false)
  isLocalWorkspacePath.mockReturnValue(false)
  sessionMappingRows = [
    {
      session_key: "sess_123",
      agent_id: "main",
      source: "jarvis",
      hidden: 0,
    },
  ]
  dbPrepare.mockImplementation((sql: string) => ({
    get: (sessionKey: string) => {
      if (sql.includes("SELECT agent_id, source FROM session_mappings")) {
        return (
          sessionMappingRows.find((row) => row.session_key === sessionKey) ??
          undefined
        )
      }
      return undefined
    },
    all: (agentId: string, source: string) => {
      if (sql.includes("SELECT DISTINCT session_key")) {
        return sessionMappingRows
          .filter(
            (row) =>
              row.agent_id === agentId &&
              row.source === source &&
              (row.hidden ?? 0) === 0,
          )
          .map((row) => ({ session_key: row.session_key }))
      }
      return []
    },
  }))
})

describe("workspaceTree", () => {
  it("lists remote workspace entries for a session", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "src", path: "src", type: "directory", size: 0 },
        { name: "README.md", path: "README.md", type: "file", size: 12 },
      ],
    })

    const result = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(listSessionWorkspaceFiles).toHaveBeenCalledWith({
      sessionKey: "sess_123",
    })
    expect(result.entries).toEqual([
      { name: "src", path: "src", type: "directory", size: 0 },
      { name: "README.md", path: "README.md", type: "file", size: 12 },
    ])
  })

  it("builds directory entries from nested remote file paths", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "index.ts", path: "repo/src/index.ts", type: "file", size: 10 },
        { name: "README.md", path: "repo/README.md", type: "file", size: 12 },
      ],
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(root.entries).toEqual([
      { name: "repo", path: "repo", type: "directory", size: 0 },
    ])

    const repo = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: "repo",
    })

    expect(repo.entries).toEqual([
      { name: "src", path: "repo/src", type: "directory", size: 0 },
      { name: "README.md", path: "repo/README.md", type: "file", size: 12 },
    ])
  })

  it("surfaces cloned repo folders detected from chat history", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "AGENTS.md", path: "AGENTS.md", type: "file", size: 12 },
      ],
    })
    chatHistory.mockResolvedValue({
      messages: [
        {
          text: "Already cloned here: /root/.openclaw/workspace/age-changer",
        },
      ],
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(root.entries).toEqual([
      { name: "age-changer", path: "age-changer", type: "directory", size: 0 },
      { name: "AGENTS.md", path: "AGENTS.md", type: "file", size: 12 },
    ])
  })

  it("does not treat detected file paths from chat history as directories", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "AGENTS.md", path: "AGENTS.md", type: "file", size: 12 },
      ],
    })
    chatHistory.mockResolvedValue({
      messages: [
        {
          text: "Created: /root/.openclaw/workspace/openclaw/pnpm-workspace.yaml",
        },
      ],
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(root.entries).toEqual([
      { name: "openclaw", path: "openclaw", type: "directory", size: 0 },
      { name: "AGENTS.md", path: "AGENTS.md", type: "file", size: 12 },
    ])

    const repo = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: "openclaw",
    })

    expect(repo.entries).toEqual([])
  })

  it("infers cloned repo folders from remote url messages", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "MEMORY.md", path: "MEMORY.md", type: "file", size: 12 },
      ],
    })
    chatHistory.mockResolvedValue({
      messages: [
        {
          text: "Remote: https://github.com/HarshInfinityCorp/pinterest-clone.git\nBranch: main",
        },
      ],
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(root.entries).toEqual([
      {
        name: "pinterest-clone",
        path: "pinterest-clone",
        type: "directory",
        size: 0,
      },
      { name: "MEMORY.md", path: "MEMORY.md", type: "file", size: 12 },
    ])
  })

  it("shares detected clone directories across jarvis chats for the same agent", async () => {
    sessionMappingRows = [
      {
        session_key: "sess_shared",
        agent_id: "shared-agent",
        source: "jarvis",
        hidden: 0,
      },
      {
        session_key: "sess_other",
        agent_id: "shared-agent",
        source: "jarvis",
        hidden: 0,
      },
    ]
    chatHistory.mockImplementation(async ({ sessionKey }: { sessionKey: string }) => {
      if (sessionKey === "sess_other") {
        return {
          messages: [
            {
              text: "Already cloned here: /root/.openclaw/workspace/slack-clone",
            },
          ],
        }
      }
      return { messages: [] }
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_shared",
      path: ".",
    })

    expect(root.entries).toEqual([
      { name: "slack-clone", path: "slack-clone", type: "directory", size: 0 },
    ])
  })

  it("prefers real local workspace entries over clone placeholders", async () => {
    hasLocalWorkspaceMirror.mockReturnValue(true)
    listLocalWorkspaceEntries.mockReturnValue([
      {
        name: "fooocusai-3",
        path: "fooocusai-3",
        type: "directory",
        size: 0,
      },
      {
        name: "README.md",
        path: "fooocusai-3/README.md",
        type: "file",
        size: 12,
      },
    ])
    chatHistory.mockResolvedValue({
      messages: [
        {
          text: "Already cloned here: /root/.openclaw/workspace/ampere-sh",
        },
      ],
    })

    const root = await workspace.workspaceTree({
      sessionKey: "sess_123",
      path: ".",
    })

    expect(root.entries).toEqual([
      { name: "fooocusai-3", path: "fooocusai-3", type: "directory", size: 0 },
    ])
  })

  it("returns a flat tree when all=true", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "src", path: "src", type: "directory", size: 0 },
        { name: "README.md", path: "README.md", type: "file", size: 12 },
      ],
    })

    const result = await workspace.workspaceTree({
      sessionKey: "sess_123",
      all: true,
    })

    expect(result.entries).toEqual([
      { name: "src", path: "src", type: "directory", size: 0 },
      { name: "README.md", path: "README.md", type: "file", size: 12 },
    ])
  })
})

describe("workspaceCapabilities", () => {
  it("reports the remote gateway capability set", () => {
    expect(workspace.workspaceCapabilities()).toEqual({
      capabilities: {
        canTree: true,
        canStat: true,
        canRead: true,
        canWrite: true,
        canDownloadFile: true,
        canCreateDir: true,
        canMoveEntry: true,
        canDeleteEntry: true,
      },
    })
  })
})

describe("workspaceStat", () => {
  it("returns metadata for an exact entry", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "README.md", path: "README.md", type: "file", size: 12 },
      ],
    })

    const result = await workspace.workspaceStat({
      sessionKey: "sess_123",
      path: "README.md",
    })

    expect(result.entry).toEqual({
      name: "README.md",
      path: "README.md",
      type: "file",
      size: 12,
    })
  })

  it("infers directory metadata from child paths", async () => {
    listSessionWorkspaceFiles.mockResolvedValue({
      entries: [
        { name: "index.ts", path: "repo/src/index.ts", type: "file", size: 10 },
      ],
    })

    const result = await workspace.workspaceStat({
      sessionKey: "sess_123",
      path: "repo",
    })

    expect(result.entry).toEqual({
      name: "repo",
      path: "repo",
      type: "directory",
      size: 0,
    })
  })
})

describe("workspaceRead", () => {
  it("reads a remote file by session key", async () => {
    getSessionWorkspaceFile.mockResolvedValue({
      content: "hello from remote",
      encoding: "utf-8",
    })

    const result = await workspace.workspaceRead({
      sessionKey: "sess_123",
      path: "README.md",
    })

    expect(getSessionWorkspaceFile).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: "README.md",
    })
    expect(result.file).toEqual({
      path: "README.md",
      content: "hello from remote",
      encoding: "utf-8",
    })
  })

  it("reads virtual local workspace files without gateway calls", async () => {
    isVirtualWorkspacePath.mockReturnValue(true)
    readVirtualWorkspaceFile.mockReturnValue({
      content: "# Skill",
      encoding: "utf-8",
    })

    const result = await workspace.workspaceRead({
      sessionKey: "sess_123",
      path: "~/.openclaw/skills/code-review/SKILL.md",
    })

    expect(getSessionWorkspaceFile).not.toHaveBeenCalled()
    expect(result.file).toEqual({
      path: "~/.openclaw/skills/code-review/SKILL.md",
      content: "# Skill",
      encoding: "utf-8",
    })
  })

  it("reads real local workspace files without gateway calls", async () => {
    isLocalWorkspacePath.mockReturnValue(true)
    readLocalWorkspaceFile.mockReturnValue({
      content: "local readme",
      encoding: "utf-8",
    })

    const result = await workspace.workspaceRead({
      sessionKey: "sess_123",
      path: "fooocusai-3/README.md",
    })

    expect(getSessionWorkspaceFile).not.toHaveBeenCalled()
    expect(result.file).toEqual({
      path: "fooocusai-3/README.md",
      content: "local readme",
      encoding: "utf-8",
    })
  })
})

describe("workspaceWrite", () => {
  it("writes a remote file by session key", async () => {
    writeSessionWorkspaceFile.mockResolvedValue({
      ok: true,
      path: "notes/todo.md",
    })

    const result = await workspace.workspaceWrite({
      sessionKey: "sess_123",
      path: "notes/todo.md",
      content: "new text",
    })

    expect(writeSessionWorkspaceFile).toHaveBeenCalledWith({
      sessionKey: "sess_123",
      path: "notes/todo.md",
      content: "new text",
    })
    expect(result).toEqual({
      ok: true,
      path: "notes/todo.md",
    })
  })

  it("writes local workspace files directly when mirror is available", async () => {
    hasLocalWorkspaceMirror.mockReturnValue(true)

    const result = await workspace.workspaceWrite({
      sessionKey: "sess_123",
      path: "fooocusai-3/notes.md",
      content: "new text",
    })

    expect(writeSessionWorkspaceFile).not.toHaveBeenCalled()
    expect(writeLocalWorkspaceFile).toHaveBeenCalledWith(
      "fooocusai-3/notes.md",
      "new text",
    )
    expect(result).toEqual({
      ok: true,
      path: "fooocusai-3/notes.md",
    })
  })

  it("rejects writes to virtual local workspace paths", async () => {
    isVirtualWorkspacePath.mockReturnValue(true)

    await expect(
      workspace.workspaceWrite({
        sessionKey: "sess_123",
        path: "~/.openclaw/skills/code-review/SKILL.md",
        content: "x",
      }),
    ).rejects.toThrow("read-only")
  })

  it("rejects missing session keys", async () => {
    await expect(
      workspace.workspaceWrite({
        sessionKey: " ",
        path: "notes.md",
        content: "x",
      }),
    ).rejects.toThrow("Session key is required")
  })
})

describe("workspaceCreateDirectory", () => {
  it("creates local workspace folders", async () => {
    hasLocalWorkspaceMirror.mockReturnValue(true)

    const result = await workspace.workspaceCreateDirectory({
      sessionKey: "sess_123",
      path: "fooocusai-3/src",
    })

    expect(createLocalWorkspaceDirectory).toHaveBeenCalledWith("fooocusai-3/src")
    expect(result).toEqual({ ok: true, path: "fooocusai-3/src" })
  })
})

describe("workspaceMove", () => {
  it("moves local workspace entries", async () => {
    hasLocalWorkspaceMirror.mockReturnValue(true)

    const result = await workspace.workspaceMove({
      sessionKey: "sess_123",
      fromPath: "fooocusai-3/old.md",
      toPath: "fooocusai-3/new.md",
    })

    expect(moveLocalWorkspaceEntry).toHaveBeenCalledWith(
      "fooocusai-3/old.md",
      "fooocusai-3/new.md",
    )
    expect(result).toEqual({
      ok: true,
      fromPath: "fooocusai-3/old.md",
      toPath: "fooocusai-3/new.md",
    })
  })
})

describe("workspaceDelete", () => {
  it("deletes local workspace entries", async () => {
    hasLocalWorkspaceMirror.mockReturnValue(true)

    const result = await workspace.workspaceDelete({
      sessionKey: "sess_123",
      path: "fooocusai-3/old.md",
    })

    expect(deleteLocalWorkspaceEntry).toHaveBeenCalledWith("fooocusai-3/old.md")
    expect(result).toEqual({
      ok: true,
      path: "fooocusai-3/old.md",
    })
  })
})
