import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 3_000,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("loads when upward scroll reaches the oldest 30 percent of loaded history", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_900, scrollTop: 2_600 })).toBe(true)
  })

  it("does not load before the user reaches the oldest 30 percent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 4_000, scrollTop: 3_200 })).toBe(false)
  })

  it("does not load from programmatic scrolls without user intent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 2_000, hasUserIntent: false })).toBe(false)
  })

  it("does not repeatedly load from tiny upward movement after a page was prepended", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_500, scrollTop: 2_450, lastLoadScrollTop: 2_600 })).toBe(false)
  })

  it("loads again after meaningful continued upward scroll from the previous load", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_000, scrollTop: 1_700, lastLoadScrollTop: 2_600 })).toBe(true)
  })

  it("does not load while scrolling downward, even inside the load zone", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 1_700, scrollTop: 1_900 })).toBe(false)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })
})
