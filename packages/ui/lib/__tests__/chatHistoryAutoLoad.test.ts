import { describe, expect, it } from "vitest"
import { shouldAutoLoadOlderHistory } from "@/components/ChatView/chatHistoryAutoLoad"

// Simplified rule (2026-06-13): load older history when the user is
// scrolling upward AND the scroll position is within one viewport of the
// top. No fast-scroll preload, no rearm distance, no user-intent gating —
// per-call cooldown lives in ChatView's loadOlderWithoutJump.
describe("shouldAutoLoadOlderHistory", () => {
  const base = { scrollHeight: 10_000, clientHeight: 1_000 }

  it("loads when scrolling up and within one viewport of the top", () => {
    expect(
      shouldAutoLoadOlderHistory({
        ...base,
        previousScrollTop: 1_500,
        scrollTop: 900,
      }),
    ).toBe(true)
  })

  it("does not load when not yet within one viewport of the top", () => {
    expect(
      shouldAutoLoadOlderHistory({
        ...base,
        previousScrollTop: 3_000,
        scrollTop: 2_500,
      }),
    ).toBe(false)
  })

  it("does not load while scrolling downward, even near the top", () => {
    expect(
      shouldAutoLoadOlderHistory({
        ...base,
        previousScrollTop: 200,
        scrollTop: 400,
      }),
    ).toBe(false)
  })

  it("loads when at the very top while scrolling up", () => {
    expect(
      shouldAutoLoadOlderHistory({
        ...base,
        previousScrollTop: 200,
        scrollTop: 0,
      }),
    ).toBe(true)
  })

  it("does not load when container is not scrollable", () => {
    expect(
      shouldAutoLoadOlderHistory({
        scrollHeight: 900,
        clientHeight: 1_000,
        previousScrollTop: 100,
        scrollTop: 0,
      }),
    ).toBe(false)
  })

  it("threshold scales with viewport height", () => {
    // Tall viewport \u2192 trigger zone is the top 2000px.
    expect(
      shouldAutoLoadOlderHistory({
        scrollHeight: 10_000,
        clientHeight: 2_000,
        previousScrollTop: 2_500,
        scrollTop: 1_900,
      }),
    ).toBe(true)
    // Short viewport \u2192 trigger zone is the top 400px.
    expect(
      shouldAutoLoadOlderHistory({
        scrollHeight: 10_000,
        clientHeight: 400,
        previousScrollTop: 1_000,
        scrollTop: 800,
      }),
    ).toBe(false)
  })
})
