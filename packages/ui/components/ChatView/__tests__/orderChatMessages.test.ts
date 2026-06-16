import { describe, expect, test } from "vitest"
import { orderChatMessages } from "../orderChatMessages"
import type { ChatMessage } from "../types"

describe("orderChatMessages", () => {
  test("keeps optimistic file user before numbered assistant response", () => {
    const user: ChatMessage = {
      messageId: "client-file-1",
      role: "user",
      text: "read once again",
      createdAt: "2026-06-16T05:00:00.000Z",
      isOptimistic: true,
      attachments: [{ name: "hyy.md", mimeType: "text/markdown", content: "file body" }],
    }
    const assistant: ChatMessage = {
      messageId: "assistant-1",
      role: "assistant",
      text: "I read it again.",
      createdAt: "2026-06-16T05:00:01.000Z",
      gatewayIndex: 2,
    }

    expect(orderChatMessages([user, assistant]).map((message) => message.messageId)).toEqual([
      "client-file-1",
      "assistant-1",
    ])
  })

  test("keeps existing array order when only one row has gateway sequence", () => {
    const first: ChatMessage = { messageId: "local", role: "user", text: "local" }
    const second: ChatMessage = { messageId: "canonical", role: "assistant", text: "canonical", gatewayIndex: 1 }

    expect(orderChatMessages([first, second]).map((message) => message.messageId)).toEqual(["local", "canonical"])
  })
})
