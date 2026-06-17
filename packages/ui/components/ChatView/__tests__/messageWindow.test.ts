import { afterEach, describe, expect, test, vi } from "vitest"
import {
  applyInitialPage,
  applyLiveAppend,
  applyNewerPage,
  applyOlderPage,
  canEvictFromStartOnLiveAppend,
  canEvictOnLiveAppend,
  centeredWindowQuery,
  computeEvictedAfterAppend,
  computeEvictedAfterPrepend,
  computeNewerPageEvictedFromStart,
  INITIAL_PAGE,
  INITIAL_WINDOW_STATE,
  isFetchRefractory,
  liveTailQuery,
  MAX_BUFFER,
  MAX_LOADED,
  OLDER_PAGE,
  REFRACTORY_MS,
  shouldDropPatchAsEvicted,
  shouldFetchNewer,
  shouldFetchOlder,
  TOP_TRIGGER,
  type WindowState,
} from "../messageWindow"

describe("constants", () => {
  test("have the documented values", () => {
    expect(MAX_LOADED).toBe(160)
    expect(INITIAL_PAGE).toBe(160)
    expect(OLDER_PAGE).toBe(100)
    expect(TOP_TRIGGER).toBe(60)
  })

  test("INITIAL_WINDOW_STATE has all fields zeroed/null/false", () => {
    expect(INITIAL_WINDOW_STATE).toEqual({
      oldestLoadedSeq: null,
      newestLoadedSeq: null,
      hasOlder: false,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })
})

describe("computeEvictedAfterPrepend", () => {
  test("0 + 0 = 0 evicted", () => {
    expect(computeEvictedAfterPrepend(0, 0)).toBe(0)
  })

  test("100 + 50 = 0 evicted (under cap)", () => {
    expect(computeEvictedAfterPrepend(100, 50)).toBe(0)
  })

  test("160 + 0 = 0 evicted (exactly at cap)", () => {
    expect(computeEvictedAfterPrepend(160, 0)).toBe(0)
  })

  test("160 + 100 = 100 evicted", () => {
    expect(computeEvictedAfterPrepend(160, 100)).toBe(100)
  })

  test("200 + 0 = 40 evicted (over cap already, returns overflow)", () => {
    expect(computeEvictedAfterPrepend(200, 0)).toBe(40)
  })

  test("custom maxLoaded respected", () => {
    expect(computeEvictedAfterPrepend(50, 50, 80)).toBe(20)
    expect(computeEvictedAfterPrepend(50, 30, 80)).toBe(0)
  })

  test("never returns a negative number", () => {
    expect(computeEvictedAfterPrepend(0, 0)).toBeGreaterThanOrEqual(0)
    expect(computeEvictedAfterPrepend(10, 5)).toBeGreaterThanOrEqual(0)
    expect(computeEvictedAfterPrepend(0, 0, 1000)).toBeGreaterThanOrEqual(0)
  })
})

describe("computeEvictedAfterAppend", () => {
  test("0 + 0 = 0 evicted", () => {
    expect(computeEvictedAfterAppend(0, 0)).toBe(0)
  })

  test("100 + 50 = 0 evicted (under cap)", () => {
    expect(computeEvictedAfterAppend(100, 50)).toBe(0)
  })

  test("160 + 0 = 0 evicted (exactly at cap)", () => {
    expect(computeEvictedAfterAppend(160, 0)).toBe(0)
  })

  test("160 + 100 = 100 evicted", () => {
    expect(computeEvictedAfterAppend(160, 100)).toBe(100)
  })

  test("200 + 0 = 40 evicted (over cap already)", () => {
    expect(computeEvictedAfterAppend(200, 0)).toBe(40)
  })

  test("custom maxLoaded respected", () => {
    expect(computeEvictedAfterAppend(50, 50, 80)).toBe(20)
    expect(computeEvictedAfterAppend(50, 30, 80)).toBe(0)
  })

  test("never returns a negative number", () => {
    expect(computeEvictedAfterAppend(0, 0)).toBeGreaterThanOrEqual(0)
    expect(computeEvictedAfterAppend(10, 5)).toBeGreaterThanOrEqual(0)
  })
})

describe("shouldFetchOlder", () => {
  const happy = {
    rowsAboveViewport: 10,
    hasOlder: true,
    isLoadingOlder: false,
  }

  test("returns true when all triggers happy", () => {
    expect(shouldFetchOlder(happy)).toBe(true)
  })

  test("returns false when hasOlder is false, even at rowsAboveViewport=0", () => {
    expect(
      shouldFetchOlder({
        rowsAboveViewport: 0,
        hasOlder: false,
        isLoadingOlder: false,
      }),
    ).toBe(false)
  })

  test("returns false when isLoadingOlder is true", () => {
    expect(shouldFetchOlder({ ...happy, isLoadingOlder: true })).toBe(false)
  })

  test("returns false at rowsAboveViewport=61 (over default threshold)", () => {
    expect(shouldFetchOlder({ ...happy, rowsAboveViewport: 61 })).toBe(false)
  })

  test("returns true at rowsAboveViewport=60 (exactly threshold)", () => {
    expect(shouldFetchOlder({ ...happy, rowsAboveViewport: 60 })).toBe(true)
  })

  test("returns true at rowsAboveViewport=0", () => {
    expect(shouldFetchOlder({ ...happy, rowsAboveViewport: 0 })).toBe(true)
  })

  test("custom threshold respected", () => {
    expect(
      shouldFetchOlder({ ...happy, rowsAboveViewport: 30, threshold: 30 }),
    ).toBe(true)
    expect(
      shouldFetchOlder({ ...happy, rowsAboveViewport: 31, threshold: 30 }),
    ).toBe(false)
  })
})

describe("shouldFetchNewer", () => {
  const happy = {
    rowsBelowViewport: 10,
    hasNewer: true,
    isLoadingNewer: false,
  }

  test("returns true when all triggers happy", () => {
    expect(shouldFetchNewer(happy)).toBe(true)
  })

  test("returns false when hasNewer is false", () => {
    expect(
      shouldFetchNewer({
        rowsBelowViewport: 0,
        hasNewer: false,
        isLoadingNewer: false,
      }),
    ).toBe(false)
  })

  test("returns false when isLoadingNewer is true", () => {
    expect(shouldFetchNewer({ ...happy, isLoadingNewer: true })).toBe(false)
  })

  test("returns false at rowsBelowViewport=61 (over default newer threshold)", () => {
    expect(shouldFetchNewer({ ...happy, rowsBelowViewport: 61 })).toBe(false)
  })

  test("returns true at rowsBelowViewport=60 (exactly newer threshold)", () => {
    expect(shouldFetchNewer({ ...happy, rowsBelowViewport: 60 })).toBe(true)
  })

  test("returns true at rowsBelowViewport=0", () => {
    expect(shouldFetchNewer({ ...happy, rowsBelowViewport: 0 })).toBe(true)
  })

  test("custom threshold respected", () => {
    expect(
      shouldFetchNewer({ ...happy, rowsBelowViewport: 30, threshold: 30 }),
    ).toBe(true)
    expect(
      shouldFetchNewer({ ...happy, rowsBelowViewport: 31, threshold: 30 }),
    ).toBe(false)
  })
})

describe("applyInitialPage server-flag preference (BUG-3)", () => {
  const restoreEnv = process.env.NODE_ENV
  afterEach(() => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = restoreEnv
  })

  test("server hasOlder=false beats count heuristic when 160 returned (exact-fit)", () => {
    // Current heuristic: returnedCount(160) >= 160 → hasOlder=true.
    // Server knows this is the absolute top → hasOlder=false.
    const state = applyInitialPage({
      returnedCount: 160,
      oldestSeq: 1,
      newestSeq: 160,
      serverHasOlder: false,
    })
    expect(state.hasOlder).toBe(false)
  })

  test("server hasOlder=true beats count heuristic when fewer than limit returned", () => {
    // Current heuristic: 159 < 160 → hasOlder=false. Server says there is
    // older history (normalizeHistory filtered a row, or the page was short).
    const state = applyInitialPage({
      returnedCount: 159,
      oldestSeq: 2,
      newestSeq: 160,
      serverHasOlder: true,
    })
    expect(state.hasOlder).toBe(true)
  })

  test("no server flag: falls back to count heuristic (no warn in test env)", () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "test"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = applyInitialPage({
      returnedCount: 160,
      oldestSeq: 1,
      newestSeq: 160,
    })
    expect(state.hasOlder).toBe(true)
    // Warn is gated on NODE_ENV === "development", so test env stays quiet.
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("no server flag in development: falls back AND emits dev warn", () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "development"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    applyInitialPage({
      returnedCount: 80,
      oldestSeq: 1,
      newestSeq: 80,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[chat-rebuild.window] server envelope missing hasOlder"),
    )
    warnSpy.mockRestore()
  })
})

describe("applyInitialPage", () => {
  test("empty session: hasOlder=false, seqs null, hasNewer=false", () => {
    expect(
      applyInitialPage({
        returnedCount: 0,
        oldestSeq: null,
        newestSeq: null,
      }),
    ).toEqual({
      oldestLoadedSeq: null,
      newestLoadedSeq: null,
      hasOlder: false,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })

  test("returned exactly limit (160): hasOlder=true", () => {
    const state = applyInitialPage({
      returnedCount: 160,
      oldestSeq: 100,
      newestSeq: 259,
    })
    expect(state.hasOlder).toBe(true)
    expect(state.oldestLoadedSeq).toBe(100)
    expect(state.newestLoadedSeq).toBe(259)
    expect(state.hasNewer).toBe(false)
    expect(state.isLoadingOlder).toBe(false)
    expect(state.isLoadingNewer).toBe(false)
  })

  test("returned less than limit (47): hasOlder=false", () => {
    const state = applyInitialPage({
      returnedCount: 47,
      oldestSeq: 1,
      newestSeq: 47,
    })
    expect(state.hasOlder).toBe(false)
  })

  test("custom requestedLimit respected", () => {
    expect(
      applyInitialPage({
        returnedCount: 80,
        oldestSeq: 1,
        newestSeq: 80,
        requestedLimit: 80,
      }).hasOlder,
    ).toBe(true)

    expect(
      applyInitialPage({
        returnedCount: 79,
        oldestSeq: 1,
        newestSeq: 79,
        requestedLimit: 80,
      }).hasOlder,
    ).toBe(false)
  })
})

describe("applyOlderPage", () => {
  const baseState: WindowState = {
    oldestLoadedSeq: 100,
    newestLoadedSeq: 259,
    hasOlder: true,
    hasNewer: false,
    isLoadingOlder: true,
    isLoadingNewer: false,
  }

  test("prepended 100, no eviction (currentLength was 50): hasNewer unchanged", () => {
    const state = applyOlderPage({
      prevState: baseState,
      returnedCount: 100,
      newOldestSeq: 0,
      prevLoadedLength: 50,
      evictedFromEnd: 0,
      evictedNewestSeq: null,
    })
    expect(state.hasNewer).toBe(false)
    expect(state.newestLoadedSeq).toBe(259)
    expect(state.oldestLoadedSeq).toBe(0)
  })

  test("prepended 100, evicted 100 from end (currentLength was 160): hasNewer=true", () => {
    const state = applyOlderPage({
      prevState: baseState,
      returnedCount: 100,
      newOldestSeq: 0,
      prevLoadedLength: 160,
      evictedFromEnd: 100,
      evictedNewestSeq: 159,
    })
    expect(state.hasNewer).toBe(true)
    expect(state.newestLoadedSeq).toBe(159)
    expect(state.oldestLoadedSeq).toBe(0)
  })

  test("returned 100 (== limit): hasOlder=true", () => {
    expect(
      applyOlderPage({
        prevState: baseState,
        returnedCount: 100,
        newOldestSeq: 0,
        prevLoadedLength: 50,
        evictedFromEnd: 0,
        evictedNewestSeq: null,
      }).hasOlder,
    ).toBe(true)
  })

  test("returned 47 (< limit): hasOlder=false", () => {
    expect(
      applyOlderPage({
        prevState: baseState,
        returnedCount: 47,
        newOldestSeq: 0,
        prevLoadedLength: 50,
        evictedFromEnd: 0,
        evictedNewestSeq: null,
      }).hasOlder,
    ).toBe(false)
  })

  test("evictedNewestSeq only used when evictedFromEnd > 0", () => {
    const state = applyOlderPage({
      prevState: baseState,
      returnedCount: 50,
      newOldestSeq: 50,
      prevLoadedLength: 50,
      evictedFromEnd: 0,
      // even if a value is passed here, it must be ignored when evictedFromEnd === 0
      evictedNewestSeq: 999,
    })
    expect(state.newestLoadedSeq).toBe(259)
  })

  test("isLoadingOlder set to false; isLoadingNewer carried over from prevState", () => {
    const prev: WindowState = { ...baseState, isLoadingNewer: true }
    const state = applyOlderPage({
      prevState: prev,
      returnedCount: 0,
      newOldestSeq: null,
      prevLoadedLength: 0,
      evictedFromEnd: 0,
      evictedNewestSeq: null,
    })
    expect(state.isLoadingOlder).toBe(false)
    expect(state.isLoadingNewer).toBe(true)
  })

  test("newOldestSeq null falls back to prevState.oldestLoadedSeq", () => {
    const state = applyOlderPage({
      prevState: baseState,
      returnedCount: 0,
      newOldestSeq: null,
      prevLoadedLength: 50,
      evictedFromEnd: 0,
      evictedNewestSeq: null,
    })
    expect(state.oldestLoadedSeq).toBe(100)
  })

  test("custom requestedLimit respected", () => {
    expect(
      applyOlderPage({
        prevState: baseState,
        returnedCount: 50,
        newOldestSeq: 50,
        prevLoadedLength: 50,
        evictedFromEnd: 0,
        evictedNewestSeq: null,
        requestedLimit: 50,
      }).hasOlder,
    ).toBe(true)
  })
})

describe("applyNewerPage", () => {
  const baseState: WindowState = {
    oldestLoadedSeq: 100,
    newestLoadedSeq: 259,
    hasOlder: false,
    hasNewer: true,
    isLoadingOlder: false,
    isLoadingNewer: true,
  }

  test("appended 100, no eviction: hasOlder unchanged", () => {
    const state = applyNewerPage({
      prevState: baseState,
      returnedCount: 100,
      newNewestSeq: 359,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state.hasOlder).toBe(false)
    expect(state.oldestLoadedSeq).toBe(100)
    expect(state.newestLoadedSeq).toBe(359)
  })

  test("appended 100, evicted 100 from start: hasOlder=true", () => {
    const state = applyNewerPage({
      prevState: baseState,
      returnedCount: 100,
      newNewestSeq: 359,
      evictedFromStart: 100,
      evictedOldestSeq: 200,
    })
    expect(state.hasOlder).toBe(true)
    expect(state.oldestLoadedSeq).toBe(200)
    expect(state.newestLoadedSeq).toBe(359)
  })

  test("returned 100 (== limit): hasNewer=true; returned 47: hasNewer=false", () => {
    expect(
      applyNewerPage({
        prevState: baseState,
        returnedCount: 100,
        newNewestSeq: 359,
        evictedFromStart: 0,
        evictedOldestSeq: null,
      }).hasNewer,
    ).toBe(true)
    expect(
      applyNewerPage({
        prevState: baseState,
        returnedCount: 47,
        newNewestSeq: 306,
        evictedFromStart: 0,
        evictedOldestSeq: null,
      }).hasNewer,
    ).toBe(false)
  })

  test("evictedOldestSeq only used when evictedFromStart > 0", () => {
    const state = applyNewerPage({
      prevState: baseState,
      returnedCount: 50,
      newNewestSeq: 309,
      evictedFromStart: 0,
      evictedOldestSeq: 999,
    })
    expect(state.oldestLoadedSeq).toBe(100)
  })

  test("isLoadingNewer set to false; isLoadingOlder carried over", () => {
    const prev: WindowState = { ...baseState, isLoadingOlder: true }
    const state = applyNewerPage({
      prevState: prev,
      returnedCount: 0,
      newNewestSeq: null,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state.isLoadingNewer).toBe(false)
    expect(state.isLoadingOlder).toBe(true)
  })

  test("newNewestSeq null falls back to prevState.newestLoadedSeq", () => {
    const state = applyNewerPage({
      prevState: baseState,
      returnedCount: 0,
      newNewestSeq: null,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state.newestLoadedSeq).toBe(259)
  })

  test("custom requestedLimit respected", () => {
    expect(
      applyNewerPage({
        prevState: baseState,
        returnedCount: 50,
        newNewestSeq: 309,
        evictedFromStart: 0,
        evictedOldestSeq: null,
        requestedLimit: 50,
      }).hasNewer,
    ).toBe(true)
  })
})

describe("applyLiveAppend", () => {
  const baseState: WindowState = {
    oldestLoadedSeq: 100,
    newestLoadedSeq: 259,
    hasOlder: false,
    hasNewer: false,
    isLoadingOlder: false,
    isLoadingNewer: false,
  }

  test("under cap, no eviction → state unchanged except newestLoadedSeq", () => {
    const state = applyLiveAppend({
      prevState: baseState,
      prevLoadedLength: 50,
      appendedNewestSeq: 260,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state).toEqual({
      ...baseState,
      newestLoadedSeq: 260,
    })
  })

  test("at cap, one append, eviction allowed → oldestLoadedSeq updated, hasOlder=true", () => {
    const prev: WindowState = { ...baseState, hasOlder: false }
    const state = applyLiveAppend({
      prevState: prev,
      prevLoadedLength: 160,
      appendedNewestSeq: 260,
      evictedFromStart: 1,
      evictedOldestSeq: 101,
    })
    expect(state.oldestLoadedSeq).toBe(101)
    expect(state.hasOlder).toBe(true)
    expect(state.newestLoadedSeq).toBe(260)
  })

  test("prevState.hasOlder=true is carried through (true stays true)", () => {
    const prev: WindowState = { ...baseState, hasOlder: true }
    const state = applyLiveAppend({
      prevState: prev,
      prevLoadedLength: 50,
      appendedNewestSeq: 260,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state.hasOlder).toBe(true)
  })

  test("appendedNewestSeq null falls back to prevState.newestLoadedSeq", () => {
    const state = applyLiveAppend({
      prevState: baseState,
      prevLoadedLength: 50,
      appendedNewestSeq: null,
      evictedFromStart: 0,
      evictedOldestSeq: null,
    })
    expect(state.newestLoadedSeq).toBe(259)
  })
})

describe("canEvictFromStartOnLiveAppend", () => {
  test("returns true when prevState.hasOlder === true", () => {
    expect(
      canEvictFromStartOnLiveAppend({
        ...INITIAL_WINDOW_STATE,
        hasOlder: true,
      }),
    ).toBe(true)
  })

  test("returns false when prevState.hasOlder === false", () => {
    expect(
      canEvictFromStartOnLiveAppend({
        ...INITIAL_WINDOW_STATE,
        hasOlder: false,
      }),
    ).toBe(false)
  })
})

describe("centeredWindowQuery", () => {
  test("returns beforeSeq = targetSeq + floor(limit/2) by default", () => {
    expect(centeredWindowQuery({ targetSeq: 1000 })).toEqual({
      beforeSeq: 1000 + Math.floor(MAX_LOADED / 2),
      limit: MAX_LOADED,
    })
  })

  test("custom limit respected", () => {
    expect(centeredWindowQuery({ targetSeq: 1000, limit: 200 })).toEqual({
      beforeSeq: 1000 + 100,
      limit: 200,
    })
  })

  test("does not overflow Number.MAX_SAFE_INTEGER for absurdly large targetSeq", () => {
    const result = centeredWindowQuery({
      targetSeq: Number.MAX_SAFE_INTEGER,
      limit: 200,
    })
    expect(result.beforeSeq).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.limit).toBe(200)
  })
})

describe("liveTailQuery", () => {
  test("returns { beforeSeq: MAX_SAFE_INTEGER, limit: 160 } by default", () => {
    expect(liveTailQuery()).toEqual({
      beforeSeq: Number.MAX_SAFE_INTEGER,
      limit: 160,
    })
  })

  test("custom limit respected", () => {
    expect(liveTailQuery(50)).toEqual({
      beforeSeq: Number.MAX_SAFE_INTEGER,
      limit: 50,
    })
  })
})

describe("shouldDropPatchAsEvicted", () => {
  test("hasNewer=false → false (accept all patches at live tail)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: 1000,
        newestLoadedSeq: 500,
        hasNewer: false,
      }),
    ).toBe(false)
  })

  test("hasNewer=true and targetSeq > newestLoadedSeq → true (drop)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: 501,
        newestLoadedSeq: 500,
        hasNewer: true,
      }),
    ).toBe(true)
  })

  test("hasNewer=true and targetSeq <= newestLoadedSeq → false (apply)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: 500,
        newestLoadedSeq: 500,
        hasNewer: true,
      }),
    ).toBe(false)
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: 499,
        newestLoadedSeq: 500,
        hasNewer: true,
      }),
    ).toBe(false)
  })

  test("newestLoadedSeq=null → false (no anchor, accept)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: 1000,
        newestLoadedSeq: null,
        hasNewer: true,
      }),
    ).toBe(false)
  })

  test("patchTargetSeq=undefined → false (no derivable seq, apply patch — BUG-1 safety)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: undefined,
        newestLoadedSeq: 500,
        hasNewer: true,
      }),
    ).toBe(false)
  })
})

/**
 * BUG-2 (docs/audit/frontend-window-audit-2026-06-17.md).
 *
 * Strict newer-page eviction + bottom-proximity guard for live-append.
 *
 * The shipped behaviour (after Wave 2):
 *   1. Newer-page FETCH: ALWAYS evict overflow back to MAX_LOADED. The
 *      previous `reachedLiveTail = responseCount < OLDER_PAGE` exception
 *      (revert c6c01183) is gone; anchor-restore handles scroll position.
 *   2. Live-append at tail (hasNewer=false): evict to MAX_LOADED ONLY when
 *      the user is at the bottom (proximity guard). Otherwise defer up to
 *      MAX_BUFFER=400, then force-evict at ceiling.
 */
describe("BUG-2: MAX_BUFFER constant", () => {
  test("MAX_BUFFER is 400 (2.5x MAX_LOADED — bounded growth ceiling)", () => {
    expect(MAX_BUFFER).toBe(400)
  })

  test("MAX_BUFFER >= MAX_LOADED (deferred-eviction headroom is non-negative)", () => {
    expect(MAX_BUFFER).toBeGreaterThanOrEqual(MAX_LOADED)
  })
})

describe("BUG-2 Test A: strict newer-page fetch eviction", () => {
  test("160 + 100 fetched: evicts 100 (no reachedLiveTail exception)", () => {
    // Window has 160 rows, hasNewer=true. Fetch 100 newer rows.
    // BUG-2 pre-fix behaviour: responseCount=100 (full page) → reachedLiveTail=false
    //   → evictedFromStart=0 → buffer grows to 260. After 5 pages, 660 rows.
    // BUG-2 post-fix behaviour: always evict overflow back to MAX_LOADED.
    const evicted = computeNewerPageEvictedFromStart({
      currentLength: 160,
      appendedCount: 100,
    })
    expect(evicted).toBe(100)

    // Simulated buffer: after eviction, length stays at MAX_LOADED.
    const beforeBuffer = Array.from({ length: 260 }, (_, i) => i + 1)
    const finalBuffer = beforeBuffer.slice(evicted)
    expect(finalBuffer.length).toBe(MAX_LOADED)
    // The oldest 100 rows were evicted (originally 1..100); head is now 101.
    expect(finalBuffer[0]).toBe(101)
    expect(finalBuffer[finalBuffer.length - 1]).toBe(260)
  })

  test("full-page return: evicts; partial-page return: evicts the partial overflow", () => {
    expect(
      computeNewerPageEvictedFromStart({ currentLength: 160, appendedCount: 100 }),
    ).toBe(100)
    expect(
      computeNewerPageEvictedFromStart({ currentLength: 160, appendedCount: 47 }),
    ).toBe(47)
    expect(
      computeNewerPageEvictedFromStart({ currentLength: 50, appendedCount: 47 }),
    ).toBe(0)
  })

  test("custom maxLoaded respected", () => {
    expect(
      computeNewerPageEvictedFromStart({
        currentLength: 100,
        appendedCount: 50,
        maxLoaded: 120,
      }),
    ).toBe(30)
  })
})

describe("BUG-2 Test B: live-append, proximity guard ON (atBottom=true)", () => {
  test("161 rows after append + atBottom=true → evict to MAX_LOADED", () => {
    // Window had 160, live patch appended 1 → ordered length 161.
    expect(
      canEvictOnLiveAppend({
        windowLength: 161,
        atBottom: true,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      }),
    ).toBe(true)

    // Simulate caller decision: evict to MAX_LOADED.
    const ordered = Array.from({ length: 161 }, (_, i) => i + 1)
    const finalMessages =
      canEvictOnLiveAppend({
        windowLength: ordered.length,
        atBottom: true,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      })
        ? ordered.slice(ordered.length - MAX_LOADED)
        : ordered
    expect(finalMessages.length).toBe(MAX_LOADED)
    // Oldest 1 row evicted: head was 1, now 2.
    expect(finalMessages[0]).toBe(2)
  })

  test("length <= maxLoaded → false (nothing to evict even when atBottom)", () => {
    expect(
      canEvictOnLiveAppend({
        windowLength: 160,
        atBottom: true,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      }),
    ).toBe(false)
  })
})

describe("BUG-2 Test C: live-append, proximity guard OFF (atBottom=false)", () => {
  test("161 rows after append + atBottom=false → defer eviction", () => {
    expect(
      canEvictOnLiveAppend({
        windowLength: 161,
        atBottom: false,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      }),
    ).toBe(false)

    // Simulate caller decision: no proximity evict, no ceiling violation.
    const ordered = Array.from({ length: 161 }, (_, i) => i + 1)
    const proximity = canEvictOnLiveAppend({
      windowLength: ordered.length,
      atBottom: false,
      maxLoaded: MAX_LOADED,
      maxBuffer: MAX_BUFFER,
    })
    const overCeiling = ordered.length > MAX_BUFFER
    expect(proximity).toBe(false)
    expect(overCeiling).toBe(false)
    const finalMessages = proximity
      ? ordered.slice(ordered.length - MAX_LOADED)
      : overCeiling
        ? ordered.slice(ordered.length - MAX_BUFFER)
        : ordered
    expect(finalMessages.length).toBe(161)
  })

  test("any length between MAX_LOADED+1 and MAX_BUFFER + atBottom=false → false (defer)", () => {
    for (const len of [161, 200, 300, 399, MAX_BUFFER]) {
      expect(
        canEvictOnLiveAppend({
          windowLength: len,
          atBottom: false,
          maxLoaded: MAX_LOADED,
          maxBuffer: MAX_BUFFER,
        }),
      ).toBe(false)
    }
  })
})

describe("BUG-2 Test D: buffer ceiling enforced", () => {
  test("401 rows after append + atBottom=false → ceiling forces evict to MAX_BUFFER", () => {
    const ordered = Array.from({ length: 401 }, (_, i) => i + 1)
    expect(
      canEvictOnLiveAppend({
        windowLength: ordered.length,
        atBottom: false,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      }),
    ).toBe(false)
    expect(ordered.length > MAX_BUFFER).toBe(true)
    const finalMessages = ordered.slice(ordered.length - MAX_BUFFER)
    expect(finalMessages.length).toBe(MAX_BUFFER)
    expect(finalMessages[0]).toBe(2)
  })

  test("atBottom=true + over ceiling: proximity wins (evict to MAX_LOADED)", () => {
    expect(
      canEvictOnLiveAppend({
        windowLength: 500,
        atBottom: true,
        maxLoaded: MAX_LOADED,
        maxBuffer: MAX_BUFFER,
      }),
    ).toBe(true)
  })
})

describe("isFetchRefractory (E2E Wave 3 F-1 fix)", () => {
  test("never resolved on either side → false", () => {
    expect(
      isFetchRefractory({
        now: 10_000,
        lastOlderResolvedAt: 0,
        lastNewerResolvedAt: 0,
      }),
    ).toBe(false)
  })

  test("older just resolved → true (blocks both directions)", () => {
    const T = 1_000
    expect(
      isFetchRefractory({
        now: T,
        lastOlderResolvedAt: T,
        lastNewerResolvedAt: 0,
      }),
    ).toBe(true)
    expect(
      isFetchRefractory({
        now: T + 100,
        lastOlderResolvedAt: T,
        lastNewerResolvedAt: 0,
      }),
    ).toBe(true)
  })

  test("newer just resolved → true (blocks both directions)", () => {
    const T = 5_000
    expect(
      isFetchRefractory({
        now: T,
        lastOlderResolvedAt: 0,
        lastNewerResolvedAt: T,
      }),
    ).toBe(true)
    expect(
      isFetchRefractory({
        now: T + 200,
        lastOlderResolvedAt: 0,
        lastNewerResolvedAt: T,
      }),
    ).toBe(true)
  })

  test("both directions cooled down past REFRACTORY_MS → false", () => {
    expect(
      isFetchRefractory({
        now: 10_000,
        lastOlderResolvedAt: 10_000 - REFRACTORY_MS,
        lastNewerResolvedAt: 10_000 - REFRACTORY_MS,
      }),
    ).toBe(false)
    expect(
      isFetchRefractory({
        now: 10_000,
        lastOlderResolvedAt: 10_000 - REFRACTORY_MS - 1,
        lastNewerResolvedAt: 10_000 - REFRACTORY_MS - 1,
      }),
    ).toBe(false)
  })

  test("the alternation scenario from network.log: opposite-direction recent resolve still blocks", () => {
    // Loop on the E2E rig: each fetch takes ~500 ms (network latency > REFRACTORY_MS=250).
    // With per-direction refractory only, the loop sustained because by the time
    // the current fetch resolved, the opposite direction's per-direction
    // refractory had already expired.
    //
    // Bidirectional refractory should block the post-resolution opposite-
    // direction trigger because the SAME-direction clock is fresh.
    const FETCH_LATENCY_MS = 500

    // T=500: older just resolved.
    let now = FETCH_LATENCY_MS
    expect(
      isFetchRefractory({
        now,
        lastOlderResolvedAt: FETCH_LATENCY_MS,
        lastNewerResolvedAt: 0,
      }),
    ).toBe(true)

    // T=1000: newer just resolved (it fired immediately after older resolved
    // under the old per-direction policy). Older's own clock is now 500 ms
    // ago — per-direction policy would let older fire. Bidirectional should
    // still block it because newer's clock just reset.
    now = FETCH_LATENCY_MS * 2
    expect(
      isFetchRefractory({
        now,
        lastOlderResolvedAt: FETCH_LATENCY_MS,
        lastNewerResolvedAt: FETCH_LATENCY_MS * 2,
      }),
    ).toBe(true)

    // T=1000 + REFRACTORY_MS: both directions are unblocked again. Next fetch
    // must come from a real scroll event, not from the post-resolution effect.
    now = FETCH_LATENCY_MS * 2 + REFRACTORY_MS
    expect(
      isFetchRefractory({
        now,
        lastOlderResolvedAt: FETCH_LATENCY_MS,
        lastNewerResolvedAt: FETCH_LATENCY_MS * 2,
      }),
    ).toBe(false)
  })

  test("respects custom refractoryMs", () => {
    expect(
      isFetchRefractory({
        now: 1_000,
        lastOlderResolvedAt: 950,
        lastNewerResolvedAt: 0,
        refractoryMs: 100,
      }),
    ).toBe(true)
    expect(
      isFetchRefractory({
        now: 1_000,
        lastOlderResolvedAt: 950,
        lastNewerResolvedAt: 0,
        refractoryMs: 25,
      }),
    ).toBe(false)
  })
})

describe("loop convergence simulation (E2E Wave 3 F-1)", () => {
  /**
   * Drives the wired evaluator semantics across a sequence of post-
   * resolution events. Mirrors the relevant guards in ChatView/index.tsx
   * (`evaluateOlderTrigger` / `evaluateNewerTrigger`):
   *   - skip if same-direction is loading
   *   - skip if `isFetchRefractory` returns true
   *   - skip if the shape predicate (`shouldFetchX`) returns false
   *
   * The scenario mirrors the network.log loop:
   *   - the user has scrolled up; after anchor restoration, both
   *     rowsAbove and rowsBelow sit below their respective triggers
   *     (the buffer is bounded at 160 and the anchor lands near the
   *     middle).
   *   - each fetch takes FETCH_LATENCY_MS = 500 ms (network.log mean).
   *   - eviction flips the opposite-direction `hasX` to true on every
   *     resolution.
   *
   * With bidirectional refractory the loop must converge: a single round
   * of (older or newer) before the post-resolution effect is silenced.
   */
  test("loop terminates within one round under bidirectional refractory", () => {
    const FETCH_LATENCY_MS = 500
    const ROWS_ABOVE = 30 // < TOP_TRIGGER (60)
    const ROWS_BELOW = 30 // < BOTTOM_TRIGGER (60)

    // Start at a time past the initial refractory window. In the live
    // component, `lastOlderResolvedAtRef.current` starts at 0 and `Date.now()`
    // is in the billions, so the first scroll-driven fire is always past
    // refractory. We replicate that here.
    let now = REFRACTORY_MS * 10
    let lastOlderResolvedAt = 0
    let lastNewerResolvedAt = 0
    let state: WindowState = {
      oldestLoadedSeq: 309,
      newestLoadedSeq: 408,
      hasOlder: true,
      hasNewer: true,
      isLoadingOlder: false,
      isLoadingNewer: false,
    }

    const fired: string[] = []

    function tryFireOlder(): void {
      if (state.isLoadingOlder || state.isLoadingNewer) return
      if (
        isFetchRefractory({ now, lastOlderResolvedAt, lastNewerResolvedAt })
      )
        return
      if (
        !shouldFetchOlder({
          rowsAboveViewport: ROWS_ABOVE,
          hasOlder: state.hasOlder,
          isLoadingOlder: state.isLoadingOlder,
        })
      )
        return
      state = { ...state, isLoadingOlder: true }
      fired.push(`older@${now}`)
    }
    function tryFireNewer(): void {
      if (state.isLoadingOlder || state.isLoadingNewer) return
      if (
        isFetchRefractory({ now, lastOlderResolvedAt, lastNewerResolvedAt })
      )
        return
      if (
        !shouldFetchNewer({
          rowsBelowViewport: ROWS_BELOW,
          hasNewer: state.hasNewer,
          isLoadingNewer: state.isLoadingNewer,
        })
      )
        return
      state = { ...state, isLoadingNewer: true }
      fired.push(`newer@${now}`)
    }

    // Round 0: a scroll event triggered older. The evaluator at index.tsx
    // fires the older fetch (older clock is 0; refractory not engaged).
    tryFireOlder()
    expect(state.isLoadingOlder).toBe(true)

    // Drive 10 iterations of the post-resolution effect. Each iteration:
    //   - resolves whichever fetch is in flight after FETCH_LATENCY_MS
    //   - fires the post-resolution evaluator (both directions)
    // Without bidirectional refractory this loops indefinitely. With it,
    // a single resolve immediately silences the opposite direction too,
    // and the loop terminates.
    for (let i = 0; i < 10; i++) {
      if (state.isLoadingOlder) {
        now += FETCH_LATENCY_MS
        state = applyOlderPage({
          prevState: state,
          returnedCount: 0, // exhausted: same beforeSeq replayed
          newOldestSeq: state.oldestLoadedSeq,
          prevLoadedLength: 160,
          evictedFromEnd: 0,
          evictedNewestSeq: null,
          serverHasOlder: true,
        })
        lastOlderResolvedAt = now
      } else if (state.isLoadingNewer) {
        now += FETCH_LATENCY_MS
        state = applyNewerPage({
          prevState: state,
          returnedCount: 0,
          newNewestSeq: state.newestLoadedSeq,
          evictedFromStart: 0,
          evictedOldestSeq: null,
          serverHasNewer: true,
        })
        lastNewerResolvedAt = now
      } else {
        // No fetch in flight → no further post-resolution effect can fire.
        break
      }

      // Post-resolution effect (mirrors index.tsx).
      tryFireOlder()
      tryFireNewer()
    }

    // Loop converged: at most one fetch per direction, no in-flight
    // request lingering, and the bidirectional refractory shut down the
    // post-resolution alternation before it could repeat.
    expect(state.isLoadingOlder).toBe(false)
    expect(state.isLoadingNewer).toBe(false)
    const olderFires = fired.filter((s) => s.startsWith("older@")).length
    const newerFires = fired.filter((s) => s.startsWith("newer@")).length
    expect(olderFires).toBeLessThanOrEqual(1)
    expect(newerFires).toBeLessThanOrEqual(1)
  })

  /**
   * Control test: same simulation but with PER-DIRECTION refractory (the
   * buggy pre-fix policy). Documents what the network.log captured:
   * because each fetch takes longer than REFRACTORY_MS, the opposite
   * direction's clock has always expired by the time the current fetch
   * resolves, so the post-resolution effect alternates forever.
   *
   * If a future refactor regresses to per-direction refractory, this
   * test will start passing the inner loop count and the bidirectional
   * test above will start failing — surfacing the regression.
   */
  test("control: per-direction refractory loops indefinitely under same scenario", () => {
    const FETCH_LATENCY_MS = 500
    const ROWS_ABOVE = 30
    const ROWS_BELOW = 30

    let now = REFRACTORY_MS * 10
    let lastOlderResolvedAt = 0
    let lastNewerResolvedAt = 0
    let state: WindowState = {
      oldestLoadedSeq: 309,
      newestLoadedSeq: 408,
      hasOlder: true,
      hasNewer: true,
      isLoadingOlder: false,
      isLoadingNewer: false,
    }
    let olderFires = 0
    let newerFires = 0

    function perDirectionRefractoryOlder(): boolean {
      return now - lastOlderResolvedAt < REFRACTORY_MS
    }
    function perDirectionRefractoryNewer(): boolean {
      return now - lastNewerResolvedAt < REFRACTORY_MS
    }

    function tryFireOlder(): void {
      if (state.isLoadingOlder) return
      if (perDirectionRefractoryOlder()) return
      if (
        !shouldFetchOlder({
          rowsAboveViewport: ROWS_ABOVE,
          hasOlder: state.hasOlder,
          isLoadingOlder: state.isLoadingOlder,
        })
      )
        return
      state = { ...state, isLoadingOlder: true }
      olderFires += 1
    }
    function tryFireNewer(): void {
      if (state.isLoadingNewer) return
      if (perDirectionRefractoryNewer()) return
      if (
        !shouldFetchNewer({
          rowsBelowViewport: ROWS_BELOW,
          hasNewer: state.hasNewer,
          isLoadingNewer: state.isLoadingNewer,
        })
      )
        return
      state = { ...state, isLoadingNewer: true }
      newerFires += 1
    }

    tryFireOlder()
    expect(state.isLoadingOlder).toBe(true)

    for (let i = 0; i < 10; i++) {
      if (state.isLoadingOlder) {
        now += FETCH_LATENCY_MS
        state = applyOlderPage({
          prevState: state,
          returnedCount: 0,
          newOldestSeq: state.oldestLoadedSeq,
          prevLoadedLength: 160,
          evictedFromEnd: 0,
          evictedNewestSeq: null,
          serverHasOlder: true,
        })
        lastOlderResolvedAt = now
      } else if (state.isLoadingNewer) {
        now += FETCH_LATENCY_MS
        state = applyNewerPage({
          prevState: state,
          returnedCount: 0,
          newNewestSeq: state.newestLoadedSeq,
          evictedFromStart: 0,
          evictedOldestSeq: null,
          serverHasNewer: true,
        })
        lastNewerResolvedAt = now
      } else {
        break
      }
      tryFireOlder()
      tryFireNewer()
    }

    // The buggy per-direction policy fires both directions many times.
    // Mirrors the 20+ alternating fetches in the E2E network.log.
    expect(olderFires + newerFires).toBeGreaterThanOrEqual(10)
  })
})
