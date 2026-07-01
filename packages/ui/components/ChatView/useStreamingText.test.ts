import { describe, expect, it } from "vitest"
import { charsPerSecondForBacklog, nextRevealLength, resolveTargetTransition } from "./useStreamingText"

describe("stream reveal pacing", () => {
  it("reveals at least one character each frame", () => {
    expect(nextRevealLength({ currentLength: 0, targetLength: 10, elapsedMs: 16 })).toBeGreaterThan(0)
  })

  it("speeds up as backlog grows", () => {
    expect(charsPerSecondForBacklog(2_000)).toBeGreaterThan(charsPerSecondForBacklog(50))
  })

  it("reveals large buffers progressively instead of jumping by thousands of characters", () => {
    const next = nextRevealLength({ currentLength: 0, targetLength: 4_000, elapsedMs: 16 })
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThanOrEqual(180)
  })

  it("never reveals beyond target length", () => {
    expect(nextRevealLength({ currentLength: 9, targetLength: 10, elapsedMs: 1_000 })).toBe(10)
  })

  it("does not dump a large pending response after a delayed animation frame", () => {
    const next = nextRevealLength({ currentLength: 120, targetLength: 3_200, elapsedMs: 2_500 })
    expect(next - 120).toBeLessThanOrEqual(180)
  })

  it("does not reveal a huge first chunk for large websocket batches", () => {
    const next = nextRevealLength({ currentLength: 0, targetLength: 4_000, elapsedMs: 16 })
    expect(next).toBeLessThanOrEqual(180)
  })
})

describe("resolveTargetTransition — no wipe-and-replay on stale targets", () => {
  it("extends while the streamed text keeps growing", () => {
    expect(resolveTargetTransition("Hello", "Hel")).toBe("extend")
    expect(resolveTargetTransition("Hello world", "Hello")).toBe("extend")
  })

  it("treats an unchanged target as extend (never a reset)", () => {
    expect(resolveTargetTransition("Hello world", "Hello world")).toBe("extend")
  })

  it("holds — not resets — when a stale patch hands back a shorter/prefix target", () => {
    // We have revealed "Hello world"; a late reconciliation briefly regresses
    // target to "Hello" (or blanks it). Must NOT wipe the revealed text.
    expect(resolveTargetTransition("Hello", "Hello world")).toBe("hold")
    expect(resolveTargetTransition("", "Hello world")).toBe("hold")
  })

  it("resets only when the content genuinely diverges (a different message)", () => {
    expect(resolveTargetTransition("Goodbye everyone", "Hello world")).toBe("reset")
  })
})
