import { describe, it } from "vitest"
import assert from "node:assert/strict"
import { dedupeChatMessages } from "./chatMessageDedupe"
import type { ChatMessage } from "../components/ChatView/types"

describe("dedupeChatMessages", () => {
  it("renders projected history by global seq even when segment timestamps move backward", () => {
    const messages: ChatMessage[] = [
      {
        messageId: "u-current",
        role: "user",
        text: "current segment",
        createdAt: "2026-05-14T10:39:00.000Z",
        gatewayIndex: 70,
      },
      {
        messageId: "a-current",
        role: "assistant",
        text: "current answer",
        createdAt: "2026-05-14T10:39:01.000Z",
        gatewayIndex: 71,
      },
      {
        messageId: "u-archive",
        role: "user",
        text: "archived segment",
        createdAt: "2026-05-14T10:20:00.000Z",
        gatewayIndex: 68,
      },
      {
        messageId: "a-archive",
        role: "assistant",
        text: "archived answer",
        createdAt: "2026-05-14T10:20:01.000Z",
        gatewayIndex: 69,
      },
    ]

    assert.deepEqual(
      dedupeChatMessages(messages).map((message) => message.messageId),
      ["u-archive", "a-archive", "u-current", "a-current"],
    )
  })

  it("keeps same-seq same-timestamp user messages before assistant replies", () => {
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
        gatewayIndex: 1,
      },
    ]

    assert.deepEqual(
      dedupeChatMessages(messages).map((message) => message.messageId),
      ["user", "assistant"],
    )
  })

  it("carries optimistic row identity into the canonical user echo", () => {
    const messages: ChatMessage[] = [
      {
        messageId: "client-1",
        role: "user",
        text: "Long stress prompt",
        createdAt: "2026-06-09T08:00:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
      {
        messageId: "gateway-1",
        role: "user",
        text: "Long stress prompt",
        createdAt: "2026-06-09T08:00:01.000Z",
        gatewayIndex: 21,
      },
      {
        messageId: "assistant-22",
        role: "assistant",
        text: "Canonical answer",
        gatewayIndex: 22,
      },
    ]

    const deduped = dedupeChatMessages(messages)

    assert.equal(deduped.length, 2)
    assert.deepEqual(deduped.map((message) => message.messageId), ["gateway-1", "assistant-22"])
    assert.equal(deduped[0]?.optimisticMessageId, "client-1")
  })
})
