import { describe, expect, it } from "vitest"
import { charsPerSecondForBacklog, nextRevealLength } from "./useStreamingText"

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
