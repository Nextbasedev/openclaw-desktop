import { describe, expect, it } from "vitest"
import { computeVirtualRange } from "../virtualMessageList"

describe("computeVirtualRange", () => {
  it("renders only the visible range plus overscan", () => {
    const range = computeVirtualRange({
      count: 1000,
      scrollTop: 5_000,
      viewportHeight: 800,
      getHeight: () => 100,
      gapPx: 0,
      overscanPx: 200,
    })

    expect(range.startIndex).toBeLessThanOrEqual(48)
    expect(range.endIndex).toBeGreaterThanOrEqual(58)
    expect(range.endIndex - range.startIndex).toBeLessThan(20)
    expect(range.totalHeight).toBe(100_000)
  })

  it("keeps at least one item rendered", () => {
    const range = computeVirtualRange({
      count: 1,
      scrollTop: 10_000,
      viewportHeight: 500,
      getHeight: () => 120,
    })

    expect(range.startIndex).toBe(0)
    expect(range.endIndex).toBe(1)
  })
})
