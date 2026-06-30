import { describe, expect, it } from "vitest"
import { isTurnFinalStopReason } from "../turnCompletion"

describe("isTurnFinalStopReason", () => {
  it("is NOT final while still streaming (no stop reason yet)", () => {
    expect(isTurnFinalStopReason(undefined)).toBe(false)
    expect(isTurnFinalStopReason(null)).toBe(false)
    expect(isTurnFinalStopReason("")).toBe(false)
  })

  it("is NOT final when the turn paused to run tools (more work coming)", () => {
    expect(isTurnFinalStopReason("tool_use")).toBe(false)
    expect(isTurnFinalStopReason("tool_calls")).toBe(false)
    expect(isTurnFinalStopReason("TOOL_USE")).toBe(false)
  })

  it("IS final on real terminal reasons → answer complete, Writing… clears", () => {
    expect(isTurnFinalStopReason("stop")).toBe(true)
    expect(isTurnFinalStopReason("end_turn")).toBe(true)
    expect(isTurnFinalStopReason("error")).toBe(true)
    expect(isTurnFinalStopReason("aborted")).toBe(true)
  })

  it("treats an unrecognised terminal reason as final (never hang Writing…)", () => {
    expect(isTurnFinalStopReason("max_tokens")).toBe(true)
    expect(isTurnFinalStopReason("length")).toBe(true)
    expect(isTurnFinalStopReason("some_future_reason")).toBe(true)
  })
})
