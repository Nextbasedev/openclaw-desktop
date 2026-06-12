import { describe, expect, test } from "vitest"
import {
  applyLiveMessageArrival,
  EXTEND_PAGE_SIZE,
  extendNewer,
  extendOlder,
  findMessageIndexById,
  initialSliceWindow,
  MAX_SLICE_SIZE,
  pinToNewest,
  recenterAround,
  SLICE_SIZE,
  sliceMessages,
  TRIM_BATCH_SIZE,
} from "../messageSlice"

const buildMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    uiId: `ui-${i}`,
    messageId: `msg-${i}`,
    seq: i + 1,
  }))

describe("initialSliceWindow", () => {
  test("empty -> empty window pinned to newest", () => {
    expect(initialSliceWindow(0)).toEqual({ startIndex: 0, endIndex: -1, isAtNewest: true })
  })
  test("fewer than slice size -> covers whole array", () => {
    expect(initialSliceWindow(5)).toEqual({ startIndex: 0, endIndex: 4, isAtNewest: true })
  })
  test("larger than slice size -> last SLICE_SIZE rows", () => {
    const win = initialSliceWindow(500)
    expect(win.endIndex).toBe(499)
    expect(win.startIndex).toBe(500 - SLICE_SIZE)
    expect(win.isAtNewest).toBe(true)
  })
})

describe("sliceMessages", () => {
  test("slices canonical array by inclusive bounds", () => {
    const msgs = buildMessages(10)
    const sliced = sliceMessages(msgs, { startIndex: 3, endIndex: 6, isAtNewest: false })
    expect(sliced).toHaveLength(4)
    expect(sliced[0].messageId).toBe("msg-3")
    expect(sliced[3].messageId).toBe("msg-6")
  })
  test("returns empty when window is empty", () => {
    expect(sliceMessages([1, 2, 3], { startIndex: 0, endIndex: -1, isAtNewest: true })).toEqual([])
  })
})

describe("extendOlder", () => {
  test("grows toward older messages and keeps tail when under cap", () => {
    const totalMessages = 500
    const start = initialSliceWindow(totalMessages)
    const result = extendOlder(start, totalMessages)
    expect(result.window.startIndex).toBe(start.startIndex - EXTEND_PAGE_SIZE)
    expect(result.window.endIndex).toBe(start.endIndex)
    expect(result.window.isAtNewest).toBe(true)
    expect(result.trimmed).toBe(false)
    expect(result.reachedStart).toBe(false)
    expect(result.reachedEnd).toBe(true)
  })

  test("trims newest end once over MAX_SLICE_SIZE", () => {
    const totalMessages = 500
    let win = initialSliceWindow(totalMessages)
    // After two extends, slice length = SLICE_SIZE + 2*EXTEND_PAGE_SIZE = 120, still <= MAX.
    win = extendOlder(win, totalMessages).window
    win = extendOlder(win, totalMessages).window
    expect(win.endIndex - win.startIndex + 1).toBe(SLICE_SIZE + 2 * EXTEND_PAGE_SIZE)
    expect(win.endIndex - win.startIndex + 1).toBe(MAX_SLICE_SIZE)
    // Third extend pushes over the cap -> trim from newest end.
    const third = extendOlder(win, totalMessages)
    expect(third.trimmed).toBe(true)
    expect(third.window.endIndex).toBe(win.endIndex - TRIM_BATCH_SIZE)
    expect(third.window.isAtNewest).toBe(false)
  })

  test("preserveTail keeps newest row pinned even past MAX_SLICE_SIZE", () => {
    const totalMessages = 500
    let win = initialSliceWindow(totalMessages)
    win = extendOlder(win, totalMessages).window
    win = extendOlder(win, totalMessages).window
    const r = extendOlder(win, totalMessages, { preserveTail: true })
    expect(r.trimmed).toBe(false)
    expect(r.window.endIndex).toBe(totalMessages - 1)
    expect(r.window.isAtNewest).toBe(true)
    // Window can exceed the soft cap when preserveTail is on (caller knows).
    expect(r.window.endIndex - r.window.startIndex + 1).toBeGreaterThan(MAX_SLICE_SIZE)
  })

  test("reports reachedStart when we hit the beginning", () => {
    const totalMessages = 80
    let win = initialSliceWindow(totalMessages)
    expect(win.startIndex).toBe(20)
    win = extendOlder(win, totalMessages).window
    expect(win.startIndex).toBe(0)
    const r = extendOlder(win, totalMessages)
    expect(r.reachedStart).toBe(true)
    expect(r.window.startIndex).toBe(0)
  })

  test("empty array -> empty window result", () => {
    const r = extendOlder({ startIndex: 0, endIndex: -1, isAtNewest: true }, 0)
    expect(r.window).toEqual({ startIndex: 0, endIndex: -1, isAtNewest: true })
    expect(r.reachedStart).toBe(true)
    expect(r.reachedEnd).toBe(true)
  })
})

describe("extendNewer", () => {
  test("grows toward newer messages and trims oldest beyond cap", () => {
    const totalMessages = 500
    // Start far back: pretend user already scrolled up.
    let win = { startIndex: 100, endIndex: 100 + SLICE_SIZE - 1, isAtNewest: false }
    win = extendNewer(win, totalMessages).window
    win = extendNewer(win, totalMessages).window
    expect(win.endIndex - win.startIndex + 1).toBe(MAX_SLICE_SIZE)
    const third = extendNewer(win, totalMessages)
    expect(third.trimmed).toBe(true)
    expect(third.window.startIndex).toBe(win.startIndex + TRIM_BATCH_SIZE)
  })
  test("clamps at last index and reports reachedEnd", () => {
    const totalMessages = 100
    const win = { startIndex: 50, endIndex: 79, isAtNewest: false }
    const r = extendNewer(win, totalMessages)
    expect(r.window.endIndex).toBe(99)
    expect(r.window.isAtNewest).toBe(true)
    expect(r.reachedEnd).toBe(true)
  })
})

describe("recenterAround", () => {
  test("centers around target", () => {
    const win = recenterAround(1000, 500)
    expect(win.startIndex).toBe(500 - Math.floor(SLICE_SIZE / 2))
    expect(win.endIndex - win.startIndex + 1).toBe(SLICE_SIZE)
    expect(win.isAtNewest).toBe(false)
  })
  test("near top clamps to zero start", () => {
    const win = recenterAround(1000, 5)
    expect(win.startIndex).toBe(0)
    expect(win.endIndex).toBe(SLICE_SIZE - 1)
  })
  test("near end pins to newest", () => {
    const win = recenterAround(1000, 999)
    expect(win.endIndex).toBe(999)
    expect(win.startIndex).toBe(1000 - SLICE_SIZE)
    expect(win.isAtNewest).toBe(true)
  })
  test("out-of-bounds target falls back to initial window", () => {
    const win = recenterAround(100, 500)
    expect(win).toEqual(initialSliceWindow(100))
  })
})

describe("applyLiveMessageArrival", () => {
  test("extends end without trimming head while window stays under cap", () => {
    const totalMessages = 500
    const win = initialSliceWindow(totalMessages)
    // Pretend the array grew by 1 (a new live message arrived).
    const next = applyLiveMessageArrival(win, totalMessages + 1)
    expect(next.endIndex).toBe(totalMessages)
    expect(next.isAtNewest).toBe(true)
    // Slice extended to include the new row; head is unchanged because
    // window is still under the soft cap (60 + 1 < 120).
    expect(next.startIndex).toBe(win.startIndex)
    expect(next.endIndex - next.startIndex + 1).toBe(SLICE_SIZE + 1)
    expect(next.endIndex - next.startIndex + 1).toBeLessThanOrEqual(MAX_SLICE_SIZE)
  })

  test("trims head once cumulative arrivals push slice past MAX_SLICE_SIZE", () => {
    // Manually grow the window via repeated arrivals until we cross the cap.
    const baseTotal = 500
    let win = initialSliceWindow(baseTotal)
    let total = baseTotal
    // Simulate enough live arrivals that the slice would otherwise exceed MAX_SLICE_SIZE.
    for (let i = 0; i < MAX_SLICE_SIZE; i += 1) {
      total += 1
      win = applyLiveMessageArrival(win, total)
      expect(win.endIndex - win.startIndex + 1).toBeLessThanOrEqual(MAX_SLICE_SIZE + TRIM_BATCH_SIZE)
    }
    // Final window must respect MAX_SLICE_SIZE (head was trimmed at some point).
    expect(win.endIndex - win.startIndex + 1).toBeLessThanOrEqual(MAX_SLICE_SIZE)
    expect(win.isAtNewest).toBe(true)
    expect(win.endIndex).toBe(total - 1)
  })

  test("no-op when user is scrolled into history", () => {
    const win = { startIndex: 50, endIndex: 50 + SLICE_SIZE - 1, isAtNewest: false }
    expect(applyLiveMessageArrival(win, 500)).toBe(win)
  })

  test("empty array → empty window", () => {
    expect(applyLiveMessageArrival({ startIndex: 0, endIndex: -1, isAtNewest: true }, 0))
      .toEqual({ startIndex: 0, endIndex: -1, isAtNewest: true })
  })
})

describe("pinToNewest", () => {
  test("matches initialSliceWindow", () => {
    expect(pinToNewest(500)).toEqual(initialSliceWindow(500))
  })
})

describe("findMessageIndexById", () => {
  const messages = buildMessages(5)
  test("matches by uiId", () => {
    expect(findMessageIndexById(messages, "ui-2")).toBe(2)
  })
  test("matches by messageId", () => {
    expect(findMessageIndexById(messages, "msg-4")).toBe(4)
  })
  test("returns -1 on miss", () => {
    expect(findMessageIndexById(messages, "nope")).toBe(-1)
  })
})
