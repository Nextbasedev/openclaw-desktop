import { describe, expect, test } from "vitest"
import { groupAssistantToolCallsByMessage, mergeToolCallsForDisplay } from "./chatToolDisplay"
import type { ChatMessage } from "@/components/ChatView/types"

describe("ChatView tool display grouping", () => {
  test("keeps all tool calls for one assistant response in one steps block", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "check project" },
      {
        messageId: "a-tools-1",
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "memory", tool: "memory_search", status: "success" },
          { id: "read", tool: "read", status: "success" },
        ],
      },
      { messageId: "a-text", role: "assistant", text: "I found it." },
      {
        messageId: "a-tools-late",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "success" }],
      },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-text")).toMatchObject([
      { id: "memory", tool: "memory_search" },
      { id: "read", tool: "read" },
      { id: "exec", tool: "exec" },
    ])
    expect(grouped.has("a-tools-1")).toBe(false)
    expect(suppressed.has("a-tools-1")).toBe(true)
    expect(suppressed.has("a-tools-late")).toBe(true)
  })

  test("moves a completed tool-only thinking block onto the final assistant text", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "who am i" },
      {
        messageId: "a-tools-1",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "memory", tool: "memory_search", status: "success" }],
      },
      { messageId: "a-final-1", role: "assistant", text: "I don't know your name yet." },
      { messageId: "u2", role: "user", text: "who are you" },
      { messageId: "a-final-2", role: "assistant", text: "I'm Assistant." },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-final-1")).toMatchObject([{ id: "memory", tool: "memory_search" }])
    expect(grouped.has("a-tools-1")).toBe(false)
    expect(suppressed.has("a-tools-1")).toBe(true)
  })

  test("starts a new steps block after the next user message", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "first" },
      {
        messageId: "a-tools-1",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "read", tool: "read", status: "success" }],
      },
      { messageId: "u2", role: "user", text: "second" },
      {
        messageId: "a-tools-2",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "success" }],
      },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-tools-1")).toMatchObject([{ id: "read" }])
    expect(grouped.get("a-tools-2")).toMatchObject([{ id: "exec" }])
    expect(suppressed.size).toBe(0)
  })

  test("preserves completed duration when merging live tool updates", () => {
    const tools = mergeToolCallsForDisplay(
      [{ id: "exec", tool: "exec", status: "success", duration: "2.0s" }],
      [{ id: "exec", tool: "exec", status: "success" }]
    )

    expect(tools[0]).toMatchObject({ id: "exec", duration: "2.0s" })
  })
})
