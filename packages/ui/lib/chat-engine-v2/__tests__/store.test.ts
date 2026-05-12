import { describe, expect, test, vi, afterEach } from "vitest"
import { createOpenClawQueryClient, queryKeys } from "../../query"
import {
  clearGlobalChatEngineForTests,
  getGlobalChatSession,
  ingestGlobalChatPatchForTests,
  seedGlobalChatSession,
  subscribeGlobalChatSession,
  sweepStaleGlobalChatSessions,
} from "../store"

vi.mock("../client", () => ({
  openPatchStreamV2: vi.fn(() => () => undefined),
}))

afterEach(() => {
  vi.useRealTimers()
  clearGlobalChatEngineForTests()
})

describe("global V2 chat engine store", () => {
  test("skips replay patches older than seeded bootstrap cursor", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 100,
      status: "done",
      messages: [{ messageId: "existing", role: "assistant", text: "already loaded" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 50,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 50,
        payload: { runStatus: "thinking", statusLabel: "Thinking", message: { role: "user", text: "old replay" } },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      cursor: 100,
      status: "done",
      messages: [{ messageId: "existing", text: "already loaded" }],
    })
  })

  test("retains session messages while no ChatView subscriber is mounted", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      cursor: 4,
      status: "thinking",
    })

    let latest = getGlobalChatSession("s1")
    expect(latest).toMatchObject({ cursor: 4, status: "thinking", messages: [{ messageId: "u1" }] })

    const unsubscribe = subscribeGlobalChatSession("s1", (state) => { latest = state })
    unsubscribe()

    expect(getGlobalChatSession("s1")).toMatchObject({ cursor: 4, status: "thinking", messages: [{ messageId: "u1" }] })
  })

  test("retains tools and subagents while no ChatView subscriber is mounted", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      pendingTools: [{ id: "tool-1", tool: "exec", status: "running" }],
      spawnedSubagents: [{ id: "spawn:1", label: "Worker", status: "working", toolCallId: "tool-1", sessionKey: "agent:sub" }],
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      pendingTools: [{ id: "tool-1", status: "running" }],
      spawnedSubagents: [{ toolCallId: "tool-1", status: "working" }],
    })
  })

  test("captures live tool and subagent activity from V2 assistant patches", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "tc-1", name: "exec", input: { command: "echo hi" } },
              { type: "toolCall", id: "spawn-1", name: "sessions_spawn", input: { task: "Audit UI", label: "UI Auditor" } },
            ],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "tool_running",
      pendingTools: [
        { id: "tc-1", tool: "exec", status: "running" },
        { id: "spawn-1", tool: "sessions_spawn", status: "running" },
      ],
      spawnedSubagents: [
        { toolCallId: "spawn-1", label: "UI Auditor", status: "spawning" },
      ],
    })
  })

  test("updates live tool result and approval metadata from V2 patches", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "tc-approval", name: "exec", input: { command: "touch /tmp/x" } }],
          },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "tool",
            text: "Approval required (id exec-123, full approval-456)\nCommand: ```sh\ntouch /tmp/x\n```\nReply with: /approve exec-123 allow-once|deny",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      {
        id: "tc-approval",
        status: "success",
        approval: { id: "approval-456", slug: "exec-123", command: "touch /tmp/x", allowedDecisions: ["allow-once", "deny"] },
      },
    ])
  })

  test("final done status completes any active tool rows that missed explicit results", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tc-stale",
                name: "exec",
                input: { command: "for f in memory/*.md; do cat $f; done" },
              },
            ],
          },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          sessionKey: "s1",
          message: { role: "assistant", text: "Done — I checked the files." },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "session.upsert",
        sessionKey: "s1",
        createdAtMs: 3_000,
        payload: { status: "done" },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({ status: "done", pendingTools: [] })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "Done — I checked the files.", toolCalls: [expect.objectContaining({ id: "tc-stale", tool: "exec", status: "success" })] }),
    ]))
  })

  test("does not auto-finalize thinking from assistant text without canonical run status", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: { sessionKey: "s1", optimistic: true, message: { role: "user", text: "hello" } },
      },
    })
    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: { sessionKey: "s1", message: { role: "assistant", text: "answer" } },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking" })
  })

  test("defers immediate bare done status and waits for canonical completion", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "thinking",
      statusLabel: "Thinking",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
    })

    vi.setSystemTime(2_000)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: { status: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking", statusLabel: "Thinking" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_100,
        payload: { sessionKey: "s1", message: { role: "assistant", text: "answer", __openclaw: { id: "a1" } } },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking", statusLabel: "Thinking" })

    vi.setSystemTime(8_500)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 8_500,
        payload: { status: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("assistant message patches with done status do not clear an active turn", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "thinking",
      statusLabel: "Thinking",
      messages: [{ messageId: "client-1", role: "user", text: "hello" }],
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: { semanticType: "chat.assistant.final", runStatus: "done", statusLabel: null, message: { role: "assistant", text: "answer chunk", __openclaw: { id: "a1" } } },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking", statusLabel: "Thinking" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 3_000,
        payload: { semanticType: "chat.run.done", runStatus: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("active run and canonical tool patch drive visible running/tool state", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      status: "tool_running",
      statusLabel: "web_search",
      pendingTools: [{ id: "tool-1", tool: "web_search", status: "running", startedAt: 100 }],
    })
    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "tool_running",
      statusLabel: "web_search",
      pendingTools: [{ id: "tool-1", tool: "web_search", status: "running" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 3_000,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "done",
          statusLabel: null,
          toolCall: { toolCallId: "tool-1", name: "web_search", status: "success", resultMeta: { count: 3 } },
        },
      },
    })
    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "done",
      pendingTools: [],
    })
  })

  test("promotes thinking status to tool_running when tool calls arrive after text", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "tc-live", name: "exec", input: { command: "echo hi" } }],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "tool_running",
      pendingTools: [{ id: "tc-live", status: "running" }],
    })
  })

  test("does not complete genuinely running tools before final status", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tc-live",
                name: "exec",
                input: { command: "sleep 10" },
              },
            ],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "tool_running",
      pendingTools: [{ id: "tc-live", status: "running" }],
    })
  })

  test("links spawned subagent as soon as child session activity appears", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "parent-1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "parent-1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "spawn-early", name: "sessions_spawn", input: { task: "Audit" } }],
          },
        },
      },
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.status",
        sessionKey: "agent:main:desktop:subagent:child-1",
        createdAtMs: Date.now(),
        payload: {
          status: "thinking",
          statusLabel: "Thinking",
        },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-early", sessionKey: "agent:main:desktop:subagent:child-1", status: "working" },
    ])
  })

  test("linked spawned subagent completes when child session finishes", () => {
    seedGlobalChatSession({
      sessionKey: "parent-1",
      messages: [],
      spawnedSubagents: [{ id: "spawn:1", label: "Worker", status: "working", toolCallId: "spawn-1", sessionKey: "agent:main:desktop:subagent:child-1" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "session.upsert",
        sessionKey: "agent:main:desktop:subagent:child-1",
        createdAtMs: Date.now(),
        payload: { status: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-1", sessionKey: "agent:main:desktop:subagent:child-1", status: "completed" },
    ])
  })

  test("links spawned subagent from sessions_spawn tool result", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "spawn-link", name: "sessions_spawn", input: { task: "Audit" } }],
          },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "tool",
            toolCallId: "spawn-link",
            text: '{"childSessionKey":"agent:main:subagent:abc"}',
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-link", sessionKey: "agent:main:subagent:abc", status: "working" },
    ])
  })

  test("late tool patches after done do not leave detached completed tools", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [
        { messageId: "u1", role: "user", text: "hello" },
        { messageId: "a1", role: "assistant", text: "final answer" },
      ],
      status: "done",
      pendingTools: [],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "late-tool", name: "read", input: { path: "README.md" } }],
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({ status: "done", pendingTools: [] })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "a1", role: "assistant", text: "final answer", toolCalls: [expect.objectContaining({ id: "late-tool", tool: "read", status: "success" })] }),
    ]))
  })

  test("sweeps stale active tools and subagents", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "tool-stale", name: "exec", input: { command: "sleep 999" } },
              { type: "toolCall", id: "spawn-stale", name: "sessions_spawn", input: { task: "never returns" } },
            ],
          },
        },
      },
    })

    sweepStaleGlobalChatSessions(10_000, 5_000)

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "idle",
      pendingTools: [
        { id: "tool-stale", status: "error" },
        { id: "spawn-stale", status: "error" },
      ],
      spawnedSubagents: [{ toolCallId: "spawn-stale", status: "failed" }],
    })
  })

  test("clears stale Thinking labels when a session becomes done", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "a1", role: "assistant", text: "done" }],
      status: "done",
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("ignores stale labels when activity update writes terminal status", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      status: "thinking",
      statusLabel: "Thinking",
    })

    // Import lazily through the existing module binding above would be awkward; use a terminal patch
    // to exercise the same status-label normalization path used by live updates.
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "session.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: { status: "done", statusLabel: "Thinking" },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("warms React Query bootstrap cache from global store", () => {
    const client = createOpenClawQueryClient()
    seedGlobalChatSession({
      sessionKey: "s1",
      queryClient: client,
      messages: [{ messageId: "a1", role: "assistant", text: "cached globally" }],
      cursor: 9,
      status: "done",
    })

    const cached = client.getQueryData(queryKeys.chatBootstrap("s1")) as {
      history: { messages: unknown[]; sessionStatus?: string }
      v2Cursor: number
    }
    expect(cached.history.messages).toMatchObject([{ messageId: "a1", text: "cached globally" }])
    expect(cached.history.sessionStatus).toBe("done")
    expect(cached.v2Cursor).toBe(9)
  })
})
