import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  chatSessionStoreStats,
  clearChatSessionStoreForTests,
  getCachedChatSessionMessages,
  publishChatSessionMessages,
  subscribeChatSessionMessages,
} from "../chatSessionStore"

const assistantMessage = (id: string, text: string) => ({
  messageId: id,
  role: "assistant" as const,
  text,
})

describe("chatSessionStore", () => {
  beforeEach(() => clearChatSessionStoreForTests())

  it("shares messages for every subscriber of the same session", () => {
    const first = vi.fn()
    const second = vi.fn()

    const offFirst = subscribeChatSessionMessages("agent:main:one", first)
    const offSecond = subscribeChatSessionMessages("agent:main:one", second)

    const messages = [assistantMessage("a1", "hello")]
    publishChatSessionMessages("agent:main:one", messages, "publisher")

    expect(first).toHaveBeenCalledWith(messages, "publisher")
    expect(second).toHaveBeenCalledWith(messages, "publisher")
    expect(getCachedChatSessionMessages("agent:main:one")).toEqual(messages)

    offFirst()
    publishChatSessionMessages("agent:main:one", [assistantMessage("a2", "next")])

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    offSecond()
  })

  it("keeps session records isolated by sessionKey", () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeChatSessionMessages("agent:main:one", first)
    subscribeChatSessionMessages("agent:main:two", second)

    publishChatSessionMessages("agent:main:one", [assistantMessage("a1", "one")])

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(chatSessionStoreStats()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionKey: "agent:main:one", messages: 1, messageSubscribers: 1 }),
        expect.objectContaining({ sessionKey: "agent:main:two", messages: 0, messageSubscribers: 1 }),
      ]),
    )
  })
})
