import { describe, it } from "vitest"
import assert from "node:assert/strict"
import { dedupeChatMessages } from "./chatMessageDedupe"
import type { ChatMessage } from "../components/ChatView/types"

describe("dedupeChatMessages", () => {
  it("renders history in chronological chat order even when loaded out of order", () => {
    const messages: ChatMessage[] = [
      {
        messageId: "u-new",
        role: "user",
        text: "How are you?",
        createdAt: "2026-05-14T10:39:00.000Z",
        gatewayIndex: 2,
      },
      {
        messageId: "a-new",
        role: "assistant",
        text: "Doing well.",
        createdAt: "2026-05-14T10:39:01.000Z",
        gatewayIndex: 3,
      },
      {
        messageId: "u-old",
        role: "user",
        text: "hello",
        createdAt: "2026-05-14T09:35:00.000Z",
        gatewayIndex: 10,
      },
      {
        messageId: "a-old",
        role: "assistant",
        text: "Workspace is deactivated.",
        createdAt: "2026-05-14T09:35:01.000Z",
        gatewayIndex: 11,
        stopReason: "error",
      },
    ]

    assert.deepEqual(
      dedupeChatMessages(messages).map((message) => message.messageId),
      ["u-old", "a-old", "u-new", "a-new"],
    )
  })

  it("keeps same-timestamp user messages before assistant replies", () => {
    const messages: ChatMessage[] = [
      {
        messageId: "assistant",
        role: "assistant",
        text: "Reply",
        createdAt: "2026-05-14T10:00:00.000Z",
        gatewayIndex: 1,
      },
      {
        messageId: "user",
        role: "user",
        text: "Prompt",
        createdAt: "2026-05-14T10:00:00.000Z",
        gatewayIndex: 2,
      },
    ]

    assert.deepEqual(
      dedupeChatMessages(messages).map((message) => message.messageId),
      ["user", "assistant"],
    )
  })
})
