import { describe, expect, it } from "vitest"
import { windowChatMessages } from "../messageWindow"

function msg(i: number) {
  return { messageId: `m${i}`, role: i % 2 ? "user" : "assistant", text: `message ${i}` } as any
}

describe("windowChatMessages", () => {
  it("returns all messages under the window size", () => {
    const messages = [msg(1), msg(2)]
    expect(windowChatMessages(messages, [], 10)).toEqual({ messages, hiddenBefore: 0, total: 2 })
  })

  it("keeps the latest window for large chats", () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(i + 1))
    const result = windowChatMessages(messages, [], 4)
    expect(result.messages.map((m) => m.messageId)).toEqual(["m7", "m8", "m9", "m10"])
    expect(result.hiddenBefore).toBe(6)
    expect(result.total).toBe(10)
  })

  it("keeps pinned message context", () => {
    const messages = Array.from({ length: 300 }, (_, i) => msg(i + 1))
    const result = windowChatMessages(messages, ["m10"], 20)
    expect(result.messages.some((m) => m.messageId === "m10")).toBe(true)
    expect(result.messages.some((m) => m.messageId === "m300")).toBe(true)
  })

  it("expands when the caller increases window size", () => {
    const messages = Array.from({ length: 600 }, (_, i) => msg(i + 1))
    const first = windowChatMessages(messages, [], 240)
    const expanded = windowChatMessages(messages, [], 480)
    expect(first.messages).toHaveLength(240)
    expect(expanded.messages).toHaveLength(480)
    expect(first.messages[0].messageId).toBe("m361")
    expect(expanded.messages[0].messageId).toBe("m121")
  })
})
