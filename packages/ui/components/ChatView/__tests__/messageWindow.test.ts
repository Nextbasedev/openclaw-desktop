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
  test("keep the initial tail/page contract", () => {
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

describe("eviction helpers", () => {
  test("prepend never evicts tail rows now that virtualization is disabled", () => {
    expect(computeEvictedAfterPrepend(0, 0)).toBe(0)
    expect(computeEvictedAfterPrepend(160, 100)).toBe(0)
    expect(computeEvictedAfterPrepend(300, 100, 80)).toBe(0)
  })

  test("append never evicts head rows now that virtualization is disabled", () => {
    expect(computeEvictedAfterAppend(0, 0)).toBe(0)
    expect(computeEvictedAfterAppend(160, 100)).toBe(0)
    expect(computeEvictedAfterAppend(300, 100, 80)).toBe(0)
  })
})

describe("fetch triggers", () => {
  test("older paging still triggers near the top", () => {
    expect(shouldFetchOlder({ rowsAboveViewport: 60, hasOlder: true, isLoadingOlder: false })).toBe(true)
    expect(shouldFetchOlder({ rowsAboveViewport: 61, hasOlder: true, isLoadingOlder: false })).toBe(false)
    expect(shouldFetchOlder({ rowsAboveViewport: 0, hasOlder: false, isLoadingOlder: false })).toBe(false)
    expect(shouldFetchOlder({ rowsAboveViewport: 0, hasOlder: true, isLoadingOlder: true })).toBe(false)
  })

  test("newer paging is disabled with the sliding window removed", () => {
    expect(shouldFetchNewer({ rowsBelowViewport: 0, hasNewer: true, isLoadingNewer: false })).toBe(false)
    expect(shouldFetchNewer({ rowsBelowViewport: 60, hasNewer: true, isLoadingNewer: false })).toBe(false)
    expect(shouldFetchNewer({ rowsBelowViewport: 0, hasNewer: false, isLoadingNewer: false })).toBe(false)
  })
})

describe("applyInitialPage", () => {
  test("empty session has no older/newer gaps", () => {
    expect(applyInitialPage({ returnedCount: 0, oldestSeq: null, newestSeq: null })).toEqual({
      oldestLoadedSeq: null,
      newestLoadedSeq: null,
      hasOlder: false,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })

  test("full initial tail marks older history available only", () => {
    expect(applyInitialPage({ returnedCount: 160, oldestSeq: 341, newestSeq: 500 })).toEqual({
      oldestLoadedSeq: 341,
      newestLoadedSeq: 500,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })
})

describe("applyOlderPage", () => {
  const prevState: WindowState = {
    oldestLoadedSeq: 341,
    newestLoadedSeq: 500,
    hasOlder: true,
    hasNewer: false,
    isLoadingOlder: true,
    isLoadingNewer: false,
  }

  test("prepends older rows without creating a newer gap", () => {
    expect(applyOlderPage({
      prevState,
      returnedCount: 100,
      newOldestSeq: 241,
      prevLoadedLength: 160,
      evictedFromEnd: 100,
      evictedNewestSeq: 400,
    })).toEqual({
      oldestLoadedSeq: 241,
      newestLoadedSeq: 500,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })

  test("short older page clears hasOlder", () => {
    expect(applyOlderPage({
      prevState,
      returnedCount: 47,
      newOldestSeq: 1,
      prevLoadedLength: 160,
      evictedFromEnd: 0,
      evictedNewestSeq: null,
    }).hasOlder).toBe(false)
  })
})

describe("applyNewerPage", () => {
  test("defensive newer path updates newest but never marks hasNewer", () => {
    const prevState: WindowState = {
      oldestLoadedSeq: 100,
      newestLoadedSeq: 259,
      hasOlder: true,
      hasNewer: true,
      isLoadingOlder: false,
      isLoadingNewer: true,
    }

    expect(applyNewerPage({
      prevState,
      returnedCount: 100,
      newNewestSeq: 359,
      evictedFromStart: 100,
      evictedOldestSeq: 200,
    })).toEqual({
      oldestLoadedSeq: 100,
      newestLoadedSeq: 359,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })
})

describe("applyLiveAppend", () => {
  test("live append updates newest without evicting oldest", () => {
    const prevState: WindowState = {
      oldestLoadedSeq: 100,
      newestLoadedSeq: 259,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    }

    expect(applyLiveAppend({
      prevState,
      prevLoadedLength: 160,
      appendedNewestSeq: 260,
      evictedFromStart: 1,
      evictedOldestSeq: 101,
    })).toEqual({
      oldestLoadedSeq: 100,
      newestLoadedSeq: 260,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })

  test("live append eviction is never allowed", () => {
    expect(canEvictFromStartOnLiveAppend({
      oldestLoadedSeq: 1,
      newestLoadedSeq: 160,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })).toBe(false)
  })
})

describe("queries", () => {
  test("centeredWindowQuery keeps its defensive utility behavior", () => {
    expect(centeredWindowQuery({ targetSeq: 1000 })).toEqual({ beforeSeq: 1080, limit: 160 })
    expect(centeredWindowQuery({ targetSeq: Number.MAX_SAFE_INTEGER, limit: 100 })).toEqual({
      beforeSeq: Number.MAX_SAFE_INTEGER,
      limit: 100,
    })
  })

  test("liveTailQuery loads the latest initial page by default", () => {
    expect(liveTailQuery()).toEqual({ beforeSeq: Number.MAX_SAFE_INTEGER, limit: 160 })
    expect(liveTailQuery(25)).toEqual({ beforeSeq: Number.MAX_SAFE_INTEGER, limit: 25 })
  })
})

describe("shouldDropPatchAsEvicted", () => {
  test("live patches are never dropped as evicted", () => {
    expect(shouldDropPatchAsEvicted({ patchSessionCursor: 999, newestLoadedSeq: 10, hasNewer: true })).toBe(false)
    expect(shouldDropPatchAsEvicted({ patchSessionCursor: 1, newestLoadedSeq: null, hasNewer: false })).toBe(false)
  })
})
