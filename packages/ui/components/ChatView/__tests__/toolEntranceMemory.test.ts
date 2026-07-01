import { beforeEach, describe, expect, test } from "vitest"
import {
  __resetToolEntranceMemoryForTests,
  markToolEntranceSeen,
  shouldPlayToolEntrance,
  toolEntranceKey,
} from "../toolEntranceMemory"

describe("tool entrance memory — animate each card once, ever", () => {
  beforeEach(() => __resetToolEntranceMemoryForTests())

  test("plays the first time, then never again after the entrance completes", () => {
    const key = toolEntranceKey("s1", "call-1")
    // First mount of a brand-new tool id: should animate.
    expect(shouldPlayToolEntrance(key)).toBe(true)
    // Entrance finishes -> mark seen.
    markToolEntranceSeen(key)
    // Any later render (new sibling in the same burst, or a full remount) must
    // snap straight to the resting state — no re-animation flicker.
    expect(shouldPlayToolEntrance(key)).toBe(false)
    expect(shouldPlayToolEntrance(key)).toBe(false)
  })

  test("a burst of new tool ids each animate exactly once; existing ones stay put", () => {
    const existing = toolEntranceKey("s1", "call-existing")
    markToolEntranceSeen(existing) // already animated earlier

    // Three new tool cards land together in one burst.
    const burst = ["a", "b", "c"].map((id) => toolEntranceKey("s1", id))
    for (const key of burst) expect(shouldPlayToolEntrance(key)).toBe(true)
    for (const key of burst) markToolEntranceSeen(key)

    // The pre-existing card never re-animates during the burst...
    expect(shouldPlayToolEntrance(existing)).toBe(false)
    // ...and the burst cards don't re-animate on the next render either.
    for (const key of burst) expect(shouldPlayToolEntrance(key)).toBe(false)
  })

  test("keys are scoped per session + call id", () => {
    const a = toolEntranceKey("s1", "call-1")
    const b = toolEntranceKey("s2", "call-1")
    markToolEntranceSeen(a)
    expect(shouldPlayToolEntrance(a)).toBe(false)
    // Same call id under a different session is a distinct card — still animates.
    expect(shouldPlayToolEntrance(b)).toBe(true)
  })

  test("bounded: does not grow without limit", () => {
    for (let i = 0; i < 1000; i++) markToolEntranceSeen(toolEntranceKey("s1", `call-${i}`))
    // The most recent id is still remembered (won't re-animate)...
    expect(shouldPlayToolEntrance(toolEntranceKey("s1", "call-999"))).toBe(false)
    // ...while the oldest was evicted (would animate again if it ever returns),
    // proving the set is capped rather than unbounded.
    expect(shouldPlayToolEntrance(toolEntranceKey("s1", "call-0"))).toBe(true)
  })
})
