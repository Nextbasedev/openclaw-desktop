import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 6_000,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("loads when upward scroll reaches the oldest 60 percent of loaded history", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 5_500, scrollTop: 5_300 })).toBe(true)
  })

  it("does not load before the user reaches the oldest 60 percent during normal scrolling", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 7_000, scrollTop: 6_200 })).toBe(false)
  })

  it("prefetches earlier when the user scrolls upward quickly", () => {
    expect(shouldAutoLoadOlderHistory({
      ...base,
      previousScrollTop: 8_200,
      scrollTop: 7_400,
      previousScrollTimeMs: 1_000,
      currentTimeMs: 1_300,
    })).toBe(true)
  })

  it("does not use the fast-scroll path while scrolling downward", () => {
    expect(shouldAutoLoadOlderHistory({
      ...base,
      previousScrollTop: 7_000,
      scrollTop: 7_400,
      previousScrollTimeMs: 1_000,
      currentTimeMs: 1_100,
    })).toBe(false)
  })

  it("does not load from programmatic scrolls without user intent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 4_000, hasUserIntent: false })).toBe(false)
  })

  it("loads at the real scroll container top even if the previous scroll ref is stale", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 0, scrollTop: 0 })).toBe(true)
  })

  it("does not repeatedly load from tiny upward movement after a page was prepended", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 5_200, scrollTop: 5_150, lastLoadScrollTop: 5_300 })).toBe(false)
  })

  it("loads the next page when the user crosses into the load zone again", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 5_500, scrollTop: 5_300, lastLoadScrollTop: 8_000 })).toBe(true)
  })

  it("loads again after meaningful continued upward scroll from the previous load", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 4_700, scrollTop: 4_400, lastLoadScrollTop: 5_300 })).toBe(true)
  })

  it("does not load while scrolling downward, even inside the load zone", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 4_400, scrollTop: 4_600 })).toBe(false)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })
})
