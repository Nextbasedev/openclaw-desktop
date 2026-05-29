import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory, shouldPreloadOlderHistoryAtRest } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 2_000,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("loads when the user scrolls upward near the top preload window", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 1_600, scrollTop: 1_400 })).toBe(true)
  })

  it("does not load while the user is still far from the top", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 4_000, scrollTop: 3_700 })).toBe(false)
  })

  it("does not load from programmatic scrolls without user intent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 1_000, hasUserIntent: false })).toBe(false)
  })

  it("does not repeatedly load from tiny upward movement after a page was prepended", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 1_300, scrollTop: 1_250, lastLoadScrollTop: 1_400 })).toBe(false)
  })

  it("loads again near the top after meaningful continued upward scroll from the previous load", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 800, scrollTop: 600, lastLoadScrollTop: 1_400 })).toBe(true)
  })

  it("does not load while scrolling downward, even inside the preload window", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 700, scrollTop: 900 })).toBe(false)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })

  it("can continue preloading at rest when the user remains near the top after a page loads", () => {
    expect(shouldPreloadOlderHistoryAtRest({ ...base, scrollTop: 1_200 })).toBe(true)
  })

  it("does not continue preloading at rest when the prepend moved the user away from the top window", () => {
    expect(shouldPreloadOlderHistoryAtRest({ ...base, scrollTop: 3_200 })).toBe(false)
  })
})
