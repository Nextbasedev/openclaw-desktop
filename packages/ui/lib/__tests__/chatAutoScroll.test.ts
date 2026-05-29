import { describe, expect, test } from "vitest"
import { isNearChatBottom, scrollChatToBottom, shouldStickToChatBottomAfterScroll } from "@/components/ChatView/chatAutoScroll"

describe("chat auto scroll", () => {
  test("keeps sticky scrolling enabled when the viewport is at the latest message", () => {
    expect(shouldStickToChatBottomAfterScroll({ scrollTop: 880, clientHeight: 600, scrollHeight: 1500 })).toBe(true)
  })

  test("disables sticky scrolling when the user manually scrolls away from bottom", () => {
    expect(shouldStickToChatBottomAfterScroll({ scrollTop: 600, clientHeight: 600, scrollHeight: 1500 })).toBe(false)
  })

  test("re-enables sticky scrolling when the user returns near the bottom", () => {
    expect(isNearChatBottom({ scrollTop: 780, clientHeight: 600, scrollHeight: 1500 })).toBe(true)
  })

  test("scrolls to the full bottom", () => {
    const container = { scrollHeight: 2400, scrollTop: 300 }
    scrollChatToBottom(container)
    expect(container.scrollTop).toBe(2400)
  })
})
