import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

const base = {
  scrollHeight: 10_000,
  clientHeight: 1_000,
  previousScrollTop: 6_000,
  hasUserIntent: true,
}

describe("shouldAutoLoadOlderHistory", () => {
  it("preloads one older page after the user crosses 60 percent of the loaded history", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 5_500, scrollTop: 5_300 })).toBe(true)
  })

  it("does not load too early while more than 40 percent of newer history remains below", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 6_300, scrollTop: 6_100 })).toBe(false)
  })

  it("does not load while the user is still below the preload threshold", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 6_200 })).toBe(false)
  })

  it("does not load from programmatic scrolls without user intent", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollTop: 3_000, hasUserIntent: false })).toBe(false)
  })

  it("loads at the very top even after reload when previousScrollTop is also top", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 0, scrollTop: 0 })).toBe(true)
  })

  it("does not repeatedly load from tiny upward movement inside the already-crossed threshold", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 3_500, scrollTop: 3_400, lastLoadScrollTop: 3_600 })).toBe(false)
  })

  it("loads again inside the threshold after meaningful continued upward scroll from the previous load", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 3_100, scrollTop: 2_900, lastLoadScrollTop: 3_600 })).toBe(true)
  })

  it("does not load while scrolling downward, even inside the threshold", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, previousScrollTop: 3_000, scrollTop: 3_200 })).toBe(false)
  })

  it("does not load if the container is not scrollable", () => {
    expect(shouldAutoLoadOlderHistory({ ...base, scrollHeight: 900, clientHeight: 1_000, scrollTop: 0 })).toBe(false)
  })
})
