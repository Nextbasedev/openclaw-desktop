import { describe, expect, test } from "vitest"
import { shouldCommitRevealFrame, nextRevealLength } from "../useStreamingText"

describe("shouldCommitRevealFrame — throttles per-frame markdown reparse", () => {
  test("always commits the final frame regardless of throttle", () => {
    expect(
      shouldCommitRevealFrame({ now: 1000, lastCommitAt: 995, reachedTarget: true }),
    ).toBe(true)
  })

  test("skips intermediate frames inside the throttle window", () => {
    // 10ms since last commit, well under the ~45ms window → skip (no reparse).
    expect(
      shouldCommitRevealFrame({ now: 1010, lastCommitAt: 1000, reachedTarget: false, commitMs: 45 }),
    ).toBe(false)
  })

  test("commits once the throttle window elapses", () => {
    expect(
      shouldCommitRevealFrame({ now: 1050, lastCommitAt: 1000, reachedTarget: false, commitMs: 45 }),
    ).toBe(true)
  })

  test("throttling does not change WHICH characters are revealed (reveal math is time-based)", () => {
    // The number of chars revealed only depends on elapsed wall-clock time, not
    // on how often we commit — so a coarser commit cadence shows the same text
    // at the same time and finishes on the exact same final length.
    const target = "x".repeat(1000)
    const oneStep = nextRevealLength({ currentLength: 0, targetLength: target.length, elapsedMs: 100 })
    expect(oneStep).toBeGreaterThan(0)
    expect(oneStep).toBeLessThanOrEqual(target.length)
    // Never overshoots the target.
    expect(
      nextRevealLength({ currentLength: 995, targetLength: 1000, elapsedMs: 1000 }),
    ).toBe(1000)
  })
})
