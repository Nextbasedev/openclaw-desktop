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
  test("tracks queued follow-up turn status by client message id", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1,
        payload: {
          semanticType: "chat.user.created",
          messageId: "u1",
          clientMessageId: "u1",
          runId: "run-1",
          runStatus: "thinking",
          statusLabel: "Thinking",
          message: { role: "user", text: "first", __openclaw: { id: "u1", runId: "run-1" } },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2,
        payload: {
          semanticType: "chat.user.created",
          messageId: "u2",
          clientMessageId: "u2",
          runId: "run-2",
          runStatus: "queued",
          statusLabel: "Queued",
          message: { role: "user", text: "second", __openclaw: { id: "u2", runId: "run-2" } },
        },
      },
    })

    let state = getGlobalChatSession("s1")!
    expect(state.messages.find((message) => message.messageId === "u2")).toMatchObject({ turnStatus: "queued", turnStatusLabel: "Queued" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 3,
        payload: {
          semanticType: "chat.assistant.final",
          messageId: "a1",
          clientMessageId: "u1",
          runId: "run-1",
          runStatus: "done",
          message: { role: "assistant", text: "answer one", __openclaw: { id: "a1", runId: "run-1" } },
        },
      },
    })

    state = getGlobalChatSession("s1")!
    expect(state.messages.find((message) => message.messageId === "u1")?.turnStatus).toBeUndefined()
    expect(state.messages.find((message) => message.messageId === "u2")).toMatchObject({ turnStatus: "queued", turnStatusLabel: "Queued" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 4,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 3,
        payload: {
          semanticType: "chat.run.status",
          clientMessageId: "u2",
          runId: "run-2",
          runStatus: "thinking",
          statusLabel: "Thinking",
        },
      },
    })

    state = getGlobalChatSession("s1")!
    expect(state.messages.find((message) => message.messageId === "u2")).toMatchObject({ turnStatus: "thinking", turnStatusLabel: "Thinking" })
  })

  test("does not resurrect a completed chat from an old running tool replay", () => {
    vi.setSystemTime(new Date("2026-05-15T08:30:00.000Z"))
    const oldStartedAt = Date.now() - 48 * 60 * 60 * 1000
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "hello" },
        { messageId: "a1", role: "assistant", text: "done" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.tool.started",
          runStatus: "tool_running",
          statusLabel: "read",
          toolCall: {
            toolCallId: "stale-tool",
            name: "read",
            status: "running",
            phase: "start",
            startedAtMs: oldStartedAt,
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")!
    expect(state.status).toBe("done")
    expect(state.pendingTools).toEqual([])
  })

  test("bootstrap seed preserves newer live messages already applied from patches", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tool-live", tool: "exec", status: "running", startedAt: 1_000 }],
      messages: [
        { messageId: "u1", role: "user", text: "question" },
        { messageId: "a-live", role: "assistant", text: "new live answer" },
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 8,
      status: "done",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "question" },
      ],
    })

    const state = getGlobalChatSession("s1")!
    expect(state.cursor).toBe(10)
    expect(state.status).toBe("tool_running")
    expect(state.pendingTools).toEqual([expect.objectContaining({ id: "tool-live", status: "running" })])
    expect(state.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "a-live", text: "new live answer" }),
    ]))
  })

  test("updates visible completed tool row when result arrives after pending tools were cleared", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 1,
      status: "done",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "read file" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "read", status: "success", startedAt: 1_000, completedAt: 2_000, duration: "1.0s" }] },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_500,
        payload: {
          semanticType: "chat.message.upsert",
          message: {
            id: "tool-result",
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file contents" }],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        toolCalls: [expect.objectContaining({ id: "tool-1", resultText: "file contents", status: "success" })],
      }),
    ]))
  })

  test("ignores stale result patch to already visible completed tool rows", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "read file" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "read", status: "success", startedAt: 1_000, completedAt: 2_000 }] },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 9,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_500,
        payload: {
          semanticType: "chat.message.upsert",
          message: {
            id: "tool-result",
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "late file contents" }],
          },
        },
      },
    })

    const tool = getGlobalChatSession("s1")!.messages.find((message) => message.messageId === "a-tools")?.toolCalls?.[0]
    expect(tool).toMatchObject({ id: "tool-1", status: "success" })
    expect(tool).not.toHaveProperty("resultText", "late file contents")
  })

  test("updates visible tool row from user tool_result content blocks", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "tool_running",
      pendingTools: [{ id: "tool-1", tool: "memory_search", status: "running", startedAt: 1_000 }],
      messages: [
        { messageId: "u1", role: "user", text: "search memory" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "memory_search", status: "running", startedAt: 1_000 }] },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.message.upsert",
          message: {
            id: "tool-result",
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "real result from block" }],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        toolCalls: [expect.objectContaining({ id: "tool-1", resultText: "real result from block", status: "success" })],
      }),
    ]))
  })

  test("replaces inferred live tool output with real tool result", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "tool_running",
      pendingTools: [{ id: "tool-1", tool: "memory_search", status: "running", startedAt: 1_000 }],
      messages: [
        { messageId: "u1", role: "user", text: "search memory" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "memory_search", status: "running", startedAt: 1_000 }] },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "tool_running",
          activeRun: { runId: "run-1", status: "tool_running" },
          toolCallId: "tool-1",
          toolCall: {
            toolCallId: "tool-1",
            name: "memory_search",
            status: "success",
            phase: "result",
            resultMeta: { inferred: true, reason: "assistant_final_after_tool_calls" },
            startedAtMs: 1_000,
            finishedAtMs: 2_000,
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
        createdAtMs: 3_000,
        payload: {
          semanticType: "chat.message.upsert",
          message: { id: "tool-result", role: "tool", toolCallId: "tool-1", text: "real memory result" },
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        toolCalls: [expect.objectContaining({ id: "tool-1", resultText: "real memory result", status: "success" })],
      }),
    ]))
  })

  test("attaches reasoning deltas to the active assistant message", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "thinking",
      messages: [{ messageId: "u1", role: "user", text: "check repo" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.reasoning.delta",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          semanticType: "chat.reasoning.delta",
          runStatus: "thinking",
          activeRun: { runId: "run-1", status: "thinking" },
          runId: "run-1",
          text: "I am inspecting files",
          delta: "I am inspecting files",
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", reasoningText: "I am inspecting files", text: "" }),
    ]))

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.assistant.final",
          runStatus: "done",
          messageSeq: 2,
          message: { id: "a1", role: "assistant", text: "Done." },
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual([
      expect.objectContaining({ messageId: "u1", role: "user" }),
      expect.objectContaining({ messageId: "a1", role: "assistant", text: "Done.", reasoningText: "I am inspecting files" }),
    ])
  })

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

  test("does not resurrect completed history replay into Thinking", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "hello" },
        { messageId: "a1", role: "assistant", text: "answer already arrived" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 11,
        payload: {
          runStatus: "thinking",
          statusLabel: "Thinking",
          activeRun: { status: "thinking" },
          message: { id: "a1", role: "assistant", text: "answer already arrived" },
        },
      },
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 12,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 12,
        payload: { runStatus: "thinking", statusLabel: "Thinking", activeRun: { status: "thinking" } },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      cursor: 12,
      status: "done",
      statusLabel: null,
      messages: expect.arrayContaining([expect.objectContaining({ messageId: "a1", text: "answer already arrived" })]),
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

  test("notifies subscribers for each websocket assistant delta so UI can render progress", () => {
    const seenTexts: string[] = []
    const unsubscribe = subscribeGlobalChatSession("s1", (state) => {
      const latestAssistant = [...state.messages].reverse().find((message) => message.role === "assistant")
      if (latestAssistant?.text) seenTexts.push(latestAssistant.text)
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1,
        payload: {
          semanticType: "chat.assistant.delta",
          runStatus: "streaming",
          statusLabel: "Streaming",
          messageId: "live:r1:assistant",
          message: { role: "assistant", text: "Hel", __openclaw: { id: "live:r1:assistant" } },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2,
        payload: {
          semanticType: "chat.assistant.delta",
          runStatus: "streaming",
          statusLabel: "Streaming",
          messageId: "live:r1:assistant",
          message: { role: "assistant", text: "Hello live", __openclaw: { id: "live:r1:assistant" } },
        },
      },
    })

    unsubscribe()
    expect(seenTexts).toEqual(["Hel", "Hello live"])
    expect(getGlobalChatSession("s1")).toMatchObject({
      messages: [expect.objectContaining({ text: "Hello live", animateText: true })],
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

  test("does not duplicate anonymous live tool blocks when the same assistant message is upserted", () => {
    const patchMessage = {
      id: "assistant-live-1",
      role: "assistant",
      content: [
        { type: "toolCall", name: "exec", input: { command: "echo hi" } },
      ],
    }

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s1", message: patchMessage },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s1", message: patchMessage },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      { id: "tool:assistant-live-1:0:exec", tool: "exec", status: "running" },
    ])
    expect(getGlobalChatSession("s1")?.pendingTools).toHaveLength(1)
  })

  test("clears detached completed tool stack when a new live turn starts", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      status: "idle",
      pendingTools: [
        { id: "old-1", tool: "exec", status: "success", duration: "1.0s" },
        { id: "old-2", tool: "session_status", status: "success", duration: "0.5s" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          runStatus: "thinking",
          statusLabel: "Thinking",
          message: { role: "user", text: "next turn" },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toEqual([])
  })

  test("treats canonical result phase as successful even without explicit status", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: {
            toolCallId: "tc-phase-result",
            name: "read",
            phase: "result",
            startedAtMs: 1_000,
            finishedAtMs: 2_000,
            resultMeta: "done",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      { id: "tc-phase-result", tool: "read", status: "success", duration: "1.0s", resultText: "done" },
    ])
  })

  test("preserves completed tool duration from canonical tool patches", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: {
            toolCallId: "tc-duration",
            name: "exec",
            status: "success",
            startedAtMs: 1_000,
            finishedAtMs: 2_250,
            resultMeta: "ok",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      { id: "tc-duration", tool: "exec", status: "success", duration: "1.3s" },
    ])
  })

  test("updates visible assistant tool row as soon as canonical tool result arrives", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          sessionKey: "s1",
          runStatus: "tool_running",
          statusLabel: "read",
          activeRun: { status: "tool_running" },
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "tc-visible", name: "read", input: { path: "A.md" } }],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.messages[0]?.toolCalls).toMatchObject([
      { id: "tc-visible", tool: "read", status: "running" },
    ])

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "thinking",
          statusLabel: "Thinking",
          activeRun: { status: "thinking" },
          toolCall: {
            toolCallId: "tc-visible",
            name: "read",
            status: "success",
            phase: "result",
            startedAtMs: 1_000,
            finishedAtMs: 2_000,
            resultMeta: "file contents",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.messages[0]?.toolCalls).toMatchObject([
      { id: "tc-visible", tool: "read", status: "success", resultText: "file contents" },
    ])
  })

  test("does not keep status stuck on tool_running after final canonical tool result", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          semanticType: "chat.tool.started",
          runStatus: "tool_running",
          statusLabel: "exec",
          activeRun: { status: "tool_running" },
          toolCall: {
            toolCallId: "tc-finish",
            name: "exec",
            status: "running",
            phase: "calling",
            startedAtMs: 1_000,
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "tool_running", statusLabel: "exec" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "thinking",
          statusLabel: "Thinking",
          activeRun: { status: "thinking" },
          toolCall: {
            toolCallId: "tc-finish",
            name: "exec",
            status: "success",
            phase: "result",
            startedAtMs: 1_000,
            finishedAtMs: 2_000,
            resultMeta: "ok",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "thinking",
      statusLabel: "Thinking",
      pendingTools: [{ id: "tc-finish", tool: "exec", status: "success" }],
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

  test("keeps live canonical tool partial output while the tool is running", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: 1_000,
        payload: {
          semanticType: "chat.tool.started",
          toolCall: {
            toolCallId: "tc-live",
            name: "exec",
            phase: "start",
            status: "running",
            startedAtMs: 1_000,
            resultMeta: { stdout: "live output" },
          },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: 1_200,
        payload: {
          semanticType: "chat.tool.started",
          toolCall: {
            toolCallId: "tc-live",
            name: "exec",
            phase: "start",
            status: "running",
            startedAtMs: 1_000,
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      { id: "tc-live", tool: "exec", status: "running", resultText: JSON.stringify({ stdout: "live output" }, null, 2) },
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
      expect.objectContaining({ role: "assistant", text: "", toolCalls: [expect.objectContaining({ id: "tc-stale", tool: "exec", status: "success" })] }),
      expect.objectContaining({ role: "assistant", text: "Done — I checked the files.", toolCalls: undefined }),
    ]))
  })

  test("shows streaming after assistant text without auto-finalizing canonical run", () => {
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

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "streaming", statusLabel: "Streaming" })
  })

  test("assistant error text immediately ends the active turn", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      status: "thinking",
      statusLabel: "Thinking",
      pendingTools: [{ id: "tool-1", tool: "exec", status: "running" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          message: {
            role: "assistant",
            text: 'Error: 402 {"code":"deactivated_workspace"}',
            stopReason: "error",
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({
      status: "error",
      statusLabel: null,
      pendingTools: [],
    })
    expect(state?.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Error: Workspace is deactivated. Reactivate the workspace and try again.",
      stopReason: "error",
      animateText: true,
    })
  })

  test("mixed success text with an error line does not become terminal error", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "push it" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.assistant.final",
          runStatus: "done",
          status: "done",
          message: {
            role: "assistant",
            text: "Error: terminated\n\nPushed successfully.\n\n- Tests passed: `23/23`",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "done",
      statusLabel: null,
    })
    expect(getGlobalChatSession("s1")?.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Error: terminated\n\nPushed successfully.\n\n- Tests passed: `23/23`",
    })
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

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "streaming", statusLabel: "Streaming" })

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

  test("final assistant message patches with done status clear the active turn", () => {
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

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "done", statusLabel: null })

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

  test("does not show inferred fallback metadata as tool output", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [
        { messageId: "u1", role: "user", text: "run tools" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "web_search", status: "running", startedAt: 1_000 }] },
      ],
      status: "tool_running",
      statusLabel: "web_search",
      pendingTools: [{ id: "tool-1", tool: "web_search", status: "running", startedAt: 1_000 }],
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
          runStatus: "thinking",
          statusLabel: "Thinking",
          toolCall: {
            toolCallId: "tool-1",
            name: "web_search",
            status: "success",
            resultMeta: { inferred: true, reason: "next_tool_started_after_missing_result_event" },
            startedAtMs: 1_000,
            finishedAtMs: 3_000,
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        toolCalls: [expect.objectContaining({ id: "tool-1", status: "success", resultText: undefined })],
      }),
    ]))
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

  test("does not resurrect tool calls from canonical assistant final history patches", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "old request" }],
      status: "streaming",
      statusLabel: "Streaming",
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.assistant.final",
          sessionKey: "s1",
          runStatus: "streaming",
          statusLabel: "Streaming",
          activeRun: { runId: "current-run", status: "streaming" },
          message: {
            role: "assistant",
            text: "Already answered earlier",
            content: [
              { type: "toolCall", id: "old-memory-search", name: "memory_search", input: { query: "old" } },
              { type: "text", text: "Already answered earlier" },
            ],
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "streaming",
      pendingTools: [],
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

  test("ignores stale tool result patches for already completed tools", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "run command" },
        {
          messageId: "a1",
          role: "assistant",
          text: "done",
          toolCalls: [{ id: "tc-done", tool: "exec", status: "success", resultText: "ok" }],
        },
      ],
      pendingTools: [{ id: "tc-done", tool: "exec", status: "success", resultText: "ok" }],
    })
    const updates: unknown[] = []
    const unsubscribe = subscribeGlobalChatSession("s1", (state) => updates.push(state))

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 9,
        type: "chat.tool.completed",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.tool.completed",
          runStatus: "done",
          toolCall: {
            toolCallId: "tc-done",
            name: "exec",
            status: "completed",
            resultMeta: "old replay",
          },
        },
      },
    })

    expect(updates).toHaveLength(1)
    expect(getGlobalChatSession("s1")?.pendingTools).toEqual([])
    unsubscribe()
  })

  test("does not auto-link spawned subagent from child session shape alone", () => {
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
      { toolCallId: "spawn-early", sessionKey: null, status: "spawning" },
    ])
  })

  test("does not auto-link discovered subagent when multiple parents are possible", () => {
    seedGlobalChatSession({
      sessionKey: "parent-1",
      messages: [],
      cursor: 10,
      spawnedSubagents: [{ id: "spawn:1", label: "Worker 1", status: "spawning", toolCallId: "spawn-1", sessionKey: null }],
    })
    seedGlobalChatSession({
      sessionKey: "parent-2",
      messages: [],
      cursor: 11,
      spawnedSubagents: [{ id: "spawn:2", label: "Worker 2", status: "spawning", toolCallId: "spawn-2", sessionKey: null }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 12,
        type: "chat.status",
        sessionKey: "agent:main:desktop:subagent:child-1",
        createdAtMs: Date.now(),
        payload: { status: "thinking", statusLabel: "Thinking" },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents[0]?.sessionKey).toBeNull()
    expect(getGlobalChatSession("parent-2")?.spawnedSubagents[0]?.sessionKey).toBeNull()
  })

  test("keeps child subagent messages isolated from the parent chat", () => {
    const parentUpdates: unknown[] = []
    const childUpdates: unknown[] = []
    const unsubscribeParent = subscribeGlobalChatSession("parent-1", (state) => parentUpdates.push(state))
    const unsubscribeChild = subscribeGlobalChatSession("agent:main:desktop:subagent:child-1", (state) => childUpdates.push(state))

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
            messageId: "parent-spawn",
            role: "assistant",
            content: [{ type: "toolCall", id: "spawn-child", name: "sessions_spawn", input: { task: "Audit" } }],
          },
        },
      },
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "agent:main:desktop:subagent:child-1",
        createdAtMs: Date.now(),
        payload: {
          runStatus: "thinking",
          statusLabel: "Thinking",
          message: { messageId: "child-answer", role: "assistant", text: "Child-only progress" },
        },
      },
    })

    expect(getGlobalChatSession("parent-1")?.messages).toHaveLength(1)
    expect(getGlobalChatSession("parent-1")?.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Child-only progress" }),
    ]))
    expect(getGlobalChatSession("agent:main:desktop:subagent:child-1")?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Child-only progress" }),
    ]))
    expect(parentUpdates).toHaveLength(1)
    expect(childUpdates).toHaveLength(1)

    unsubscribeParent()
    unsubscribeChild()
  })


  test("syncs explicitly linked spawned child status even when child key is a normal session shape", () => {
    seedGlobalChatSession({
      sessionKey: "parent-1",
      messages: [],
      spawnedSubagents: [{ id: "spawn:1", label: "Worker", status: "working", toolCallId: "spawn-1", sessionKey: "agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "session.upsert",
        sessionKey: "agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340",
        createdAtMs: Date.now(),
        payload: { status: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-1", sessionKey: "agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340", status: "completed" },
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

  test("keeps completed linked spawned subagents visible across later turns", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        {
          id: "spawn:1",
          label: "Worker",
          status: "completed",
          toolCallId: "spawn-1",
          sessionKey: "agent:main:subagent:child-1",
        },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: { id: "u2", role: "user", text: "next turn" },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-1", sessionKey: "agent:main:subagent:child-1", status: "completed" },
    ])
  })

  test("does not downgrade completed linked spawned subagent when spawn result replays", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        {
          id: "spawn:spawn-1",
          label: "Worker",
          status: "completed",
          toolCallId: "spawn-1",
          sessionKey: "agent:main:subagent:child-1",
        },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: {
            toolCallId: "spawn-1",
            name: "sessions_spawn",
            status: "success",
            phase: "result",
            resultMeta: { childSessionKey: "agent:main:subagent:child-1" },
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-1", sessionKey: "agent:main:subagent:child-1", status: "completed" },
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

  test("keeps canonical sessions_spawn result with child link active until child finishes", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: {
            toolCallId: "spawn-live",
            name: "sessions_spawn",
            status: "running",
            phase: "start",
            argsMeta: { task: "Audit" },
            startedAtMs: Date.now(),
          },
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: {
            toolCallId: "spawn-live",
            name: "sessions_spawn",
            status: "success",
            phase: "result",
            argsMeta: { task: "Audit" },
            resultMeta: { childSessionKey: "agent:main:dashboard:child-live" },
            startedAtMs: Date.now() - 1000,
            finishedAtMs: Date.now(),
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-live", sessionKey: "agent:main:dashboard:child-live", status: "working" },
    ])
  })

  test("dedupes repeated sessions_spawn patches for the same requested child", () => {
    for (const [cursor, toolCallId, childSessionKey] of [
      [1, "spawn-ui-1", "agent:main:subagent:ui-1"],
      [2, "spawn-flow-1", "agent:main:subagent:flow-1"],
      [3, "spawn-ui-2", "agent:main:subagent:ui-2"],
      [4, "spawn-flow-2", "agent:main:subagent:flow-2"],
      [5, "spawn-ui-3", "agent:main:subagent:ui-3"],
      [6, "spawn-flow-3", "agent:main:subagent:flow-3"],
    ] as const) {
      const isUi = toolCallId.includes("ui")
      ingestGlobalChatPatchForTests({
        type: "patch",
        patch: {
          cursor,
          type: "chat.tool.result",
          sessionKey: "s1",
          createdAtMs: Date.now(),
          payload: {
            sessionKey: "s1",
            toolCall: {
              toolCallId,
              name: "sessions_spawn",
              status: "success",
              phase: "result",
              argsMeta: {
                label: isUi ? "ui-automation" : "agentic-workflow",
                task: isUi ? "UI automation" : "Agentic workflow",
              },
              resultMeta: { childSessionKey },
            },
          },
        },
      })
    }

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toHaveLength(2)
    expect(getGlobalChatSession("s1")?.spawnedSubagents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ui-automation", status: "working" }),
        expect.objectContaining({ label: "agentic-workflow", status: "working" }),
      ]),
    )
  })

  test("deduped repeated spawn can still complete the selected linked child", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        {
          id: "spawn:ui-1",
          label: "ui-automation",
          task: "UI automation",
          status: "working",
          toolCallId: "ui-1",
          sessionKey: "agent:main:subagent:ui-1",
        },
        {
          id: "spawn:ui-2",
          label: "ui-automation",
          task: "UI automation",
          status: "completed",
          toolCallId: "ui-2",
          sessionKey: "agent:main:subagent:ui-2",
        },
      ],
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { label: "ui-automation", status: "working", sessionKey: "agent:main:subagent:ui-1" },
    ])

    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        {
          id: "spawn:ui-1",
          label: "ui-automation",
          task: "UI automation",
          status: "working",
          toolCallId: "ui-1",
          sessionKey: "agent:main:subagent:ui-1",
        },
        {
          id: "spawn:ui-1",
          label: "ui-automation",
          task: "UI automation",
          status: "completed",
          toolCallId: "ui-1",
          sessionKey: "agent:main:subagent:ui-1",
        },
      ],
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { label: "ui-automation", status: "completed", sessionKey: "agent:main:subagent:ui-1" },
    ])
  })

  test("dedupes same explicit label even when repeated task wording differs", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        { id: "spawn:a", label: "ui-automation", task: "Stand by for UI automation work", status: "working", toolCallId: "a", sessionKey: "agent:main:subagent:a" },
        { id: "spawn:b", label: "ui-automation", task: "Prepare to handle browser/UI automation work", status: "working", toolCallId: "b", sessionKey: "agent:main:subagent:b" },
      ],
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toHaveLength(1)
    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { label: "ui-automation", status: "working" },
    ])
  })

  test("completes sessions_spawn when result has no child session link", () => {
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
            content: [{ type: "toolCall", id: "spawn-complete", name: "sessions_spawn", input: { task: "Audit" } }],
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
            toolCallId: "spawn-complete",
            text: "Spawn request completed without a child session link",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-complete", sessionKey: null, status: "completed" },
    ])
  })

  test("marks sessions_spawn as failed from structured tool error metadata", () => {
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
            content: [{ type: "toolCall", id: "spawn-fail", name: "sessions_spawn", input: { task: "Audit" } }],
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
            toolCallId: "spawn-fail",
            text: "Child session failed before link",
            status: "error",
          },
        },
      },
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-fail", sessionKey: null, status: "failed" },
    ])
    expect(getGlobalChatSession("s1")?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        toolCalls: expect.arrayContaining([
          expect.objectContaining({ id: "spawn-fail", tool: "sessions_spawn", status: "error" }),
        ]),
      }),
    ]))
  })


  test("shows streaming instead of thinking once assistant text is visible and no tools are active", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      cursor: 1,
      status: "thinking",
      statusLabel: "Thinking",
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          runStatus: "thinking",
          statusLabel: "Thinking",
          message: { role: "assistant", text: "Here is the answer." },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "streaming",
      statusLabel: "Streaming",
      pendingTools: [],
    })
  })

  test("keeps tool_running visible when thinking patches arrive while tools are active", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      cursor: 1,
      status: "tool_running",
      statusLabel: "read",
      pendingTools: [{ id: "tool-1", tool: "read", status: "running" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          runStatus: "thinking",
          statusLabel: "Thinking",
          message: { role: "assistant", text: "Partial text" },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "tool_running",
      statusLabel: "read",
      pendingTools: [{ id: "tool-1", status: "running" }],
    })
  })

  test("assistant final websocket patch ends the run and finalizes tools in their original message", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [
        { messageId: "u1", role: "user", text: "fix it" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "exec", status: "running" }] },
      ],
      cursor: 1,
      status: "tool_running",
      statusLabel: "exec",
      pendingTools: [{ id: "tool-1", tool: "exec", status: "running" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          projectionVersion: 3,
          semanticType: "chat.assistant.final",
          runStatus: "done",
          status: "done",
          statusLabel: null,
          messageId: "a-final",
          message: { role: "assistant", text: "Fixed." },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({ status: "done", statusLabel: null, pendingTools: [] })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        role: "assistant",
        text: "",
        toolCalls: [expect.objectContaining({ id: "tool-1", tool: "exec", status: "success" })],
      }),
      expect.objectContaining({
        messageId: "a-final",
        role: "assistant",
        text: "Fixed.",
        toolCalls: undefined,
      }),
    ]))
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
      expect.objectContaining({ messageId: "a1", role: "assistant", text: "final answer" }),
      expect.objectContaining({ role: "assistant", text: "", toolCalls: [expect.objectContaining({ id: "late-tool", tool: "read", status: "success" })] }),
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

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({
      status: "idle",
      pendingTools: [],
      spawnedSubagents: [{ toolCallId: "spawn-stale", status: "failed" }],
    })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        toolCalls: expect.arrayContaining([
          expect.objectContaining({ id: "tool-stale", status: "error" }),
          expect.objectContaining({ id: "spawn-stale", status: "error" }),
        ]),
      }),
    ]))
  })

  test("starts a fresh active timer after stale reset before a new send", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u-old", role: "user", text: "old" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    vi.setSystemTime(400_000)
    sweepStaleGlobalChatSessions(400_000, 300_000)
    expect(getGlobalChatSession("s1")).toMatchObject({ status: "idle", activityStartedAtMs: 0 })

    vi.setSystemTime(410_000)
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u-new", role: "user", text: "new question" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking", activityStartedAtMs: 410_000 })
    sweepStaleGlobalChatSessions(420_000, 300_000)
    expect(getGlobalChatSession("s1")).toMatchObject({ status: "thinking" })
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

  test("applies stale matching tool result patches after a newer bootstrap cursor", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 100,
      messages: [
        { messageId: "u1", role: "user", text: "run tool" },
        { messageId: "a-tools", role: "assistant", text: "", toolCalls: [{ id: "tool-1", tool: "exec", status: "running" }] },
      ],
      status: "tool_running",
      statusLabel: "exec",
      pendingTools: [{ id: "tool-1", tool: "exec", status: "running" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 50,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 50,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "done",
          statusLabel: null,
          toolCall: { toolCallId: "tool-1", name: "exec", status: "success", resultMeta: "ok" },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({ cursor: 100, status: "done", statusLabel: null, pendingTools: [] })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a-tools",
        toolCalls: [expect.objectContaining({ id: "tool-1", status: "success", resultText: "ok" })],
      }),
    ]))
  })

  test("does not resurrect a completed chat when late terminal tool results carry active runStatus", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "run" },
        { messageId: "a1", role: "assistant", text: "Done answer" },
      ],
      pendingTools: [],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: 11,
        payload: {
          semanticType: "chat.tool.result",
          runStatus: "tool_running",
          statusLabel: "exec",
          toolCall: { toolCallId: "late-tool", name: "exec", status: "success", phase: "result", resultMeta: "late ok" },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state).toMatchObject({ status: "done", statusLabel: null, pendingTools: [] })
    expect(state?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "a1",
        text: "Done answer",
        toolCalls: [expect.objectContaining({ id: "late-tool", status: "success", resultText: "late ok" })],
      }),
    ]))
  })

  test("does not merge a new assistant response into a previous gateway-indexed answer", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "first", gatewayIndex: 1 },
        { messageId: "a1", role: "assistant", text: "Done", gatewayIndex: 2 },
        { messageId: "u2", role: "user", text: "second", gatewayIndex: 3 },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 11,
        payload: {
          messageSeq: 4,
          messageId: "a2",
          message: { role: "assistant", text: "Done with the second request" },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.messages.map((message) => message.messageId)).toEqual(["u1", "a1", "u2", "a2"])
    expect(state?.messages).toMatchObject([
      { messageId: "u1", text: "first" },
      { messageId: "a1", text: "Done" },
      { messageId: "u2", text: "second" },
      { messageId: "a2", text: "Done with the second request" },
    ])
  })

  test("marks linked subagent idle bootstrap as completed instead of working", () => {
    seedGlobalChatSession({
      sessionKey: "parent",
      cursor: 10,
      status: "done",
      messages: [{ messageId: "a1", role: "assistant", text: "done" }],
      spawnedSubagents: [{
        id: "spawn:tool-1",
        label: "research",
        status: "working",
        toolCallId: "tool-1",
        sessionKey: "child",
      }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.bootstrap",
        sessionKey: "child",
        createdAtMs: 11,
        payload: { runStatus: "idle", status: null, activeRun: null },
      },
    })

    expect(getGlobalChatSession("parent")?.spawnedSubagents).toEqual([
      expect.objectContaining({ toolCallId: "tool-1", status: "completed" }),
    ])
  })

  test("clears streaming loader when final assistant text arrives without a separate done status", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "streaming",
      statusLabel: "Responding",
      messages: [{ messageId: "u1", role: "user", text: "how are you" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 11,
        payload: {
          semanticType: "chat.assistant.final",
          messageId: "a1",
          message: { role: "assistant", text: "Doing well — steady and ready." },
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "done",
      statusLabel: null,
      messages: [
        { messageId: "u1", text: "how are you" },
        { messageId: "a1", text: "Doing well — steady and ready." },
      ],
    })
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
