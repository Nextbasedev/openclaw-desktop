import { describe, expect, test } from "vitest"
import {
  applyInitialPage,
  applyLiveAppend,
  applyNewerPage,
  applyOlderPage,
  canEvictFromStartOnLiveAppend,
  centeredWindowQuery,
  computeEvictedAfterAppend,
  computeEvictedAfterPrepend,
  INITIAL_PAGE,
  INITIAL_WINDOW_STATE,
  liveTailQuery,
  MAX_LOADED,
  OLDER_PAGE,
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
  test("accepts live patches at the live tail", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchSessionCursor: 1000,
        newestLoadedSeq: 500,
        hasNewer: false,
      }),
    ).toBe(false)
  })

  test("does not compare patch cursors to message seq boundaries", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchSessionCursor: 10_000,
        newestLoadedSeq: 500,
        hasNewer: true,
      }),
    ).toBe(false)
  })

  test("accepts patches even without a loaded tail anchor", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchSessionCursor: 1000,
        newestLoadedSeq: null,
        hasNewer: true,
      }),
    ).toBe(false)
  })
})
