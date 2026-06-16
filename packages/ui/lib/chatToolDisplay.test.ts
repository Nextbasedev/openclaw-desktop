import { beforeEach, describe, expect, test } from "vitest"
import { applyTerminalToolState, groupAssistantToolCallsByMessage, mergeToolCallsForDisplay, terminalToolStateById, __resetTerminalToolStateCache } from "./chatToolDisplay"
import type { ChatMessage, InlineToolCall } from "@/components/ChatView/types"

beforeEach(() => {
  __resetTerminalToolStateCache()
})

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

  test("preserves array identity when no tool actually changes (perf: lets ToolCallSteps memo bail)", () => {
    // Regression for the "tool call stack lags my FPS on every SSE patch" bug:
    // when a streaming patch updates some other tool/message, applyTerminalToolState
    // must return the SAME array reference for unaffected tool stacks so the
    // memoized <ToolCallSteps> can bail out on its `tools` prop shallow compare.
    const stable: InlineToolCall[] = [
      { id: "exec-1", tool: "exec", status: "success", duration: "0.3s", resultText: "ok" },
      { id: "read-1", tool: "read", status: "success", duration: "0.1s", resultText: "file" },
    ]
    const terminalById = terminalToolStateById([
      { messageId: "a-other", role: "assistant", text: "", toolCalls: stable },
    ])

    const result = applyTerminalToolState(stable, terminalById)
    expect(result).toBe(stable)
  })

  test("terminalToolStateById returns the same Map when only a running tool grew", () => {
    // Regression for tool-call streaming jank: while one tool is `running` and
    // its `resultText` grows with every SSE patch, downstream tool stacks must
    // see the same terminal Map reference so applyTerminalToolState can keep
    // returning the same array reference and <ToolCallSteps> memo can bail.
    const terminalTool: InlineToolCall = {
      id: "exec", tool: "exec", status: "success", duration: "0.3s", resultText: "ok",
    }
    const messagesV1: ChatMessage[] = [
      {
        messageId: "a-1", role: "assistant", text: "",
        toolCalls: [
          terminalTool,
          { id: "run", tool: "exec", status: "running", resultText: "line 1\n" },
        ],
      },
    ]
    const mapV1 = terminalToolStateById(messagesV1)

    const messagesV2: ChatMessage[] = [
      {
        messageId: "a-1", role: "assistant", text: "",
        toolCalls: [
          terminalTool,
          // running tool grew — same id, different resultText
          { id: "run", tool: "exec", status: "running", resultText: "line 1\nline 2\n" },
        ],
      },
    ]
    const mapV2 = terminalToolStateById(messagesV2)
    expect(mapV2).toBe(mapV1)
  })

  test("terminalToolStateById rebuilds when a tool actually finishes", () => {
    const messagesV1: ChatMessage[] = [
      {
        messageId: "a-1", role: "assistant", text: "",
        toolCalls: [
          { id: "run", tool: "exec", status: "running", resultText: "" },
        ],
      },
    ]
    const mapV1 = terminalToolStateById(messagesV1)
    expect(mapV1.size).toBe(0)

    const messagesV2: ChatMessage[] = [
      {
        messageId: "a-1", role: "assistant", text: "",
        toolCalls: [
          { id: "run", tool: "exec", status: "success", duration: "0.5s", resultText: "ok" },
        ],
      },
    ]
    const mapV2 = terminalToolStateById(messagesV2)
    expect(mapV2).not.toBe(mapV1)
    expect(mapV2.get("run")).toMatchObject({ status: "success", duration: "0.5s" })
  })

  test("preserves array identity when terminalById is non-empty but unrelated to the tools", () => {
    const stable: InlineToolCall[] = [
      { id: "running-1", tool: "exec", status: "running", awaitingResult: true },
    ]
    const terminalById = terminalToolStateById([
      {
        messageId: "a-other",
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "unrelated", tool: "exec", status: "success", duration: "0.1s", resultText: "ok" },
        ],
      },
    ])

    // running tool stays running because no terminal entry for it and
    // finalizeStaleRunning is not requested.
    const result = applyTerminalToolState(stable, terminalById)
    expect(result).toBe(stable)
  })
})
