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
  // With Krish's spec (SLICE_SIZE === MAX_SLICE_SIZE) every extend trims the
  // opposite end immediately: the window slides backward by EXTEND_PAGE_SIZE
  // and the mounted count stays exactly SLICE_SIZE.
  test("slides window backward by EXTEND_PAGE_SIZE and trims the tail", () => {
    const totalMessages = 500
    const start = initialSliceWindow(totalMessages)
    const result = extendOlder(start, totalMessages)
    expect(result.window.startIndex).toBe(start.startIndex - EXTEND_PAGE_SIZE)
    expect(result.window.endIndex).toBe(start.endIndex - TRIM_BATCH_SIZE)
    expect(result.window.endIndex - result.window.startIndex + 1).toBe(SLICE_SIZE)
    expect(result.window.isAtNewest).toBe(false)
    expect(result.trimmed).toBe(true)
    expect(result.reachedStart).toBe(false)
  })

  test("keeps mounted count constant across many extends", () => {
    const totalMessages = 2000
    let win = initialSliceWindow(totalMessages)
    for (let i = 0; i < 5; i += 1) {
      win = extendOlder(win, totalMessages).window
      expect(win.endIndex - win.startIndex + 1).toBe(SLICE_SIZE)
    }
    // After 5 backward slides, start moved back by 5 * EXTEND_PAGE_SIZE.
    expect(win.startIndex).toBe(totalMessages - SLICE_SIZE - 5 * EXTEND_PAGE_SIZE)
  })

  test("preserveTail keeps newest row pinned even when window grows past cap", () => {
    const totalMessages = 2000
    const start = initialSliceWindow(totalMessages)
    const r = extendOlder(start, totalMessages, { preserveTail: true })
    // Tail preserved: endIndex still at last index.
    expect(r.window.endIndex).toBe(totalMessages - 1)
    expect(r.window.isAtNewest).toBe(true)
    // Start moved back, so window has temporarily grown beyond MAX_SLICE_SIZE
    // (this is the streaming-protect path — caller knows to allow it).
    expect(r.trimmed).toBe(false)
    expect(r.window.endIndex - r.window.startIndex + 1).toBeGreaterThan(MAX_SLICE_SIZE)
  })

  test("reports reachedStart when we hit the beginning", () => {
    const totalMessages = 250
    let win = initialSliceWindow(totalMessages)
    expect(win.startIndex).toBe(totalMessages - SLICE_SIZE)
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
  test("slides window forward by EXTEND_PAGE_SIZE and trims the head", () => {
    const totalMessages = 2000
    let win = { startIndex: 500, endIndex: 500 + SLICE_SIZE - 1, isAtNewest: false }
    const r = extendNewer(win, totalMessages)
    expect(r.window.startIndex).toBe(500 + TRIM_BATCH_SIZE)
    expect(r.window.endIndex).toBe(500 + SLICE_SIZE - 1 + EXTEND_PAGE_SIZE)
    expect(r.window.endIndex - r.window.startIndex + 1).toBe(SLICE_SIZE)
    expect(r.trimmed).toBe(true)
  })
  test("clamps at last index and reports reachedEnd", () => {
    const totalMessages = 250
    const win = { startIndex: 50, endIndex: 200, isAtNewest: false }
    const r = extendNewer(win, totalMessages)
    expect(r.window.endIndex).toBe(249)
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
  test("trims head by exactly the overflow on each live arrival", () => {
    // Window starts already at MAX. A single live arrival should slide the
    // head forward by exactly 1 row (overflow), not by TRIM_BATCH_SIZE —
    // batching the trim caused a visible blink (100 rows vanishing for one
    // new message). 2026-06-13 fix.
    const totalMessages = 500
    const win = initialSliceWindow(totalMessages)
    expect(win.endIndex - win.startIndex + 1).toBe(MAX_SLICE_SIZE)
    const next = applyLiveMessageArrival(win, totalMessages + 1)
    expect(next.endIndex).toBe(totalMessages)
    expect(next.isAtNewest).toBe(true)
    expect(next.startIndex).toBe(win.startIndex + 1)
    expect(next.endIndex - next.startIndex + 1).toBe(MAX_SLICE_SIZE)
  })

  test("stays bounded as many arrivals stream in", () => {
    let total = 500
    let win = initialSliceWindow(total)
    for (let i = 0; i < 1000; i += 1) {
      total += 1
      win = applyLiveMessageArrival(win, total)
      expect(win.endIndex - win.startIndex + 1).toBeLessThanOrEqual(MAX_SLICE_SIZE)
    }
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
