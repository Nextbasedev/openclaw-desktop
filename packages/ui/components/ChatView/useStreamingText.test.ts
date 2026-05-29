import { describe, expect, it } from "vitest"
import { charsPerSecondForBacklog, initialStreamingTextState, nextRevealLength } from "./useStreamingText"

describe("stream reveal pacing", () => {
  it("reveals at least one character each frame", () => {
    expect(nextRevealLength({ currentLength: 0, targetLength: 10, elapsedMs: 16 })).toBeGreaterThan(0)
  })

  it("speeds up as backlog grows", () => {
    expect(charsPerSecondForBacklog(2_000)).toBeGreaterThan(charsPerSecondForBacklog(50))
  })

  it("keeps very large buffers from lagging too far behind", () => {
    const next = nextRevealLength({ currentLength: 0, targetLength: 4_000, elapsedMs: 16 })
    expect(4_000 - next).toBeLessThanOrEqual(1_800)
  })

  it("never reveals beyond target length", () => {
    expect(nextRevealLength({ currentLength: 9, targetLength: 10, elapsedMs: 1_000 })).toBe(10)
  })

  it("renders immediate streaming text at the current full chunk with no synthetic reveal", () => {
    expect(initialStreamingTextState("streamed chunk", true, "immediate")).toEqual({
      displayText: "streamed chunk",
      isRevealing: false,
    })
  })

  it("keeps buffered mode available for deliberate character reveal animations", () => {
    expect(initialStreamingTextState("streamed chunk", true, "buffered")).toEqual({
      displayText: "",
      isRevealing: true,
    })
  })
})
