import { describe, expect, it } from "vitest"
import { assistantTextFromAppendMessage, toAssistantMessage, toAssistantMessages } from "@/components/ChatView/assistant-ui/adapter"
import type { ChatMessage } from "@/components/ChatView/types"

const base = (overrides: Partial<ChatMessage>): ChatMessage => ({
  messageId: "m1",
  role: "assistant",
  text: "hello",
  createdAt: "2026-05-27T04:00:00.000Z",
  ...overrides,
})

describe("assistant-ui adapter", () => {
  it("converts assistant text while preserving id, role, date, and metadata", () => {
    const source = base({ model: "gpt-test", usage: { input: 1, output: 2, cacheRead: null, cacheWrite: null, total: 3 } })
    const message = toAssistantMessage(source)

    expect(message.id).toBe("m1")
    expect(message.role).toBe("assistant")
    expect(message.createdAt.toISOString()).toBe("2026-05-27T04:00:00.000Z")
    expect(message.content).toContainEqual({ type: "text", text: "hello" })
    expect(message.metadata.custom.openclaw).toBe(source)
  })

  it("converts user text messages", () => {
    const message = toAssistantMessage(base({ role: "user", text: "send this" }))

    expect(message.role).toBe("user")
    expect(message.status).toBeUndefined()
    expect(message.content).toContainEqual({ type: "text", text: "send this" })
  })

  it("converts reasoning before visible text", () => {
    const message = toAssistantMessage(base({ reasoningText: "thinking", text: "answer" }))

    expect(message.content[0]).toEqual({ type: "reasoning", text: "thinking" })
    expect(message.content[1]).toEqual({ type: "text", text: "answer" })
  })

  it("converts tool calls and keeps approval metadata", () => {
    const message = toAssistantMessage(base({
      text: "",
      toolCalls: [
        {
          id: "tool-1",
          tool: "exec",
          status: "running",
          input: { command: "echo ok" },
          awaitingResult: true,
          approval: {
            id: "approval-1",
            command: "echo ok",
            allowedDecisions: ["allow-once", "deny"],
          },
        },
      ],
    }))

    expect(message.content[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "exec",
      args: { command: "echo ok" },
      result: {
        approval: {
          id: "approval-1",
          command: "echo ok",
          allowedDecisions: ["allow-once", "deny"],
        },
        awaitingResult: true,
      },
      status: { type: "running" },
    })
  })

  it("marks errored tool calls", () => {
    const message = toAssistantMessage(base({
      text: "",
      toolCalls: [{ id: "tool-err", tool: "read", status: "error", resultText: "failed" }],
    }))

    expect(message.content[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "tool-err",
      toolName: "read",
      result: "failed",
      isError: true,
    })
  })

  it("converts image and document attachments", () => {
    const message = toAssistantMessage(base({
      attachments: [
        { name: "image.png", mimeType: "image/png", content: "data:image/png;base64,abc", size: 3 },
        { name: "notes.txt", mimeType: "text/plain", content: "notes", size: 5 },
      ],
    }))

    expect(message.attachments?.[0]).toMatchObject({ name: "image.png", type: "image", contentType: "image/png" })
    expect(message.attachments?.[1]).toMatchObject({ name: "notes.txt", type: "document", contentType: "text/plain" })
  })

  it("converts arrays without changing order", () => {
    const messages = toAssistantMessages([
      base({ messageId: "u1", role: "user", text: "one" }),
      base({ messageId: "a1", role: "assistant", text: "two" }),
    ])

    expect(messages.map((message) => message.id)).toEqual(["u1", "a1"])
  })

  it("extracts composer text from assistant-ui append messages", () => {
    expect(assistantTextFromAppendMessage({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] })).toBe("one\n\ntwo")
  })
})
