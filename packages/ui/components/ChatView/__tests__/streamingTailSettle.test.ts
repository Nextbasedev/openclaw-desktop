import { describe, test, expect } from "vitest"
import { isStreamingTailSettled } from "../index"
import type { ChatMessage } from "../../../lib/chat-engine-v2/types"
import type { InlineToolCall } from "../../../lib/chat-engine-v2/types"

const assistant = (text: string, toolCalls?: ChatMessage["toolCalls"]): ChatMessage =>
  ({ messageId: "a1", role: "assistant", text, toolCalls } as ChatMessage)
const user = (text: string): ChatMessage => ({ messageId: "u1", role: "user", text } as ChatMessage)
const runningTool: InlineToolCall = { id: "t1", tool: "read", status: "running" } as InlineToolCall

describe("isStreamingTailSettled (visual indicator settle)", () => {
  test("settles when streaming with a complete assistant answer and no active tool", () => {
    expect(isStreamingTailSettled("streaming", [user("hi"), assistant("Your name is Krish.")], null)).toBe(true)
  })

  test("does NOT settle while a tool is live (preamble -> tools must keep the indicator)", () => {
    expect(isStreamingTailSettled("streaming", [user("hi"), assistant("Let me check.")], runningTool)).toBe(false)
    expect(isStreamingTailSettled("streaming", [user("hi"), assistant("x", [{ id: "t", tool: "read", status: "running" } as InlineToolCall])], null)).toBe(false)
  })

  test("does NOT settle for non-streaming active states", () => {
    expect(isStreamingTailSettled("thinking", [user("hi"), assistant("partial")], null)).toBe(false)
    expect(isStreamingTailSettled("tool_running", [user("hi"), assistant("partial")], null)).toBe(false)
  })

  test("does NOT settle without assistant answer text yet", () => {
    expect(isStreamingTailSettled("streaming", [user("hi"), assistant("   ")], null)).toBe(false)
    expect(isStreamingTailSettled("streaming", [user("hi")], null)).toBe(false)
  })
})
