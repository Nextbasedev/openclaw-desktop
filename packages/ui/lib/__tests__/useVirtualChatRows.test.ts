import { describe, expect, it } from "vitest"
import { calculateVirtualRows } from "../../components/ChatView/useVirtualChatRows"

describe("calculateVirtualRows", () => {
  it("renders only the visible rows plus overscan", () => {
    const result = calculateVirtualRows({
      count: 100,
      scrollTop: 1_000,
      viewportHeight: 300,
      overscan: 2,
      getKey: (index) => `row-${index}`,
      getSize: () => 100,
    })

    expect(result.totalSize).toBe(10_000)
    expect(result.startIndex).toBe(7)
    expect(result.endIndex).toBe(16)
    expect(result.rows.map((row) => row.index)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
    expect(result.rows[0]).toMatchObject({
      key: "row-7",
      start: 700,
      size: 100,
    })
  })

  it("uses measured variable heights when calculating offsets", () => {
    const sizes = [50, 150, 75, 300, 100]
    const result = calculateVirtualRows({
      count: sizes.length,
      scrollTop: 180,
      viewportHeight: 120,
      overscan: 1,
      getKey: (index) => `row-${index}`,
      getSize: (index) => sizes[index],
    })

    expect(result.totalSize).toBe(675)
    expect(result.rows.map((row) => [row.index, row.start, row.size])).toEqual([
      [0, 0, 50],
      [1, 50, 150],
      [2, 200, 75],
      [3, 275, 300],
      [4, 575, 100],
    ])
  })

  it("keeps explicit anchor rows mounted outside the visible window", () => {
    const result = calculateVirtualRows({
      count: 100,
      scrollTop: 1_000,
      viewportHeight: 300,
      overscan: 1,
      getKey: (index) => `row-${index}`,
      getSize: () => 100,
      extraIndexes: [30],
    })

    expect(result.rows.map((row) => row.index)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 30,
    ])
    expect(result.rows.at(-1)).toMatchObject({
      key: "row-30",
      start: 3_000,
      size: 100,
    })
  })
})
