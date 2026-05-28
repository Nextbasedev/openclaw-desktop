import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 6_000,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("loads when the user scrolls upward into the upper 60 percent of loaded history", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 5_400 })).toBe(true)
  })

  it("does not load while the user is still below the upper history threshold", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 5_500 })).toBe(false)
  })

  it("does not load from programmatic scrolls without user intent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 3_000, hasUserIntent: false })).toBe(false)
  })

  it("does not load while scrolling downward, even inside the threshold", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 3_000, scrollTop: 3_200 })).toBe(false)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })
})
