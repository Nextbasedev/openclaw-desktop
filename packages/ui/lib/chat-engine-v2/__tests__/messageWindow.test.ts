import { describe, test, expect } from "vitest"
import {
  PAGE_SIZE,
  WINDOW_SIZE,
  LOAD_THRESHOLD_RATIO,
  pageDropCount,
  classifyMessagesForTrim,
  planDropFromTop,
  planDropFromBottom,
  applyTrim,
  detectEdgeProximity,
} from "../messageWindow"

type Msg = { gatewayIndex?: number; isOptimistic?: boolean; sendStatus?: string }

function msgs(n: number, startSeq = 0): Msg[] {
  return Array.from({ length: n }, (_, i) => ({ gatewayIndex: startSeq + i }))
}

describe("pageDropCount", () => {
  test("returns 0 when under window size", () => {
    expect(pageDropCount(WINDOW_SIZE)).toBe(0)
    expect(pageDropCount(0)).toBe(0)
    expect(pageDropCount(WINDOW_SIZE - 1)).toBe(0)
  })
  test("returns PAGE_SIZE when one page over", () => {
    expect(pageDropCount(WINDOW_SIZE + 1)).toBe(PAGE_SIZE)
    expect(pageDropCount(WINDOW_SIZE + PAGE_SIZE)).toBe(PAGE_SIZE)
  })
  test("custom page/window sizes respected", () => {
    expect(pageDropCount(100, { pageSize: 10, windowSize: 50 })).toBe(10)
    expect(pageDropCount(50, { pageSize: 10, windowSize: 50 })).toBe(0)
  })
})

describe("classifyMessagesForTrim", () => {
  test("no protected messages → fully trimmable on both ends", () => {
    const m = msgs(10)
    const { trimmableHeadEnd, trimmableTailStart } = classifyMessagesForTrim(m)
    expect(trimmableHeadEnd).toBe(10)
    expect(trimmableTailStart).toBe(0)
  })
  test("optimistic at end → head fully trimmable, tail protected from optimistic onward", () => {
    const m: Msg[] = [...msgs(8), { isOptimistic: true }, { isOptimistic: true }]
    const { trimmableHeadEnd, trimmableTailStart } = classifyMessagesForTrim(m)
    expect(trimmableHeadEnd).toBe(8) // first 8 trimmable from top
    expect(trimmableTailStart).toBe(10) // nothing trimmable from bottom
  })
  test("sendStatus is treated as protected", () => {
    const m: Msg[] = [...msgs(5), { sendStatus: "pending" }]
    const { trimmableHeadEnd, trimmableTailStart } = classifyMessagesForTrim(m)
    expect(trimmableHeadEnd).toBe(5)
    expect(trimmableTailStart).toBe(6)
  })
  test("protected in middle limits trim ends", () => {
    const m: Msg[] = [...msgs(3), { isOptimistic: true }, ...msgs(3, 10)]
    const { trimmableHeadEnd, trimmableTailStart } = classifyMessagesForTrim(m)
    // First protected at index 3 → trimmableHeadEnd = 3
    expect(trimmableHeadEnd).toBe(3)
    // Last protected at index 3 → trimmableTailStart = 4
    expect(trimmableTailStart).toBe(4)
  })
})

describe("planDropFromTop", () => {
  test("no drop when under window size", () => {
    expect(planDropFromTop(msgs(WINDOW_SIZE))).toEqual({ dropCount: 0 })
  })
  test("drops one page when over", () => {
    expect(planDropFromTop(msgs(WINDOW_SIZE + PAGE_SIZE))).toEqual({ dropCount: PAGE_SIZE })
  })
  test("clamps when protected message is near top", () => {
    // 10 protected from index 30 onwards; only 30 trimmable from top.
    const m: Msg[] = [
      ...msgs(30),
      ...Array.from({ length: WINDOW_SIZE }, (): Msg => ({ isOptimistic: true })),
    ]
    expect(planDropFromTop(m)).toEqual({ dropCount: 30 })
  })
})

describe("planDropFromBottom", () => {
  test("drops one page from bottom when over", () => {
    expect(planDropFromBottom(msgs(WINDOW_SIZE + PAGE_SIZE))).toEqual({ dropCount: PAGE_SIZE })
  })
  test("never trims trailing optimistic messages", () => {
    const m: Msg[] = [
      ...msgs(WINDOW_SIZE),
      ...Array.from({ length: PAGE_SIZE }, (): Msg => ({ isOptimistic: true })),
    ]
    // total > WINDOW_SIZE, target drop = PAGE_SIZE. But none of the
    // trailing rows are trimmable.
    expect(planDropFromBottom(m)).toEqual({ dropCount: 0 })
  })
})

describe("applyTrim", () => {
  test("drops correct messages from both ends", () => {
    const m = msgs(10)
    const result = applyTrim(m, { dropFromTop: 2, dropFromBottom: 3 })
    expect(result.map((x) => x.gatewayIndex)).toEqual([2, 3, 4, 5, 6])
  })
  test("no-op when both zero", () => {
    const m = msgs(5)
    expect(applyTrim(m, {}).map((x) => x.gatewayIndex)).toEqual([0, 1, 2, 3, 4])
  })
  test("negative inputs clamped to zero", () => {
    const m = msgs(3)
    expect(applyTrim(m, { dropFromTop: -1, dropFromBottom: -5 }).map((x) => x.gatewayIndex)).toEqual([0, 1, 2])
  })
})

describe("detectEdgeProximity", () => {
  const H = 1000
  const C = 400
  // scrollHeight - clientHeight = 600 (max scrollTop)
  test("returns null when not near either edge", () => {
    expect(detectEdgeProximity({ scrollTop: 300, scrollHeight: H, clientHeight: C })).toBeNull()
  })
  test("returns 'top' when within ratio of top", () => {
    // ratio default 0.2; 0.2 * 1000 = 200; scrollTop <= 200
    expect(detectEdgeProximity({ scrollTop: 150, scrollHeight: H, clientHeight: C })).toBe("top")
    expect(detectEdgeProximity({ scrollTop: 0, scrollHeight: H, clientHeight: C })).toBe("top")
  })
  test("returns 'bottom' when within ratio of bottom", () => {
    // fromBottom = 600 - scrollTop; threshold = 200
    expect(detectEdgeProximity({ scrollTop: 500, scrollHeight: H, clientHeight: C })).toBe("bottom")
    expect(detectEdgeProximity({ scrollTop: 600, scrollHeight: H, clientHeight: C })).toBe("bottom")
  })
  test("returns null when scrollHeight <= clientHeight", () => {
    expect(detectEdgeProximity({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBeNull()
  })
  test("custom threshold ratio respected", () => {
    expect(detectEdgeProximity({ scrollTop: 50, scrollHeight: H, clientHeight: C, thresholdRatio: 0.05 })).toBe("top")
    expect(detectEdgeProximity({ scrollTop: 100, scrollHeight: H, clientHeight: C, thresholdRatio: 0.05 })).toBeNull()
  })
})

describe("constants", () => {
  test("window sizing", () => {
    expect(PAGE_SIZE).toBe(60)
    expect(WINDOW_SIZE).toBe(300)
    expect(LOAD_THRESHOLD_RATIO).toBe(0.2)
  })
})
