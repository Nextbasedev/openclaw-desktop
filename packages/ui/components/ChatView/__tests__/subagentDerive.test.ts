import { describe, expect, test } from "vitest"
import {
  abortSessionKeysForActiveRun,
  applySubagentStatusOverrides,
  buildSubagentAnchorMaps,
  deriveSpawnedSubagents,
  indexSpawnsByToolCallId,
  mergeAuthoritativeSubagents,
} from "../subagentDerive"
import type { ChatMessage, InlineToolCall } from "../types"

function mkTool(
  partial: Partial<InlineToolCall> & { id: string; tool: string },
): InlineToolCall {
  return {
    status: "running",
    ...partial,
  } as InlineToolCall
}

function mkMessage(
  partial: Partial<ChatMessage> & { messageId: string; role: ChatMessage["role"] },
): ChatMessage {
  return {
    text: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as ChatMessage
}

// A realistic subagent session key format
const CHILD_SESSION_KEY = "agent:main:subagent:11111111-2222-3333-4444-555555555555"

describe("deriveSpawnedSubagents", () => {
  test("returns empty when no tool calls", () => {
    const messages: ChatMessage[] = [
      mkMessage({ messageId: "u1", role: "user", text: "hi" }),
    ]
    expect(deriveSpawnedSubagents(messages)).toEqual([])
  })

  test("ignores non-sessions_spawn tool calls", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [mkTool({ id: "t1", tool: "bash", status: "success" })],
      }),
    ]
    expect(deriveSpawnedSubagents(messages)).toEqual([])
  })

  test("derives a spawning subagent from a running sessions_spawn", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { task: "do thing", label: "Worker A" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    expect(spawns).toHaveLength(1)
    expect(spawns[0]).toMatchObject({
      id: "spawn:tc-1",
      label: "Worker A",
      task: "do thing",
      sessionKey: null,
      status: "spawning",
      toolCallId: "tc-1",
    })
  })

  test("upgrades to 'working' when child sessionKey is in tool input", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { task: "x", label: "W", sessionKey: CHILD_SESSION_KEY },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    expect(spawns[0].sessionKey).toBe(CHILD_SESSION_KEY)
    expect(spawns[0].status).toBe("working")
  })

  test("extracts sessionKey from resultText when input is empty", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { task: "x", label: "W" },
            resultText: `Started ${CHILD_SESSION_KEY}`,
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    expect(spawns[0].sessionKey).toBe(CHILD_SESSION_KEY)
  })

  test("keeps linked child working when spawn succeeds without terminal marker", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "success",
            input: { task: "x", label: "W", sessionKey: CHILD_SESSION_KEY },
          }),
        ],
      }),
    ]
    expect(deriveSpawnedSubagents(messages)[0].status).toBe("working")
  })

  test("marks linked child completed on explicit terminal marker", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "success",
            input: { task: "x", label: "W", sessionKey: CHILD_SESSION_KEY },
            resultText: `Task completed successfully for ${CHILD_SESSION_KEY}`,
          }),
        ],
      }),
    ]
    expect(deriveSpawnedSubagents(messages)[0].status).toBe("completed")
  })

  test("marks failed on error", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "error",
            input: { task: "x", label: "W" },
          }),
        ],
      }),
    ]
    expect(deriveSpawnedSubagents(messages)[0].status).toBe("failed")
  })

  test("falls back to a numbered label when no task or explicit label", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({ id: "tc-1", tool: "sessions_spawn", status: "running" }),
        ],
      }),
    ]
    expect(deriveSpawnedSubagents(messages)[0].label).toMatch(/Sub-agent/)
  })

  test("dedupes spawns with the same linked sessionKey across messages", () => {
    // Same child session referenced twice (e.g., spawn + final patch); store
    // dedupe keeps the most-progressed status.
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { sessionKey: CHILD_SESSION_KEY, label: "Worker" },
          }),
        ],
      }),
      mkMessage({
        messageId: "a2",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "success",
            input: { sessionKey: CHILD_SESSION_KEY, label: "Worker" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    expect(spawns).toHaveLength(1)
    expect(spawns[0].status).toBe("working")
  })

  test("applies linked child session terminal status over parent spawn status", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "success",
            input: { task: "x", label: "W", sessionKey: CHILD_SESSION_KEY },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    expect(spawns[0].status).toBe("working")

    const reconciled = applySubagentStatusOverrides(
      spawns,
      new Map([[CHILD_SESSION_KEY, "completed"]]),
    )

    expect(reconciled[0].status).toBe("completed")
  })

  test("prefers websocket/global subagent status over local parent derivation", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "success",
            input: { task: "x", label: "W", sessionKey: CHILD_SESSION_KEY },
          }),
        ],
      }),
    ]
    const derived = deriveSpawnedSubagents(messages)

    const merged = mergeAuthoritativeSubagents(derived, [{
      ...derived[0],
      status: "completed",
    }])

    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe("completed")
  })

  test("keeps terminal websocket status when stale derived status is also present", () => {
    const stale = {
      id: "spawn:tc-1",
      label: "W",
      task: "x",
      sessionKey: CHILD_SESSION_KEY,
      status: "working" as const,
      toolCallId: "tc-1",
    }
    const terminal = {
      ...stale,
      status: "completed" as const,
    }

    expect(mergeAuthoritativeSubagents([stale], [terminal])[0].status).toBe("completed")
    expect(mergeAuthoritativeSubagents([terminal], [stale])[0].status).toBe("completed")
  })
})

describe("buildSubagentAnchorMaps", () => {
  test("anchors spawn to the assistant message that hosted it", () => {
    const messages: ChatMessage[] = [
      mkMessage({ messageId: "u1", role: "user", text: "hi" }),
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "W", task: "t" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    const index = indexSpawnsByToolCallId(spawns)
    const { orphanByAssistantId } = buildSubagentAnchorMaps(messages, index)
    expect(orphanByAssistantId.get("a1")).toHaveLength(1)
  })

  test("anchors spawn to the assistant message when no preceding user message", () => {
    const messages: ChatMessage[] = [
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "W", task: "t" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    const index = indexSpawnsByToolCallId(spawns)
    const { orphanByAssistantId } = buildSubagentAnchorMaps(messages, index)
    expect(orphanByAssistantId.get("a1")).toHaveLength(1)
  })

  test("groups multiple spawns under their hosting assistant messages", () => {
    const messages: ChatMessage[] = [
      mkMessage({ messageId: "u1", role: "user", text: "hi" }),
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "Worker A", task: "a" },
          }),
          mkTool({
            id: "tc-2",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "Worker B", task: "b" },
          }),
        ],
      }),
      mkMessage({
        messageId: "a2",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-3",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "Worker C", task: "c" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    const index = indexSpawnsByToolCallId(spawns)
    const { orphanByAssistantId } = buildSubagentAnchorMaps(messages, index)
    expect(orphanByAssistantId.get("a1")).toHaveLength(2)
    expect(orphanByAssistantId.get("a2")).toHaveLength(1)
  })

  test("separates spawns by their hosting assistant messages across turns", () => {
    const messages: ChatMessage[] = [
      mkMessage({ messageId: "u1", role: "user", text: "first" }),
      mkMessage({
        messageId: "a1",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-1",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "First", task: "first task" },
          }),
        ],
      }),
      mkMessage({ messageId: "u2", role: "user", text: "second" }),
      mkMessage({
        messageId: "a2",
        role: "assistant",
        toolCalls: [
          mkTool({
            id: "tc-2",
            tool: "sessions_spawn",
            status: "running",
            input: { label: "Second", task: "second task" },
          }),
        ],
      }),
    ]
    const spawns = deriveSpawnedSubagents(messages)
    const index = indexSpawnsByToolCallId(spawns)
    const { orphanByAssistantId } = buildSubagentAnchorMaps(messages, index)
    expect(orphanByAssistantId.get("a1")).toHaveLength(1)
    expect(orphanByAssistantId.get("a2")).toHaveLength(1)
  })
})

describe("abortSessionKeysForActiveRun", () => {
  test("includes parent and active linked subagent sessions", () => {
    expect(abortSessionKeysForActiveRun("parent", [
      {
        id: "spawn:1",
        label: "Worker 1",
        status: "working",
        toolCallId: "tc-1",
        sessionKey: "agent:main:subagent:child-1",
      },
      {
        id: "spawn:2",
        label: "Worker 2",
        status: "completed",
        toolCallId: "tc-2",
        sessionKey: "agent:main:subagent:child-2",
      },
      {
        id: "spawn:3",
        label: "Worker 3",
        status: "linking",
        toolCallId: "tc-3",
        sessionKey: "agent:main:subagent:child-3",
      },
    ])).toEqual([
      "parent",
      "agent:main:subagent:child-1",
      "agent:main:subagent:child-3",
    ])
  })
})
