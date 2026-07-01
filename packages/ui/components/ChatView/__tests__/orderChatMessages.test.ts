import { describe, expect, test } from "vitest"
import { orderChatMessages } from "../orderChatMessages"
import type { ChatMessage } from "../types"

describe("orderChatMessages", () => {
  test("orders chronologically by gateway seq, not raw createdAt", () => {
    // The assistant's createdAt is model-time and can predate the user's client
    // send time. Seq is the reliable chronological key: user (seq 10) must stay
    // before its answer (seq 11) even though the answer's timestamp is earlier.
    const user: ChatMessage = {
      messageId: "user",
      role: "user",
      text: "hyy",
      createdAt: "2026-07-01T09:32:05.000Z",
      gatewayIndex: 10,
    }
    const assistant: ChatMessage = {
      messageId: "assistant",
      role: "assistant",
      text: "Hey Krish.",
      createdAt: "2026-07-01T09:32:04.000Z",
      gatewayIndex: 11,
    }

    expect(orderChatMessages([assistant, user]).map((message) => message.messageId)).toEqual([
      "user",
      "assistant",
    ])
  })

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
