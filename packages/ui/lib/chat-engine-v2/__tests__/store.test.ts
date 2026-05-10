import { describe, expect, test, vi, afterEach } from "vitest"
import { createOpenClawQueryClient, queryKeys } from "../../query"
import {
  clearGlobalChatEngineForTests,
  getGlobalChatSession,
  ingestGlobalChatPatchForTests,
  seedGlobalChatSession,
  subscribeGlobalChatSession,
} from "../store"

vi.mock("../client", () => ({
  openPatchStreamV2: vi.fn(() => () => undefined),
}))

afterEach(() => clearGlobalChatEngineForTests())

describe("global V2 chat engine store", () => {
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

  test("warms React Query bootstrap cache from global store", () => {
    const client = createOpenClawQueryClient()
    seedGlobalChatSession({
      sessionKey: "s1",
      queryClient: client,
      messages: [{ messageId: "a1", role: "assistant", text: "cached globally" }],
      cursor: 9,
      status: "done",
    })

    const cached = client.getQueryData(queryKeys.chatBootstrap("s1")) as { history: { messages: unknown[] }, v2Cursor: number }
    expect(cached.history.messages).toMatchObject([{ messageId: "a1", text: "cached globally" }])
    expect(cached.v2Cursor).toBe(9)
  })
})
