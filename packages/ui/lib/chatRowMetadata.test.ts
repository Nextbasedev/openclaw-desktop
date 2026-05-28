import { describe, expect, it } from "vitest"
import { buildChatRowMetadata, formatToolSummary, summarizeTools } from "../components/ChatView/chatRowMetadata"
import type { ChatMessage, InlineToolCall } from "../components/ChatView/types"

function msg(messageId: string, role: "user" | "assistant", text = ""): ChatMessage {
  return { messageId, role, text }
}

function tool(id: string, status: InlineToolCall["status"], approval = false): InlineToolCall {
  return {
    id,
    tool: id,
    status,
    approval: approval ? { id: `approval-${id}`, allowedDecisions: ["allow-once", "deny"] } : undefined,
  }
}

describe("buildChatRowMetadata", () => {
  it("marks earlier assistant text in the same turn when later assistant text exists", () => {
    const messages: ChatMessage[] = [
      msg("u1", "user", "do it"),
      msg("a1", "assistant", "first"),
      { ...msg("a-tools", "assistant"), toolCalls: [tool("read", "success")] },
      msg("a2", "assistant", "second"),
    ]

    const result = buildChatRowMetadata({
      messages,
      latestUserIndex: 0,
      isGenerating: false,
      pendingToolsLength: 0,
    })

    expect(result.byMessageId.get("a1")?.hasLaterAssistantInSameTurn).toBe(true)
    expect(result.byMessageId.get("a2")?.hasLaterAssistantInSameTurn).toBe(false)
  })

  it("resets later-assistant detection at user boundaries", () => {
    const messages: ChatMessage[] = [
      msg("u1", "user", "first ask"),
      msg("a1", "assistant", "first answer"),
      msg("u2", "user", "second ask"),
      msg("a2", "assistant", "second answer"),
    ]

    const result = buildChatRowMetadata({
      messages,
      latestUserIndex: 2,
      isGenerating: false,
      pendingToolsLength: 0,
    })

    expect(result.byMessageId.get("a1")?.hasLaterAssistantInSameTurn).toBe(false)
    expect(result.byMessageId.get("a2")?.hasLaterAssistantInSameTurn).toBe(false)
  })

  it("collects displayed tool ids once", () => {
    const messages: ChatMessage[] = [
      msg("u1", "user", "do it"),
      { ...msg("a1", "assistant"), toolCalls: [tool("read", "success"), tool("exec", "running")] },
    ]

    const result = buildChatRowMetadata({
      messages,
      latestUserIndex: 0,
      isGenerating: true,
      pendingToolsLength: 2,
    })

    expect(result.displayedToolIds.has("read")).toBe(true)
    expect(result.displayedToolIds.has("exec")).toBe(true)
    expect(result.byMessageId.get("a1")?.shouldFinalizeDisplayedTools).toBe(false)
  })
})

describe("summarizeTools", () => {
  it("summarizes running, done, failed, and approval-needed tools", () => {
    const summary = summarizeTools([
      tool("a", "success"),
      tool("b", "success"),
      tool("c", "running"),
      tool("d", "error"),
      tool("e", "running", true),
    ])

    expect(summary.running).toBe(2)
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.approvalNeeded).toBe(1)
    expect(summary.urgentTool?.id).toBe("e")
    expect(formatToolSummary(summary)).toBe("2 running · 2 done · 1 failed · 1 approval")
  })
})
