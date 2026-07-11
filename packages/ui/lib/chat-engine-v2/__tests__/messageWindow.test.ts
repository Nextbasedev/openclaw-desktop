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
  sortMessagesByGatewayIndex,
} from "../messageWindow"
import { UI_INITIAL_WINDOW } from "../constants"

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

describe("animateText protection (Phase 2)", () => {
  test("animateText row is treated as protected from tail trim", () => {
    const msgs = [
      ...Array.from({ length: 350 }, (_, i) => ({ gatewayIndex: i + 1 })),
      { gatewayIndex: 351, animateText: true },
    ]
    const { dropCount } = planDropFromBottom(msgs)
    // Even though we're 51 over (351 > 300), the tail row is animating
    // — trim stops at the row before it, dropping at most 50 of the
    // requested PAGE_SIZE 60.
    expect(dropCount).toBeLessThanOrEqual(0) // tail-end animateText blocks the entire bottom drop
  })
  test("animateText row is treated as protected from head trim too", () => {
    const msgs = [
      { gatewayIndex: 1, animateText: true },
      ...Array.from({ length: 350 }, (_, i) => ({ gatewayIndex: i + 2 })),
    ]
    const { dropCount } = planDropFromTop(msgs)
    expect(dropCount).toBe(0)
  })
  test("applyTrim respects animateText protection at the tail", () => {
    const msgs = [
      ...Array.from({ length: 5 }, (_, i) => ({ gatewayIndex: i + 1 })),
      { gatewayIndex: 6, animateText: true },
      { gatewayIndex: 7 },
    ]
    // Want to drop from tail. Should stop AT the animateText row — the
    // index after the last protected row is 6 (the animateText row is
    // at index 5; everything from index 6 onward can be trimmed).
    const { trimmableTailStart } = classifyMessagesForTrim(msgs)
    expect(trimmableTailStart).toBe(6)
    // Verify: planDropFromBottom won't drop the animateText row.
    // msgs.length=7, target page=60 — trimmable tail len = 7-6 = 1.
    const trimmed = applyTrim(msgs, { dropFromBottom: 1 })
    expect(trimmed.map((m) => m.gatewayIndex)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe("sortMessagesByGatewayIndex", () => {
  test("sorts by gatewayIndex ascending", () => {
    const input = [
      { gatewayIndex: 5, id: "e" },
      { gatewayIndex: 1, id: "a" },
      { gatewayIndex: 3, id: "c" },
      { gatewayIndex: 2, id: "b" },
      { gatewayIndex: 4, id: "d" },
    ]
    expect(sortMessagesByGatewayIndex(input).map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"])
  })
  test("messages without gatewayIndex float to the tail in original order", () => {
    const input = [
      { gatewayIndex: 2, id: "b" },
      { id: "opt-1" },
      { gatewayIndex: 1, id: "a" },
      { id: "opt-2" },
    ]
    expect(sortMessagesByGatewayIndex(input).map((x) => x.id)).toEqual(["a", "b", "opt-1", "opt-2"])
  })
  test("non-finite gatewayIndex treated as missing", () => {
    const input = [
      { gatewayIndex: 2, id: "b" },
      { gatewayIndex: NaN, id: "x" },
      { gatewayIndex: 1, id: "a" },
    ]
    expect(sortMessagesByGatewayIndex(input).map((x) => x.id)).toEqual(["a", "b", "x"])
  })
  test("stable on tie", () => {
    const input = [
      { gatewayIndex: 1, id: "a1" },
      { gatewayIndex: 1, id: "a2" },
      { gatewayIndex: 1, id: "a3" },
    ]
    expect(sortMessagesByGatewayIndex(input).map((x) => x.id)).toEqual(["a1", "a2", "a3"])
  })
  test("the canonical send-from-history bug case: future-seq row past trimmed tail", () => {
    // After scrolling up several pages and trimming the tail, store has
    // seqs 100..200. User sends a message; WS patch arrives and inserts
    // canonical row at seq 2405 (past the tail). Then loadNewer brings
    // in seqs 201..260. We want the final order to be 100..200, 201..260, 2405.
    const trimmed = [10, 11, 12].map((i) => ({ gatewayIndex: i, id: `s-${i}` }))
    const wsInserted = { gatewayIndex: 2405, id: "ws" }
    const loadedNewer = [13, 14, 15].map((i) => ({ gatewayIndex: i, id: `n-${i}` }))
    const merged = [...trimmed, wsInserted, ...loadedNewer]
    const sorted = sortMessagesByGatewayIndex(merged)
    expect(sorted.map((x) => x.id)).toEqual(["s-10", "s-11", "s-12", "n-13", "n-14", "n-15", "ws"])
  })
})

describe("constants", () => {
  test("window sizing", () => {
    expect(PAGE_SIZE).toBe(100)
    expect(WINDOW_SIZE).toBe(200)
    expect(LOAD_THRESHOLD_RATIO).toBe(0.2)
  })

  test("UI_INITIAL_WINDOW is the open/bootstrap contract (160); store WINDOW_SIZE is scroll buffer headroom", () => {
    // Per imported-session 160-window plan: bootstrap + ChatView open at 160;
    // store may hold up to WINDOW_SIZE (200) while paging. Both apply to all
    // sessions (imported and normal) — no imported special-case.
    expect(UI_INITIAL_WINDOW).toBe(160)
    expect(WINDOW_SIZE).toBeGreaterThanOrEqual(UI_INITIAL_WINDOW)
  })
})

describe("Phase 3 window contract matrix", () => {
  test("open = 160, older page = 100, store buffer >= open", async () => {
    const { UI_OLDER_PAGE, UI_STORE_WINDOW } = await import("../constants")
    expect(UI_INITIAL_WINDOW).toBe(160)
    expect(UI_OLDER_PAGE).toBe(100)
    expect(UI_STORE_WINDOW).toBe(200)
    expect(UI_STORE_WINDOW).toBeGreaterThanOrEqual(UI_INITIAL_WINDOW)
    expect(WINDOW_SIZE).toBe(UI_STORE_WINDOW)
    expect(PAGE_SIZE).toBe(UI_OLDER_PAGE)
  })
})
