import { describe, expect, it } from "vitest"
import { desiredAnchorTopAfterUserScroll, restoreDeltaPreservingUserScroll } from "@/components/ChatView/chatScrollAnchorMath"

const anchor = { top: 200, previousScrollTop: 4_000 }

describe("chat scroll anchor math", () => {
  it("keeps the original anchor top when the user does not scroll during load", () => {
    expect(desiredAnchorTopAfterUserScroll({ anchor, currentScrollTop: 4_000 })).toBe(200)
  })

  it("preserves upward user scroll that happens while older messages are loading", () => {
    expect(desiredAnchorTopAfterUserScroll({ anchor, currentScrollTop: 3_700 })).toBe(500)
  })

  it("preserves downward user scroll that happens while older messages are loading", () => {
    expect(desiredAnchorTopAfterUserScroll({ anchor, currentScrollTop: 4_150 })).toBe(50)
  })

  it("restores only the prepend/layout delta, not the user's in-flight scroll movement", () => {
    expect(restoreDeltaPreservingUserScroll({
      anchor,
      currentScrollTop: 3_700,
      currentAnchorTop: 1_100,
    })).toBe(600)
  })
})
