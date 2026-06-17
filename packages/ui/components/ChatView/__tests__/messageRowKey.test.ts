import { describe, expect, test } from "vitest"
import { messageListKeys, messageRowKey, toolCallKey } from "../messageRowKey"
import type { ChatMessage, InlineToolCall } from "../types"

function assistant(message: Partial<ChatMessage> & { messageId: string }): ChatMessage {
  return {
    role: "assistant",
    text: "",
    ...message,
  } as ChatMessage
}

function user(message: Partial<ChatMessage> & { messageId: string }): ChatMessage {
  return {
    role: "user",
    text: "",
    ...message,
  } as ChatMessage
}

describe("messageRowKey", () => {
  test("uses messageId as the stable key (single source of truth)", () => {
    expect(messageRowKey(user({ messageId: "u1" }))).toBe("u1")
    expect(messageRowKey(assistant({ messageId: "a1" }))).toBe("a1")
  })

  test("does NOT collapse multiple assistant rows sharing the same runId", () => {
    // Regression for the long-conversation duplication bug: previously,
    // any assistant row with a runId returned `assistant-run:${runId}`,
    // which made every row of a single run share the same React key.
    // The fix is to key off messageId, which is unique per logical row.
    const liveTools = assistant({
      messageId: "live:run-1:tools",
      runId: "run-1",
      toolCalls: [{ id: "t1", tool: "read", status: "running" }],
    })
    const liveAssistant = assistant({
      messageId: "live:run-1:assistant",
      runId: "run-1",
      text: "Hello",
    })
    const finalAssistant = assistant({
      messageId: "assistant-final",
      runId: "run-1",
      text: "Hello world",
      gatewayIndex: 3,
    })
    const keys = [
      messageRowKey(liveTools),
      messageRowKey(liveAssistant),
      messageRowKey(finalAssistant),
    ]
    expect(new Set(keys).size).toBe(3)
  })

  test("optimistic user row promoted to confirmed via id swap stays one row", () => {
    // applyChatPatch swaps the optimistic id for the canonical id in one
    // reducer step (the optimistic row is removed via `idsToReplace`, the
    // canonical row is inserted). The row key changes by id, which is the
    // correct invariant: one physical row at a time, never two with the
    // same key.
    const optimistic = user({
      messageId: "client-opt-1",
      text: "hi",
      isOptimistic: true,
    })
    const confirmed = user({
      messageId: "user-confirmed-1",
      text: "hi",
      gatewayIndex: 1,
    })
    expect(messageRowKey(optimistic)).not.toBe(messageRowKey(confirmed))
    expect(messageRowKey(optimistic)).toBe("client-opt-1")
    expect(messageRowKey(confirmed)).toBe("user-confirmed-1")
  })

  test("falls back gracefully when messageId is missing", () => {
    const malformed = assistant({ messageId: "" as string, gatewayIndex: 5 })
    const key = messageRowKey(malformed)
    expect(key.startsWith("no-id:")).toBe(true)
  })
})

describe("toolCallKey", () => {
  test("uses tool id as stable key, never array index", () => {
    const a: InlineToolCall = { id: "t1", tool: "read", status: "running" }
    const b: InlineToolCall = { id: "t2", tool: "exec", status: "running" }
    expect(toolCallKey(a)).toBe("t1")
    expect(toolCallKey(b)).toBe("t2")
    expect(toolCallKey(a)).not.toBe(toolCallKey(b))
  })

  test("tool key is stable across status transitions for the same tool", () => {
    const running: InlineToolCall = { id: "t1", tool: "read", status: "running" }
    const success: InlineToolCall = { id: "t1", tool: "read", status: "success", duration: "1.2s" }
    expect(toolCallKey(running)).toBe(toolCallKey(success))
  })
})

describe("messageListKeys", () => {
  test("returns a unique key per row in the list", () => {
    const messages: ChatMessage[] = [
      user({ messageId: "u1" }),
      assistant({ messageId: "live:run-1:tools", runId: "run-1" }),
      assistant({ messageId: "live:run-1:assistant", runId: "run-1" }),
      assistant({ messageId: "assistant-final-1", runId: "run-1" }),
      user({ messageId: "u2" }),
      assistant({ messageId: "live:run-2:tools", runId: "run-2" }),
      assistant({ messageId: "assistant-final-2", runId: "run-2" }),
    ]
    const keys = messageListKeys(messages)
    expect(keys).toHaveLength(messages.length)
    expect(new Set(keys).size).toBe(messages.length)
  })

  test("disambiguates if upstream emits duplicate messageIds (last line of defense)", () => {
    const messages: ChatMessage[] = [
      assistant({ messageId: "same-id", text: "first" }),
      assistant({ messageId: "same-id", text: "second" }),
    ]
    const keys = messageListKeys(messages)
    expect(keys).toEqual(["same-id", "same-id#1"])
    expect(new Set(keys).size).toBe(2)
  })

  test("keeps row keys stable when the same messages are rendered again", () => {
    // Re-rendering the same list must produce the same keys, byte-for-byte.
    // This is what guarantees React keeps DOM identity for unchanged rows.
    const messages: ChatMessage[] = [
      user({ messageId: "u1" }),
      assistant({ messageId: "a1", runId: "run-1" }),
      assistant({ messageId: "a2", runId: "run-1" }),
    ]
    expect(messageListKeys(messages)).toEqual(messageListKeys(messages))
  })
})
