import { describe, expect, test } from "vitest"
import { groupAssistantToolCallsByMessage, mergeToolCallsForDisplay } from "./chatToolDisplay"
import type { ChatMessage } from "@/components/ChatView/types"

describe("ChatView tool display grouping", () => {
  test("keeps contiguous tool calls before assistant text in one steps block", () => {
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
      {
        messageId: "a-tools-2",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "grep", tool: "grep", status: "success" }],
      },
      { messageId: "a-text", role: "assistant", text: "I found it." },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-tools-1")).toMatchObject([
      { id: "memory", tool: "memory_search" },
      { id: "read", tool: "read" },
      { id: "grep", tool: "grep" },
    ])
    expect(suppressed.has("a-tools-2")).toBe(true)
  })

  test("starts a new steps block after assistant text so later running tools do not relabel old answers", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "check project" },
      {
        messageId: "a-tools-1",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "read", tool: "read", status: "success" }],
      },
      { messageId: "a-text", role: "assistant", text: "I found it." },
      {
        messageId: "a-tools-late",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "running" }],
      },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-tools-1")).toMatchObject([{ id: "read", status: "success" }])
    expect(grouped.get("a-tools-late")).toMatchObject([{ id: "exec", status: "running" }])
    expect(suppressed.size).toBe(0)
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

  test("does not show a completed chat tool as running when display grouping sees stale updates", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "check" },
      {
        messageId: "a-tools-done",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "success", duration: "2.0s", resultText: "ok" }],
      },
      {
        messageId: "a-tools-stale",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "running" }],
      },
      { messageId: "a-final", role: "assistant", text: "Done." },
    ]

    const { grouped } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-tools-done")?.[0]).toMatchObject({
      id: "exec",
      status: "success",
      duration: "2.0s",
      resultText: "ok",
    })
  })
})
