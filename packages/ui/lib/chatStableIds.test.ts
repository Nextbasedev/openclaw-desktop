import { describe, it, expect } from "vitest"
import { buildStableChatRows } from "../components/ChatView/chatStableIds"
import type { ChatMessage } from "../components/ChatView/types"

describe("buildStableChatRows", () => {
  it("keeps the user row key stable after optimistic send is confirmed", () => {
    const optimistic: ChatMessage[] = [
      {
        messageId: "client-1",
        optimisticMessageId: "client-1",
        role: "user",
        text: "Stress prompt 1",
        createdAt: "2026-06-09T08:00:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
    ]
    const confirmed: ChatMessage[] = [
      {
        messageId: "gateway-99",
        optimisticMessageId: "client-1",
        role: "user",
        text: "Stress prompt 1",
        createdAt: "2026-06-09T08:00:00.000Z",
        gatewayIndex: 99,
      },
      {
        messageId: "assistant-100",
        role: "assistant",
        text: "Long response body",
        createdAt: "2026-06-09T08:00:02.000Z",
        gatewayIndex: 100,
      },
    ]

    expect(buildStableChatRows(optimistic)[0]?.uiId).toBe("message:client-1")
    expect(buildStableChatRows(confirmed)[0]?.uiId).toBe("message:client-1")
    expect(buildStableChatRows(confirmed).map((message) => message.role)).toEqual(["user", "assistant"])
  })
})
