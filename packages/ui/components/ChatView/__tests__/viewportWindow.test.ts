import { describe, expect, test } from "vitest"
import {
  computeOffsets,
  computeVisibleRange,
  ESTIMATED_ROW_HEIGHT_PX,
  findRowOffset,
  MIN_OVERSCAN_PX,
  offsetBasedScrollRestoration,
} from "../viewportWindow"

const ids = (n: number) => Array.from({ length: n }, (_, i) => `row-${i}`)

describe("computeOffsets", () => {
  test("uses estimated height for unmeasured rows", () => {
    const result = computeOffsets(ids(3), () => undefined)
    expect(result.offsets).toEqual([
      { uiId: "row-0", top: 0, height: ESTIMATED_ROW_HEIGHT_PX },
      { uiId: "row-1", top: ESTIMATED_ROW_HEIGHT_PX, height: ESTIMATED_ROW_HEIGHT_PX },
      { uiId: "row-2", top: ESTIMATED_ROW_HEIGHT_PX * 2, height: ESTIMATED_ROW_HEIGHT_PX },
    ])
    expect(result.totalHeight).toBe(ESTIMATED_ROW_HEIGHT_PX * 3)
  })

  test("uses measured heights when present and mixes with estimates", () => {
    const heights = new Map<string, number>([["row-0", 200], ["row-2", 50]])
    const result = computeOffsets(ids(3), (id) => heights.get(id))
    expect(result.offsets[0]).toEqual({ uiId: "row-0", top: 0, height: 200 })
    expect(result.offsets[1]).toEqual({
      uiId: "row-1",
      top: 200,
      height: ESTIMATED_ROW_HEIGHT_PX,
    })
    expect(result.offsets[2]).toEqual({
      uiId: "row-2",
      top: 200 + ESTIMATED_ROW_HEIGHT_PX,
      height: 50,
    })
    expect(result.totalHeight).toBe(200 + ESTIMATED_ROW_HEIGHT_PX + 50)
  })

  test("ignores non-positive or non-finite measured heights", () => {
    const result = computeOffsets(ids(2), (id) => (id === "row-0" ? 0 : Number.NaN))
    expect(result.offsets.every((row) => row.height === ESTIMATED_ROW_HEIGHT_PX)).toBe(true)
  })

  test("handles empty rowIds", () => {
    const result = computeOffsets([], () => undefined)
    expect(result.offsets).toEqual([])
    expect(result.totalHeight).toBe(0)
  })
})

describe("computeVisibleRange", () => {
  const uniformOffsets = computeOffsets(ids(50), () => 100).offsets

  test("empty list returns empty range", () => {
    const range = computeVisibleRange({
      scrollTop: 0,
      clientHeight: 500,
      offsets: [],
    })
    expect(range).toEqual({ firstIndex: 0, lastIndex: -1, topSpacerPx: 0, bottomSpacerPx: 0 })
  })

  test("at top of scroll with default overscan includes head rows", () => {
    const range = computeVisibleRange({
      scrollTop: 0,
      clientHeight: 500,
      offsets: uniformOffsets,
    })
    expect(range.firstIndex).toBe(0)
    // overscan defaults to max(MIN_OVERSCAN_PX, clientHeight) = max(600, 500) = 600
    // visible bottom = 0 + 500 + 600 = 1100 → rows whose top <= 1100 → indices 0..11
    expect(range.lastIndex).toBe(11)
    expect(range.topSpacerPx).toBe(0)
    expect(range.bottomSpacerPx).toBe((50 - 12) * 100)
  })

  test("middle of scroll picks the right window", () => {
    const range = computeVisibleRange({
      scrollTop: 2000,
      clientHeight: 500,
      offsets: uniformOffsets,
      overscanPx: 300,
    })
    // viewportTop=1700, viewportBottom=2800
    // first row with bottom >= 1700 → row 16 (top 1600, bottom 1700)
    // last row with top <= 2800 → row 28 (top 2800)
    expect(range.firstIndex).toBe(16)
    expect(range.lastIndex).toBe(28)
    expect(range.topSpacerPx).toBe(1600)
    expect(range.bottomSpacerPx).toBe((50 - 29) * 100)
  })

  test("at bottom of scroll includes tail rows", () => {
    const range = computeVisibleRange({
      scrollTop: 100 * 50 - 500,
      clientHeight: 500,
      offsets: uniformOffsets,
      overscanPx: 200,
    })
    expect(range.lastIndex).toBe(49)
    expect(range.bottomSpacerPx).toBe(0)
  })

  test("handles mixed-height rows", () => {
    const heights = new Map<string, number>([
      ["row-0", 50],
      ["row-1", 50],
      ["row-2", 800],
      ["row-3", 50],
      ["row-4", 50],
    ])
    const offsets = computeOffsets(ids(5), (id) => heights.get(id)).offsets
    // tops: 0, 50, 100, 900, 950 ; totalHeight = 1000
    const range = computeVisibleRange({
      scrollTop: 200,
      clientHeight: 100,
      offsets,
      overscanPx: 0,
    })
    // viewportTop=200, viewportBottom=300 → only row-2 (top 100, bottom 900)
    expect(range.firstIndex).toBe(2)
    expect(range.lastIndex).toBe(2)
    expect(range.topSpacerPx).toBe(100)
    expect(range.bottomSpacerPx).toBe(100)
  })

  test("uses derived overscan that respects MIN_OVERSCAN_PX", () => {
    const offsets = computeOffsets(ids(10), () => 100).offsets
    const tiny = computeVisibleRange({
      scrollTop: 0,
      clientHeight: 10,
      offsets,
    })
    // overscan derived = max(MIN_OVERSCAN_PX, 10) = 600 → viewportBottom=610
    // rows top<=610 → indices 0..6
    expect(tiny.firstIndex).toBe(0)
    expect(tiny.lastIndex).toBe(6)
    expect(MIN_OVERSCAN_PX).toBe(600)
  })
})

describe("findRowOffset", () => {
  test("returns the row when present", () => {
    const offsets = computeOffsets(ids(3), () => 100).offsets
    expect(findRowOffset(offsets, "row-1")).toEqual({ uiId: "row-1", top: 100, height: 100 })
  })
  test("returns null when missing", () => {
    const offsets = computeOffsets(ids(3), () => 100).offsets
    expect(findRowOffset(offsets, "missing")).toBeNull()
  })
})

describe("offsetBasedScrollRestoration", () => {
  test("recovers anchor position after prepend", () => {
    // Anchor used to be 120px below the top of viewport. After prepend, its
    // new top is 500. Scroll should land at 380 so anchor still appears 120px
    // below the top.
    expect(offsetBasedScrollRestoration({ anchorTop: 500, offsetWithinViewport: 120 })).toBe(380)
  })
  test("clamps to zero when anchor is near top", () => {
    expect(offsetBasedScrollRestoration({ anchorTop: 100, offsetWithinViewport: 400 })).toBe(0)
  })
})
