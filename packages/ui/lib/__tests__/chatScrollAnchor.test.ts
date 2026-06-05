import { describe, expect, it } from "vitest"
import { restoreMessageScrollAnchor } from "@/components/ChatView/chatScrollAnchor"

function row(uiId: string, top: number, messageId = uiId) {
  return {
    dataset: { uiId, messageId },
    getBoundingClientRect: () => ({ top, bottom: top + 80, height: 80, left: 0, right: 0, width: 600, x: 0, y: top, toJSON: () => ({}) }),
  } as unknown as HTMLElement
}

describe("restoreMessageScrollAnchor", () => {
  it("preserves the viewport by compensating for prepended variable-height rows", () => {
    const anchorRow = row("msg-20", 340)
    const container = {
      scrollTop: 1_200,
      scrollHeight: 7_500,
      clientHeight: 800,
      querySelectorAll: () => [row("msg-1", -260), row("msg-10", 120), anchorRow],
    } as unknown as HTMLElement

    restoreMessageScrollAnchor(container, {
      id: "row-msg-20",
      uiId: "msg-20",
      messageId: "message-20",
      top: 100,
      previousScrollHeight: 6_400,
      previousScrollTop: 960,
    })

    expect(container.scrollTop).toBe(1_440)
  })
})
