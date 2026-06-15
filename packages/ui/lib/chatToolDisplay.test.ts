import { describe, expect, test } from "vitest"
import { applyTerminalToolState, groupAssistantToolCallsByMessage, mergeToolCallsForDisplay, terminalToolStateById } from "./chatToolDisplay"
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

    expect(grouped.get("a-text")).toMatchObject([
      { id: "memory", tool: "memory_search" },
      { id: "read", tool: "read" },
      { id: "grep", tool: "grep" },
    ])
    expect(suppressed.has("a-tools-1")).toBe(true)
    expect(suppressed.has("a-tools-2")).toBe(true)
  })

  test("keeps text-bearing assistant tool calls anchored to the visible assistant row", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "run ten tools" },
      {
        messageId: "a-final-with-tools",
        role: "assistant",
        text: "Done — 10 tool calls in parallel.",
        toolCalls: Array.from({ length: 10 }, (_, index) => ({
          id: `tool-${index + 1}`,
          tool: "session_status",
          status: "success" as const,
        })),
      },
    ]

    const { grouped, suppressed } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-final-with-tools")).toHaveLength(10)
    expect(suppressed.has("a-final-with-tools")).toBe(false)
  })

  test("keeps late same-turn tools with the assistant answer instead of a separate stack", () => {
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

    expect(grouped.get("a-text")).toMatchObject([
      { id: "read", status: "success" },
      { id: "exec", status: "running" },
    ])
    expect(suppressed.has("a-tools-1")).toBe(true)
    expect(suppressed.has("a-tools-late")).toBe(true)
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

    expect(grouped.get("a-final")?.[0]).toMatchObject({
      id: "exec",
      status: "success",
      duration: "2.0s",
      resultText: "ok",
    })
  })

  test("counts repeated phase updates for one tool id as one visible step", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "check" },
      {
        messageId: "a-tools-live",
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "tc-stable", tool: "exec", status: "running" },
          { id: "tc-stable", tool: "exec", status: "running", duration: "0.4s" },
          { id: "tc-stable", tool: "exec", status: "success", duration: "0.5s", resultText: "ok" },
        ],
      },
    ]

    const { grouped } = groupAssistantToolCallsByMessage(messages)

    expect(grouped.get("a-tools-live")).toHaveLength(1)
    expect(grouped.get("a-tools-live")?.[0]).toMatchObject({
      id: "tc-stable",
      status: "success",
      duration: "0.5s",
      resultText: "ok",
    })
  })

  test("stabilizes displayed running tools with terminal state from the transcript", () => {
    const terminalById = terminalToolStateById([
      {
        messageId: "a-terminal",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "exec", tool: "exec", status: "success", duration: "0.3s", resultText: "ok" }],
      },
    ])

    const tools = applyTerminalToolState([
      { id: "exec", tool: "exec", status: "running", awaitingResult: true },
    ], terminalById)

    expect(tools[0]).toMatchObject({
      id: "exec",
      status: "success",
      duration: "0.3s",
      resultText: "ok",
      awaitingResult: false,
    })
  })

  test("can finalize stale displayed running tools after the turn is no longer live", () => {
    const tools = applyTerminalToolState([
      { id: "exec", tool: "exec", status: "running", awaitingResult: true },
    ], new Map(), { finalizeStaleRunning: true })

    expect(tools[0]).toMatchObject({
      id: "exec",
      status: "success",
      awaitingResult: false,
    })
  })
})
