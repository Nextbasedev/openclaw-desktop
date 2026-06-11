import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 2_700,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("loads when upward scroll reaches the stable near-top load zone", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_700, scrollTop: 2_300 })).toBe(true)
  })

  it("does not load before the user reaches the stable near-top load zone during normal scrolling", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 3_400, scrollTop: 2_900 })).toBe(false)
  })

  it("prefetches earlier when the user scrolls upward quickly", () => {
    expect(shouldAutoLoadOlderHistory({
      ...base,
      previousScrollTop: 3_300,
      scrollTop: 2_900,
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

  it("does not repeatedly load from tiny upward movement after a page was prepended", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_280, scrollTop: 2_240, lastLoadScrollTop: 2_300 })).toBe(false)
  })

  it("loads the next page when the user crosses into the load zone again", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 2_700, scrollTop: 2_300, lastLoadScrollTop: 4_000 })).toBe(true)
  })

  it("loads again after meaningful continued upward scroll from the previous load", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 1_700, scrollTop: 1_500, lastLoadScrollTop: 2_300 })).toBe(true)
  })

  it("does not load while scrolling downward, even inside the load zone", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 1_900, scrollTop: 2_100 })).toBe(false)
  })

  it("behaves consistently near the top even when total loaded height changes", () => {
    expect(shouldAutoLoadOlderHistory({
      scrollHeight: 4_000,
      clientHeight: 1_000,
      previousScrollTop: 1_900,
      scrollTop: 1_700,
      hasUserIntent: true,
    })).toBe(true)
    expect(shouldAutoLoadOlderHistory({
      scrollHeight: 14_000,
      clientHeight: 1_000,
      previousScrollTop: 1_900,
      scrollTop: 1_700,
      hasUserIntent: true,
    })).toBe(true)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })
})
