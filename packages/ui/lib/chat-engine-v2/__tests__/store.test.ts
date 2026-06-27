import { describe, expect, test, vi, afterEach } from "vitest"
import { createOpenClawQueryClient, queryKeys } from "../../query"
import {
  clearGlobalChatEngineForTests,
  ensureGlobalChatEngine,
  getGlobalChatSession,
  getGlobalCursorForTests,
  ingestGlobalChatFrameForTests,
  ingestGlobalChatPatchForTests,
  seedGlobalChatSession,
  subscribeGlobalChatSession,
  sweepStaleGlobalChatSessions,
  trimSessionMessageWindow,
} from "../store"

vi.mock("../client", () => ({
  openPatchStreamV2: vi.fn(() => () => undefined),
}))

const _lsStore = new Map<string, string>()
const _lsMock = {
  getItem: (key: string) => _lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => { _lsStore.set(key, value) },
  removeItem: (key: string) => { _lsStore.delete(key) },
  clear: () => { _lsStore.clear() },
  get length() { return _lsStore.size },
  key: (i: number) => [..._lsStore.keys()][i] ?? null,
}
if (typeof globalThis.localStorage === "undefined") {
  vi.stubGlobal("localStorage", _lsMock)
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  clearGlobalChatEngineForTests()
  _lsStore.clear()
})

function stubLocalStorage(data: Record<string, string> = {}) {
  _lsStore.clear()
  for (const [k, v] of Object.entries(data)) _lsStore.set(k, v)
}

describe("global V2 chat engine store", () => {
  test("seed merge preserves optimistic image preview when canonical row has metadata only", () => {
    seedGlobalChatSession({
      sessionKey: "s-image",
      cursor: 1,
      status: "thinking",
      messages: [
        {
          messageId: "client-1",
          role: "user",
          text: "look",
          isOptimistic: true,
          sendStatus: "sending",
          attachments: [{ name: "screenshot.png", mimeType: "image/png", content: "abc123", size: 10 }],
        },
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s-image",
      cursor: 2,
      status: "running",
      messages: [
        {
          messageId: "gateway-1",
          role: "user",
          text: "look",
          attachments: [{ name: "media-1", mimeType: "image/png", size: 10 }],
          __openclaw: { clientMessageId: "client-1", id: "gateway-1" },
        } as any,
      ],
    })

    expect(getGlobalChatSession("s-image")?.messages).toHaveLength(1)
    expect(getGlobalChatSession("s-image")?.messages[0].attachments).toEqual([
      { name: "screenshot.png", mimeType: "image/png", content: "abc123", size: 10 },
    ])
  })

  test("bootstrap prune metadata triggers scoped bootstrap recovery", () => {
    const target = new EventTarget()
    const recoveryEvents: Array<{ sessionKey?: string; reason?: string; cursor?: number }> = []
    vi.stubGlobal("window", {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    })
    window.addEventListener("openclaw:chat-bootstrap-recovery", (event) => {
      recoveryEvents.push((event as CustomEvent).detail)
    })

    seedGlobalChatSession({
      sessionKey: "s-pruned",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "hii", gatewayIndex: 1 },
        { messageId: "stale-u", role: "user", text: "hii", gatewayIndex: 3 },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.bootstrap",
        sessionKey: "s-pruned",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s-pruned", messageCount: 1, fullMessagesIncluded: false, pruned: 1 },
      },
    })

    expect(recoveryEvents).toEqual([{ sessionKey: "s-pruned", reason: "bootstrap-pruned", cursor: 11 }])
  })

  test("hello latestCursor below global cursor resets the stale epoch and re-persists", () => {
    // Simulate a stale persisted global cursor (client survived a backend
    // redeploy/projection rebuild on the same URL).
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: { cursor: 1000, type: "chat.history", sessionKey: "s1", createdAtMs: Date.now(), payload: { sessionKey: "s1" } },
    })
    expect(getGlobalCursorForTests()).toBe(1000)

    // Server reconnects from a fresh, lower epoch (latestCursor 5).
    ingestGlobalChatFrameForTests({
      type: "hello",
      clientId: "c1",
      afterCursor: 1000,
      replayCount: 0,
      replayHasMore: false,
      latestCursor: 5,
    })

    expect(getGlobalCursorForTests()).toBe(5)
    expect(_lsStore.get("openclaw:patchCursor:default")).toBe("5")
  })

  test("hello latestCursor at or above global cursor does NOT lower it (normal epoch)", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: { cursor: 1000, type: "chat.history", sessionKey: "s1", createdAtMs: Date.now(), payload: { sessionKey: "s1" } },
    })
    ingestGlobalChatFrameForTests({
      type: "hello",
      clientId: "c1",
      afterCursor: 1000,
      replayCount: 0,
      replayHasMore: false,
      latestCursor: 1000,
    })
    expect(getGlobalCursorForTests()).toBe(1000)
  })

  test("hello without latestCursor (older server) leaves cursor untouched", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: { cursor: 1000, type: "chat.history", sessionKey: "s1", createdAtMs: Date.now(), payload: { sessionKey: "s1" } },
    })
    ingestGlobalChatFrameForTests({
      type: "hello",
      clientId: "c1",
      afterCursor: 1000,
      replayCount: 0,
      replayHasMore: false,
    })
    expect(getGlobalCursorForTests()).toBe(1000)
  })

  test("focused window stream does not rewind below persisted global cursor", async () => {
    stubLocalStorage({ "openclaw:patchCursor:default": "1000" })
    seedGlobalChatSession({
      sessionKey: "focused-session",
      cursor: 900,
      status: "thinking",
      messages: [{ messageId: "u1", role: "user", text: "work" }],
    })

    ensureGlobalChatEngine(undefined, {
      sessionKey: "focused-session",
      replayFromCursor: 900,
      reason: "test-focused-window",
    })

    const { openPatchStreamV2 } = await import("../client")
    expect(vi.mocked(openPatchStreamV2)).toHaveBeenCalledWith(1000, expect.any(Function))
  })

  test("focused replay cursor cannot lower when another session has newer local state", async () => {
    stubLocalStorage({ "openclaw:patchCursor:default": "1000" })
    seedGlobalChatSession({
      sessionKey: "other-session",
      cursor: 980,
      status: "thinking",
      messages: [{ messageId: "u1", role: "user", text: "newer local" }],
    })

    ensureGlobalChatEngine(undefined, {
      sessionKey: "focused-session",
      replayFromCursor: 900,
      reason: "test-focused-window",
    })

    const { openPatchStreamV2 } = await import("../client")
    expect(vi.mocked(openPatchStreamV2)).toHaveBeenCalledWith(1000, expect.any(Function))
  })

  test("metadata-only bootstrap replay is not authoritative empty history", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 945,
        type: "chat.bootstrap",
        sessionKey: "s-empty-replay",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s-empty-replay",
          messageCount: 0,
          lastSeq: 0,
          historyCoverage: "metadata",
          fullMessagesIncluded: false,
        },
      },
    })

    const state = getGlobalChatSession("s-empty-replay")!
    expect(state.cursor).toBe(945)
    expect(state.messages).toEqual([])
    expect(state.messageCount).toBe(0)
    expect(state.historyCoverage).toBe("metadata")
  })

  test("full bootstrap seed hydrates messages after metadata-only empty replay", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 945,
        type: "chat.bootstrap",
        sessionKey: "s-hydrate",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s-hydrate", messageCount: 0, fullMessagesIncluded: false },
      },
    })

    seedGlobalChatSession({
      sessionKey: "s-hydrate",
      cursor: 944,
      historyCoverage: "full",
      messageCount: 2,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "question" },
        { messageId: "a1", role: "assistant", text: "answer" },
      ],
    })

    const state = getGlobalChatSession("s-hydrate")!
    expect(state.cursor).toBe(945)
    expect(state.historyCoverage).toBe("full")
    expect(state.messageCount).toBe(2)
    expect(state.messages).toEqual([
      expect.objectContaining({ messageId: "u1", text: "question" }),
      expect.objectContaining({ messageId: "a1", text: "answer" }),
    ])
  })

  test("full empty bootstrap seed is authoritative empty history", () => {
    seedGlobalChatSession({
      sessionKey: "s-full-empty",
      cursor: 20,
      historyCoverage: "full",
      messageCount: 0,
      status: "idle",
      messages: [],
    })

    const state = getGlobalChatSession("s-full-empty")!
    expect(state.cursor).toBe(20)
    expect(state.messages).toEqual([])
    expect(state.messageCount).toBe(0)
    expect(state.historyCoverage).toBe("full")
  })

  test("late full bootstrap seed does not remove optimistic rows or reorder local messages", () => {
    seedGlobalChatSession({
      sessionKey: "s-late-seed",
      cursor: 200,
      historyCoverage: "full",
      messageCount: 3,
      status: "thinking",
      messages: [
        { messageId: "msg-1", role: "user", text: "old question", gatewayIndex: 1 },
        { messageId: "run-1", role: "assistant", text: "old answer", gatewayIndex: 2, runId: "run-1" },
        {
          messageId: "client:local-1",
          role: "user",
          text: "new local question",
          isOptimistic: true,
          sendStatus: "sending",
          __clientOptimistic: true,
          __openclaw: { id: "client:local-1", clientMessageId: "local-1", cursor: 200 },
        } as any,
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s-late-seed",
      cursor: 150,
      historyCoverage: "full",
      messageCount: 2,
      status: "done",
      messages: [
        { messageId: "msg-1", role: "user", text: "old question", gatewayIndex: 1 },
        { messageId: "run-1", role: "assistant", text: "old answer", gatewayIndex: 2, runId: "run-1" },
      ],
    })

    const state = getGlobalChatSession("s-late-seed")!
    expect(state.cursor).toBe(200)
    expect(state.messages.map((message) => message.messageId)).toEqual(["msg-1", "run-1", "client:local-1"])
    expect(state.messages[2]).toMatchObject({ text: "new local question", isOptimistic: true, sendStatus: "sending" })
  })

  test("bootstrap seed reconciles optimistic rows to confirmed rows under the same client key", () => {
    seedGlobalChatSession({
      sessionKey: "s-confirm-seed",
      cursor: 100,
      historyCoverage: "full",
      status: "thinking",
      messages: [
        {
          messageId: "client:turn-1",
          role: "user",
          text: "same turn",
          isOptimistic: true,
          sendStatus: "sending",
          __clientOptimistic: true,
          __openclaw: { id: "client:turn-1", clientMessageId: "turn-1", cursor: 100 },
        } as any,
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s-confirm-seed",
      cursor: 105,
      historyCoverage: "full",
      status: "done",
      messages: [
        {
          messageId: "gateway-turn-1",
          role: "user",
          text: "same turn",
          gatewayIndex: 1,
          isOptimistic: false,
          __clientOptimistic: false,
          __openclaw: { id: "gateway-turn-1", clientMessageId: "turn-1", cursor: 105 },
        } as any,
      ],
    })

    const state = getGlobalChatSession("s-confirm-seed")!
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ messageId: "gateway-turn-1", text: "same turn", gatewayIndex: 1, isOptimistic: false })
    expect(state.messages[0].sendStatus).toBeUndefined()
  })

  test("normal first bootstrap seed still populates the session fully", () => {
    seedGlobalChatSession({
      sessionKey: "s-first-seed",
      cursor: 10,
      historyCoverage: "full",
      messageCount: 2,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "hello", gatewayIndex: 1 },
        { messageId: "a1", role: "assistant", text: "hi", gatewayIndex: 2, runId: "run-a" },
      ],
    })

    const state = getGlobalChatSession("s-first-seed")!
    expect(state.cursor).toBe(10)
    expect(state.historyCoverage).toBe("full")
    expect(state.messageCount).toBe(2)
    expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual(["user:hello", "assistant:hi"])
  })

  test("paginated older history seed preserves partial coverage and survives later non-message patches", () => {
    const seen: number[] = []
    seedGlobalChatSession({
      sessionKey: "s-paginated",
      cursor: 100,
      historyCoverage: "metadata",
      messageCount: 50,
      status: "done",
      messages: [
        { messageId: "u45", role: "user", text: "recent question", gatewayIndex: 45 },
        { messageId: "a46", role: "assistant", text: "recent answer", gatewayIndex: 46 },
      ],
    })
    const unsubscribe = subscribeGlobalChatSession("s-paginated", (state) => {
      seen.push(state.messages.length)
    })

    seedGlobalChatSession({
      sessionKey: "s-paginated",
      cursor: 100,
      historyCoverage: "metadata",
      messageCount: 50,
      status: "done",
      messages: [
        { messageId: "u43", role: "user", text: "older question", gatewayIndex: 43 },
        { messageId: "a44", role: "assistant", text: "older answer", gatewayIndex: 44 },
        { messageId: "u45", role: "user", text: "recent question", gatewayIndex: 45 },
        { messageId: "a46", role: "assistant", text: "recent answer", gatewayIndex: 46 },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 101,
        type: "chat.tool.update",
        sessionKey: "s-paginated",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s-paginated", messageCount: 2 },
      },
    })

    const state = getGlobalChatSession("s-paginated")!
    expect(state.messages.map((message) => message.messageId)).toEqual(["u43", "a44", "u45", "a46"])
    expect(state.messageCount).toBe(50)
    expect(state.historyCoverage).toBe("metadata")
    expect(seen.at(-1)).toBe(4)
    unsubscribe()
  })

  test("metadata-only bootstrap replay does not downgrade full history", () => {
    seedGlobalChatSession({
      sessionKey: "s-no-downgrade",
      cursor: 10,
      historyCoverage: "full",
      messageCount: 2,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "question" },
        { messageId: "a1", role: "assistant", text: "answer" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.bootstrap",
        sessionKey: "s-no-downgrade",
        createdAtMs: Date.now(),
        payload: { sessionKey: "s-no-downgrade", messageCount: 0, fullMessagesIncluded: false },
      },
    })

    const state = getGlobalChatSession("s-no-downgrade")!
    expect(state.cursor).toBe(11)
    expect(state.historyCoverage).toBe("full")
    expect(state.messageCount).toBe(2)
    expect(state.messages).toHaveLength(2)
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

  test("session cursor reset bootstrap preserves previous transcript messages without reordering", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 42,
      status: "done",
      messages: [
        { messageId: "u-old", role: "user", text: "old question" },
        { messageId: "a-old", role: "assistant", text: "old answer" },
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 0,
      status: "thinking",
      messages: [
        { messageId: "u-new", role: "user", text: "new question after reset" },
      ],
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      cursor: 42,
      status: "done",
      messages: [
        { messageId: "u-old", text: "old question" },
        { messageId: "a-old", text: "old answer" },
        { messageId: "u-new", text: "new question after reset" },
      ],
    })
  })

  test("same-cursor stale bootstrap cannot wipe live messages and tools", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tool-live", tool: "exec", status: "running", startedAt: 1_000 }],
      messages: [
        { messageId: "u1", role: "user", text: "question" },
        { messageId: "a-live", role: "assistant", text: "partial live answer" },
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "question" },
      ],
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tool-live", status: "running" }],
      messages: expect.arrayContaining([
        expect.objectContaining({ messageId: "a-live", text: "partial live answer" }),
      ]),
    })
  })

  test("partial same-cursor bootstrap cannot temporarily hide the latest local user turn", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 20,
      status: "done",
      historyCoverage: "metadata",
      messageCount: 50,
      messages: [
        { messageId: "u-prev", role: "user", text: "previous" },
        { messageId: "a-prev", role: "assistant", text: "previous answer" },
        { messageId: "u-latest", role: "user", text: "hii" },
        { messageId: "a-latest", role: "assistant", text: "hello" },
      ],
    })

    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 20,
      status: "done",
      historyCoverage: "metadata",
      messageCount: 50,
      messages: [
        { messageId: "u-prev", role: "user", text: "previous" },
        { messageId: "a-prev", role: "assistant", text: "previous answer" },
      ],
    })

    expect(getGlobalChatSession("s1")!.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "u-latest", text: "hii" }),
      expect.objectContaining({ messageId: "a-latest", text: "hello" }),
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

  test("terminal windowed bootstrap clears stale active status while preserving newer local messages", () => {
    seedGlobalChatSession({
      sessionKey: "imported-chat",
      cursor: 42,
      status: "thinking",
      statusLabel: "Thinking",
      messages: [
        { messageId: "old", role: "user", text: "older imported text" },
        { messageId: "marker", role: "user", text: "WEBWRIGHT_IMPORTED_LONG newest marker" },
      ],
      pendingTools: [{ id: "stale-tool", tool: "exec", status: "running" }],
      messageCount: 539,
      historyCoverage: "windowed",
    })

    seedGlobalChatSession({
      sessionKey: "imported-chat",
      cursor: 42,
      status: "done",
      statusLabel: null,
      messages: [{ messageId: "old", role: "user", text: "older imported text" }],
      pendingTools: [],
      messageCount: 539,
      historyCoverage: "windowed",
    })

    const state = getGlobalChatSession("imported-chat")
    expect(state).toMatchObject({ status: "done", statusLabel: null, pendingTools: [] })
    expect(state?.messages.some((message) => message.text?.includes("WEBWRIGHT_IMPORTED_LONG"))).toBe(true)
  })

  test("older terminal bootstrap does not clear genuinely newer live activity", () => {
    seedGlobalChatSession({
      sessionKey: "live-chat",
      cursor: 50,
      status: "thinking",
      statusLabel: "Thinking",
      messages: [{ messageId: "live", role: "user", text: "new live turn" }],
      pendingTools: [{ id: "live-tool", tool: "exec", status: "running" }],
    })

    seedGlobalChatSession({
      sessionKey: "live-chat",
      cursor: 40,
      status: "done",
      statusLabel: null,
      messages: [{ messageId: "old", role: "assistant", text: "older canonical answer" }],
      pendingTools: [],
      historyCoverage: "windowed",
    })

    const state = getGlobalChatSession("live-chat")
    expect(state).toMatchObject({ status: "thinking", statusLabel: "Thinking" })
    expect(state?.pendingTools).toMatchObject([{ id: "live-tool", status: "running" }])
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

  test("dedupes live tool-call message blocks by stable toolCallId instead of event id", () => {
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
          activeRun: { status: "tool_running" },
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "event-start-1", toolCallId: "tc-stable", name: "exec", input: { command: "echo hi" } }],
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
        createdAtMs: 1_100,
        payload: {
          sessionKey: "s1",
          runStatus: "tool_running",
          activeRun: { status: "tool_running" },
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "event-update-2", toolCallId: "tc-stable", name: "exec", input: { command: "echo hi" } }],
          },
        },
      },
    })

    const toolsInMessages = getGlobalChatSession("s1")?.messages.flatMap((message) => message.toolCalls ?? []) ?? []
    expect(toolsInMessages).toHaveLength(1)
    expect(toolsInMessages[0]).toMatchObject({ id: "tc-stable", tool: "exec", status: "running" })
    expect(getGlobalChatSession("s1")?.pendingTools).toMatchObject([
      { id: "tc-stable", tool: "exec", status: "running" },
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

    const state = getGlobalChatSession("s1")
    // With the duplicate-tool-card fix, completed tools are removed from
    // pendingTools once written to message history. Verify the tool is
    // correctly stored in the assistant message's toolCalls instead.
    const assistantMsg = state?.messages.find((m) => m.role === "assistant")
    const toolInMessage = assistantMsg?.toolCalls?.find((t) => t.id === "tc-approval")
    expect(toolInMessage).toMatchObject({
      id: "tc-approval",
      status: "success",
      approval: { id: "approval-456", slug: "exec-123", command: "touch /tmp/x", allowedDecisions: ["allow-once", "deny"] },
    })
    // Should no longer be in pendingTools since it was written to the message
    expect(state?.pendingTools.find((t) => t.id === "tc-approval")).toBeUndefined()
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
      expect.objectContaining({ role: "assistant", text: "Done — I checked the files.", toolCalls: [expect.objectContaining({ id: "tc-stale", tool: "exec", status: "success" })] }),
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

  test("status error patches preserve live error labels", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [{ messageId: "u1", role: "user", text: "hello" }],
      status: "thinking",
      statusLabel: "Thinking",
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.run.error",
          runStatus: "error",
          statusLabel: "credit exhausted",
        },
      },
    })

    expect(getGlobalChatSession("s1")).toMatchObject({
      status: "error",
      statusLabel: "credit exhausted",
    })
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

  test("premature bare done after partial assistant text does not blink the turn complete", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    seedGlobalChatSession({
      sessionKey: "s-premature-done",
      cursor: 0,
      status: "streaming",
      statusLabel: "Streaming",
      messages: [{ messageId: "user-1", role: "user", text: "long real work prompt" }],
    })

    vi.setSystemTime(2_000)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s-premature-done",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.assistant.delta",
          runStatus: "streaming",
          statusLabel: "Streaming",
          message: { role: "assistant", text: "partial answer", __openclaw: { id: "assistant-1" } },
        },
      },
    })

    vi.setSystemTime(2_500)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.status",
        sessionKey: "s-premature-done",
        createdAtMs: 2_500,
        payload: { semanticType: "chat.run.done", runStatus: "done", statusLabel: null },
      },
    })

    expect(getGlobalChatSession("s-premature-done")).toMatchObject({ status: "streaming", statusLabel: "Streaming" })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.message.upsert",
        sessionKey: "s-premature-done",
        createdAtMs: 3_000,
        payload: {
          semanticType: "chat.assistant.final",
          runStatus: "done",
          statusLabel: null,
          message: { role: "assistant", text: "final answer", __openclaw: { id: "assistant-1" } },
        },
      },
    })

    expect(getGlobalChatSession("s-premature-done")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("terminalWithoutAssistant done completes native slash command turns without assistant text", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    seedGlobalChatSession({
      sessionKey: "s-native-slash-done",
      cursor: 0,
      status: "thinking",
      statusLabel: "Thinking",
      messages: [{ messageId: "user-1", role: "user", text: "/status" }],
    })

    vi.setSystemTime(1_500)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.status",
        sessionKey: "s-native-slash-done",
        createdAtMs: 1_500,
        payload: {
          semanticType: "chat.run.done",
          runStatus: "done",
          statusLabel: null,
          terminalWithoutAssistant: true,
        },
      },
    })

    expect(getGlobalChatSession("s-native-slash-done")).toMatchObject({ status: "done", statusLabel: null })
  })

  test("late same-turn streaming patches after assistant final do not resurrect generating state", () => {
    seedGlobalChatSession({
      sessionKey: "s-post-final",
      cursor: 0,
      status: "streaming",
      statusLabel: "Streaming",
      messages: [{ messageId: "user-1", role: "user", text: "long real work prompt" }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s-post-final",
        createdAtMs: 2_000,
        payload: {
          semanticType: "chat.assistant.final",
          runStatus: "done",
          statusLabel: null,
          message: { role: "assistant", text: "final answer", __openclaw: { id: "assistant-1" } },
        },
      },
    })

    expect(getGlobalChatSession("s-post-final")).toMatchObject({ status: "done", statusLabel: null })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.status",
        sessionKey: "s-post-final",
        createdAtMs: 3_000,
        payload: { semanticType: "chat.run.streaming", runStatus: "streaming", statusLabel: "Streaming" },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 4,
        type: "chat.message.upsert",
        sessionKey: "s-post-final",
        createdAtMs: 4_000,
        payload: {
          semanticType: "chat.assistant.delta",
          runStatus: "streaming",
          statusLabel: "Streaming",
          message: { role: "assistant", text: "final answer with tail", __openclaw: { id: "assistant-1" } },
        },
      },
    })

    const state = getGlobalChatSession("s-post-final")
    expect(state).toMatchObject({ status: "done", statusLabel: null })
    expect(state?.messages.at(-1)).toMatchObject({ role: "assistant", text: "final answer with tail" })
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

  test("keeps distinct linked sessions_spawn children even when labels repeat", () => {
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

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toHaveLength(6)
    expect(getGlobalChatSession("s1")?.spawnedSubagents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ui-automation", sessionKey: "agent:main:subagent:ui-1", status: "working" }),
        expect.objectContaining({ label: "ui-automation", sessionKey: "agent:main:subagent:ui-2", status: "working" }),
        expect.objectContaining({ label: "ui-automation", sessionKey: "agent:main:subagent:ui-3", status: "working" }),
        expect.objectContaining({ label: "agentic-workflow", sessionKey: "agent:main:subagent:flow-1", status: "working" }),
        expect.objectContaining({ label: "agentic-workflow", sessionKey: "agent:main:subagent:flow-2", status: "working" }),
        expect.objectContaining({ label: "agentic-workflow", sessionKey: "agent:main:subagent:flow-3", status: "working" }),
      ]),
    )
  })

  test("same linked child can still complete without collapsing sibling sessions", () => {
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

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ui-automation", status: "working", sessionKey: "agent:main:subagent:ui-1" }),
        expect.objectContaining({ label: "ui-automation", status: "completed", sessionKey: "agent:main:subagent:ui-2" }),
      ]),
    )

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

  test("keeps same explicit label separate after different child sessions are linked", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        { id: "spawn:a", label: "ui-automation", task: "Stand by for UI automation work", status: "working", toolCallId: "a", sessionKey: "agent:main:subagent:a" },
        { id: "spawn:b", label: "ui-automation", task: "Prepare to handle browser/UI automation work", status: "working", toolCallId: "b", sessionKey: "agent:main:subagent:b" },
      ],
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toHaveLength(2)
    expect(getGlobalChatSession("s1")?.spawnedSubagents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ui-automation", status: "working", sessionKey: "agent:main:subagent:a" }),
        expect.objectContaining({ label: "ui-automation", status: "working", sessionKey: "agent:main:subagent:b" }),
      ]),
    )
  })

  test("dedupes repeated pending spawn placeholders before child sessions link", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      messages: [],
      spawnedSubagents: [
        { id: "spawn:a", label: "ui-automation", task: "Stand by for UI automation work", status: "spawning", toolCallId: "a", sessionKey: null },
        { id: "spawn:b", label: "ui-automation", task: "Prepare to handle browser/UI automation work", status: "spawning", toolCallId: "b", sessionKey: null },
      ],
    })

    expect(getGlobalChatSession("s1")?.spawnedSubagents).toHaveLength(1)
    expect(getGlobalChatSession("s1")?.spawnedSubagents).toMatchObject([
      { label: "ui-automation", status: "spawning" },
    ])
  })

  test("keeps sessions_spawn active when result has no child session link", () => {
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
      { toolCallId: "spawn-complete", sessionKey: null, status: "spawning" },
    ])
  })

  test("links spawned subagent from canonical middleware lifecycle patch", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.subagent.spawn_started",
        sessionKey: "parent-1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.subagent.spawn_started",
          sessionKey: "parent-1",
          toolCallId: "spawn-canonical",
          label: "Audit worker",
          task: "Audit",
        },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.subagent.spawn_done",
        sessionKey: "parent-1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.subagent.spawn_done",
          sessionKey: "parent-1",
          toolCallId: "spawn-canonical",
        },
      },
    })
    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-canonical", sessionKey: null, status: "spawning" },
    ])

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.subagent.spawn_linked",
        sessionKey: "parent-1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.subagent.spawn_linked",
          sessionKey: "parent-1",
          toolCallId: "spawn-canonical",
          childSessionKey: "agent:main:desktop:subagent:child-1",
          result: { childSessionKey: "agent:main:desktop:subagent:child-1" },
        },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-canonical", sessionKey: "agent:main:desktop:subagent:child-1", status: "working" },
    ])
  })

  test("does not reactivate a completed subagent from replayed spawn_linked", () => {
    seedGlobalChatSession({
      sessionKey: "parent-1",
      messages: [],
      spawnedSubagents: [{
        id: "spawn:spawn-canonical",
        label: "Audit worker",
        status: "completed",
        toolCallId: "spawn-canonical",
        sessionKey: "agent:main:desktop:subagent:child-1",
      }],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.subagent.spawn_linked",
        sessionKey: "parent-1",
        createdAtMs: Date.now(),
        payload: {
          semanticType: "chat.subagent.spawn_linked",
          sessionKey: "parent-1",
          toolCallId: "spawn-canonical",
          childSessionKey: "agent:main:desktop:subagent:child-1",
        },
      },
    })

    expect(getGlobalChatSession("parent-1")?.spawnedSubagents).toMatchObject([
      { toolCallId: "spawn-canonical", sessionKey: "agent:main:desktop:subagent:child-1", status: "completed" },
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
        messageId: "a-final",
        role: "assistant",
        text: "Fixed.",
        toolCalls: [expect.objectContaining({ id: "tool-1", tool: "exec", status: "success" })],
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

  test("does not notify subscribers for no-op running tool replays after terminal tool is visible", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "done",
      messages: [
        { messageId: "u1", role: "user", text: "run" },
        { messageId: "a1", role: "assistant", text: "Done answer", toolCalls: [{ id: "tool-1", tool: "exec", status: "success", resultText: "ok" }] },
      ],
      pendingTools: [],
    })
    const listener = vi.fn()
    const unsubscribe = subscribeGlobalChatSession("s1", listener)
    listener.mockClear()

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.update",
        sessionKey: "s1",
        createdAtMs: 11,
        payload: {
          semanticType: "chat.tool.update",
          runStatus: "done",
          statusLabel: null,
          toolCall: { toolCallId: "tool-1", name: "exec", status: "running", phase: "update" },
        },
      },
    })

    expect(listener).not.toHaveBeenCalled()
    expect(getGlobalChatSession("s1")?.cursor).toBe(11)
    unsubscribe()
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

  // --- Bug 1: Duplicate tool card prevention ---

  test("completed canonical tool is removed from pendingTools when written to message", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-1", tool: "exec", status: "running", startedAt: Date.now() - 1000 }],
      messages: [
        { messageId: "u1", role: "user", text: "run it" },
        { messageId: "a1", role: "assistant", text: "", toolCalls: [{ id: "tc-1", tool: "exec", status: "running" }] },
      ],
    })

    // Canonical tool result patch
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: { toolCallId: "tc-1", name: "exec", phase: "result", status: "success", startedAtMs: Date.now() - 1000, finishedAtMs: Date.now() },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    // Tool should be removed from pendingTools
    expect(state?.pendingTools.find((t) => t.id === "tc-1")).toBeUndefined()
    // Tool should be updated in message toolCalls
    const assistantMsg = state?.messages.find((m) => m.messageId === "a1")
    expect(assistantMsg?.toolCalls?.find((t) => t.id === "tc-1")?.status).toBe("success")
  })

  test("completed canonical tool stays in pendingTools when no message exists yet", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-orphan", tool: "read", status: "running", startedAt: Date.now() - 500 }],
      messages: [
        { messageId: "u1", role: "user", text: "check this" },
        // No assistant message yet — tool result arrives before message
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.result",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: { toolCallId: "tc-orphan", name: "read", phase: "result", status: "success", startedAtMs: Date.now() - 500, finishedAtMs: Date.now() },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    // Tool should remain in pendingTools since it couldn't be written to a message
    expect(state?.pendingTools.find((t) => t.id === "tc-orphan")).toBeDefined()
    expect(state?.pendingTools.find((t) => t.id === "tc-orphan")?.status).toBe("success")
  })

  test("tool result via applyToolResultById removes completed tool from pendingTools when in message", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-2", tool: "write", status: "running", startedAt: Date.now() - 2000 }],
      messages: [
        { messageId: "u1", role: "user", text: "write file" },
        { messageId: "a1", role: "assistant", text: "", toolCalls: [{ id: "tc-2", tool: "write", status: "running" }] },
      ],
    })

    // Tool result arrives as a tool_result message (not canonical toolCall patch)
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            role: "tool",
            toolCallId: "tc-2",
            content: "File written successfully",
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.pendingTools.find((t) => t.id === "tc-2")).toBeUndefined()
    expect(state?.messages.find((m) => m.messageId === "a1")?.toolCalls?.find((t) => t.id === "tc-2")?.status).toBe("success")
  })

  test("history backfill running tool block cannot resurrect a completed visible tool", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "thinking",
      pendingTools: [],
      messages: [
        { messageId: "u1", role: "user", text: "do tool" },
        { messageId: "a-tool", role: "assistant", text: "", toolCalls: [{ id: "tc-done", tool: "session_status", status: "success", duration: "0.5s", resultText: "ok" }] },
        { messageId: "a-text", role: "assistant", text: "Done" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          semanticType: "chat.assistant.delta",
          runStatus: "tool_running",
          statusLabel: "session_status",
          message: {
            id: "a-backfill-running",
            role: "assistant",
            content: [{ type: "toolCall", id: "tc-done", name: "session_status", input: {} }],
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.pendingTools.find((t) => t.id === "tc-done")).toBeUndefined()
    expect(state?.messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.id === "tc-done")).toMatchObject({
      status: "success",
      duration: "0.5s",
      resultText: "ok",
    })
  })

  test("running tool stays in pendingTools until result arrives", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-run", tool: "exec", status: "running", startedAt: Date.now() }],
      messages: [
        { messageId: "u1", role: "user", text: "go" },
        { messageId: "a1", role: "assistant", text: "", toolCalls: [{ id: "tc-run", tool: "exec", status: "running" }] },
      ],
    })

    // Another tool starts — no result for tc-run yet
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          toolCall: { toolCallId: "tc-new", name: "read", phase: "calling", status: "running", startedAtMs: Date.now() },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.pendingTools.find((t) => t.id === "tc-run")?.status).toBe("running")
    expect(state?.pendingTools.find((t) => t.id === "tc-new")?.status).toBe("running")
  })

  test("live repeated tool-only assistant upserts collapse to one visible tool block with terminal state", () => {
    const now = Date.now()
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 100,
      status: "thinking",
      messages: [
        { messageId: "u1", role: "user", text: "run status", gatewayIndex: 100, runId: "run-1" },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 101,
        type: "chat.tool.started",
        sessionKey: "s1",
        createdAtMs: now,
        payload: {
          sessionKey: "s1",
          semanticType: "chat.tool.started",
          runId: "run-1",
          runStatus: "tool_running",
          toolCallId: "tool-live",
          toolCall: { toolCallId: "tool-live", name: "session_status", phase: "calling", status: "running", startedAtMs: now },
        },
      },
    })

    for (const [cursor, messageId, messageSeq] of [[102, "a-tool-1", 108], [103, "a-tool-2", 110], [104, "a-tool-3", 112]] as const) {
      ingestGlobalChatPatchForTests({
        type: "patch",
        patch: {
          cursor,
          type: "chat.message.upsert",
          sessionKey: "s1",
          createdAtMs: now + cursor,
          payload: {
            sessionKey: "s1",
            semanticType: "chat.message.upsert",
            runId: "run-1",
            messageId,
            messageSeq,
            message: {
              id: messageId,
              role: "assistant",
              content: [{ type: "toolCall", id: "tool-live", name: "session_status", input: {} }],
              createdAt: new Date(now + cursor).toISOString(),
            },
          },
        },
      })
    }

    for (const cursor of [105, 106, 107]) {
      ingestGlobalChatPatchForTests({
        type: "patch",
        patch: {
          cursor,
          type: "chat.tool.result",
          sessionKey: "s1",
          createdAtMs: now + cursor,
          payload: {
            sessionKey: "s1",
            semanticType: "chat.tool.result",
            runId: "run-1",
            runStatus: "tool_running",
            toolCallId: "tool-live",
            toolCall: { toolCallId: "tool-live", name: "session_status", phase: "result", status: "success", startedAtMs: now, finishedAtMs: now + 500, resultMeta: "ok" },
          },
        },
      })
    }

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 108,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: now + 108,
        payload: {
          sessionKey: "s1",
          semanticType: "chat.message.upsert",
          runId: "run-1",
          runStatus: "done",
          messageId: "a-tool-backfill",
          messageSeq: 114,
          message: {
            id: "a-tool-backfill",
            role: "assistant",
            content: [{ type: "toolCall", id: "tool-live", name: "session_status", input: {} }],
            createdAt: new Date(now + 108).toISOString(),
          },
        },
      },
    })

    const state = getGlobalChatSession("s1")
    const toolRows = state?.messages.filter((message) => message.role === "assistant" && message.toolCalls?.some((tool) => tool.id === "tool-live")) ?? []
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]?.toolCalls?.filter((tool) => tool.id === "tool-live")).toHaveLength(1)
    expect(toolRows[0]?.toolCalls?.[0]).toMatchObject({ id: "tool-live", status: "success", resultText: "ok" })
    expect(state?.pendingTools.find((tool) => tool.id === "tool-live")).toBeUndefined()
  })

  test("live adjacent tool-only assistant upserts without runStatus merge into one steps block", () => {
    const now = Date.now()
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 200,
      status: "thinking",
      messages: [
        { messageId: "u1", role: "user", text: "check several things", gatewayIndex: 200, runId: "run-merge" },
      ],
    })

    const toolUpsert = (cursor: number, messageId: string, toolId: string, name: string) => ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: now + cursor,
        payload: {
          sessionKey: "s1",
          semanticType: "chat.message.upsert",
          runId: "run-merge",
          messageId,
          messageSeq: cursor,
          message: {
            id: messageId,
            role: "assistant",
            content: [{ type: "toolCall", id: toolId, name, input: {} }],
            createdAt: new Date(now + cursor).toISOString(),
          },
        },
      },
    })

    toolUpsert(201, "a-tool-read", "tool-read", "read")
    toolUpsert(202, "a-tool-status", "tool-status", "session_status")
    toolUpsert(203, "a-tool-edit", "tool-edit", "edit")

    const state = getGlobalChatSession("s1")
    const toolRows = state?.messages.filter((message) => message.role === "assistant" && message.toolCalls?.length) ?? []
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]?.toolCalls?.map((tool) => tool.id)).toEqual(["tool-read", "tool-status", "tool-edit"])
  })

  test("new user turn clears previous detached running tools and finalizes old visible tool rows", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-old", tool: "exec", status: "running", startedAt: Date.now() - 1000 }],
      messages: [
        { messageId: "u1", role: "user", text: "first" },
        { messageId: "a1", role: "assistant", text: "", toolCalls: [{ id: "tc-old", tool: "exec", status: "running", startedAt: Date.now() - 1000 }] },
      ],
    })

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.user.created",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          message: {
            id: "u2",
            role: "user",
            text: "second",
            createdAt: new Date().toISOString(),
          },
          runStatus: "thinking",
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.pendingTools).toEqual([])
    expect(state?.messages.find((m) => m.messageId === "a1")?.toolCalls?.[0]?.status).toBe("success")
  })

  test("awaitingResult tool stays visible through UI filter", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "tool_running",
      pendingTools: [{ id: "tc-approval", tool: "exec", status: "running", awaitingResult: true, startedAt: Date.now() }],
      messages: [
        { messageId: "u1", role: "user", text: "deploy" },
      ],
    })

    const state = getGlobalChatSession("s1")
    const filtered = state?.pendingTools.filter((t) => t.status === "running" || t.awaitingResult)
    expect(filtered?.find((t) => t.id === "tc-approval")).toBeDefined()
  })

  test("terminal done with leftover completed tools in pendingTools clears them", () => {
    seedGlobalChatSession({
      sessionKey: "s1",
      cursor: 10,
      status: "streaming",
      pendingTools: [
        { id: "tc-done-1", tool: "exec", status: "success", duration: "1.0s" },
        { id: "tc-done-2", tool: "read", status: "success", duration: "0.5s" },
      ],
      messages: [
        { messageId: "u1", role: "user", text: "go" },
        { messageId: "a1", role: "assistant", text: "done" },
      ],
    })

    // Done status arrives
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.status",
        sessionKey: "s1",
        createdAtMs: Date.now(),
        payload: {
          sessionKey: "s1",
          runStatus: "done",
          status: "done",
          statusLabel: null,
        },
      },
    })

    const state = getGlobalChatSession("s1")
    expect(state?.status).toBe("done")
    expect(state?.pendingTools).toEqual([])
  })

  test("rapid identical sends never collapse assistant finals into one merged card", () => {
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 1,
        payload: { semanticType: "chat.user.created", messageId: "client-1", messageSeq: 1, message: { role: "user", text: "hii", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1", seq: 1 } } },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 2,
        payload: { semanticType: "chat.user.created", messageId: "client-2", messageSeq: 3, message: { role: "user", text: "hii", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-2", seq: 3 } } },
      },
    })
    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 3,
        payload: { semanticType: "chat.assistant.final", messageId: "assistant-1", messageSeq: 2, runId: "run-1", message: { role: "assistant", text: "reply1", __openclaw: { id: "assistant-1", seq: 2, runId: "run-1" } } },
      },
    })
    let state = getGlobalChatSession("s1")
    expect(state?.messages.some((message) => message.text === "reply1\n\nreply2")).toBe(false)

    ingestGlobalChatPatchForTests({
      type: "patch",
      patch: {
        cursor: 4,
        type: "chat.message.upsert",
        sessionKey: "s1",
        createdAtMs: 4,
        payload: { semanticType: "chat.assistant.final", messageId: "assistant-2", messageSeq: 4, runId: "run-2", message: { role: "assistant", text: "reply2", __openclaw: { id: "assistant-2", seq: 4, runId: "run-2" } } },
      },
    })

    state = getGlobalChatSession("s1")
    expect(state?.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      "user:hii",
      "assistant:reply1",
      "user:hii",
      "assistant:reply2",
    ])
    expect(state?.messages.filter((message) => message.role === "assistant")).toHaveLength(2)
    expect(state?.messages.some((message) => message.text === "reply1\n\nreply2")).toBe(false)
  })

  describe("trimSessionMessageWindow (Phase 1 fixed-window)", () => {
    function seedRange(sessionKey: string, count: number, opts: { withOptimisticTail?: number } = {}) {
      const messages: any[] = []
      for (let i = 0; i < count; i += 1) {
        messages.push({
          messageId: `m-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          text: `msg-${i}`,
          gatewayIndex: i + 1,
        })
      }
      const optimisticCount = opts.withOptimisticTail ?? 0
      for (let i = 0; i < optimisticCount; i += 1) {
        messages.push({
          messageId: `opt-${i}`,
          role: "user",
          text: `opt-${i}`,
          isOptimistic: true,
          sendStatus: "sending",
        })
      }
      seedGlobalChatSession({ sessionKey, cursor: 1, status: "idle", messages })
    }

    test("drops requested top + bottom counts on plain history", () => {
      seedRange("trim-1", 10)
      const removed = trimSessionMessageWindow("trim-1", { dropFromTop: 2, dropFromBottom: 3 })
      expect(removed).toBe(5)
      const state = getGlobalChatSession("trim-1")
      expect(state?.messages.map((m) => m.text)).toEqual(["msg-2", "msg-3", "msg-4", "msg-5", "msg-6"])
    })

    test("never drops optimistic tail rows even when bottom drop requested", () => {
      seedRange("trim-2", 5, { withOptimisticTail: 2 })
      const removed = trimSessionMessageWindow("trim-2", { dropFromBottom: 3 })
      expect(removed).toBe(0)
      const state = getGlobalChatSession("trim-2")
      expect(state?.messages).toHaveLength(7)
    })

    test("never drops sendStatus rows from the top when drop range reaches them", () => {
      // Synthetic mix: 2 normal rows, then a pending row at index 2.
      const messages: any[] = [
        { messageId: "a", role: "user", text: "a", gatewayIndex: 1 },
        { messageId: "b", role: "assistant", text: "b", gatewayIndex: 2 },
        { messageId: "c", role: "user", text: "c", sendStatus: "pending" },
        { messageId: "d", role: "user", text: "d", gatewayIndex: 3 },
      ]
      seedGlobalChatSession({ sessionKey: "trim-3", cursor: 1, status: "idle", messages })
      const removed = trimSessionMessageWindow("trim-3", { dropFromTop: 3 })
      // Stops at index 2 (pending); only drops 2 normal rows from top.
      expect(removed).toBe(2)
      const state = getGlobalChatSession("trim-3")
      expect(state?.messages.map((m) => m.messageId)).toEqual(["c", "d"])
    })

    test("no-op when both drop counts are zero", () => {
      seedRange("trim-4", 5)
      expect(trimSessionMessageWindow("trim-4", {})).toBe(0)
      expect(trimSessionMessageWindow("trim-4", { dropFromTop: 0, dropFromBottom: 0 })).toBe(0)
      expect(getGlobalChatSession("trim-4")?.messages).toHaveLength(5)
    })

    test("clamps drop count when it exceeds available rows", () => {
      seedRange("trim-5", 3)
      const removed = trimSessionMessageWindow("trim-5", { dropFromTop: 5, dropFromBottom: 5 })
      // dropFromTop runs first → drops 3, leaves 0. Bottom can't drop more.
      expect(removed).toBe(3)
      expect(getGlobalChatSession("trim-5")?.messages).toEqual([])
    })

    test("unknown session returns 0", () => {
      expect(trimSessionMessageWindow("no-such-session", { dropFromTop: 1 })).toBe(0)
    })

    test("notifies subscribers after a trim", () => {
      seedRange("trim-6", 10)
      const seen: number[] = []
      const unsub = subscribeGlobalChatSession("trim-6", (state) => {
        seen.push(state.messages.length)
      })
      // Initial subscribe also delivers current state.
      const baseline = seen.length
      trimSessionMessageWindow("trim-6", { dropFromTop: 4 })
      expect(seen.length).toBeGreaterThan(baseline)
      expect(seen[seen.length - 1]).toBe(6)
      unsub()
    })

    test("negative drop counts are clamped to zero", () => {
      seedRange("trim-7", 5)
      expect(trimSessionMessageWindow("trim-7", { dropFromTop: -3, dropFromBottom: -10 })).toBe(0)
      expect(getGlobalChatSession("trim-7")?.messages).toHaveLength(5)
    })
  })
})
