/**
 * BUG (docs/audit/deep-verification-2026-06-17.md item 3) regression test.
 *
 * The newer-page FETCH path captures `captureFirstVisibleRowAnchor` BEFORE
 * `setState` evicts rows from the head, then the `useLayoutEffect` on
 * `pendingScrollAnchorRef` restores `scrollTop` after React reconciles.
 *
 * The LIVE-APPEND ceiling-evict branch (when `windowLength > MAX_BUFFER`
 * forces eviction even though the user is scrolled up) was NOT calling
 * `captureFirstVisibleRowAnchor`, so the same head-mutation produced a
 * visible scroll jolt — rows above the viewport disappeared, `scrollTop`
 * was off by the evicted height, and the user got yanked toward the head.
 *
 * `shouldCaptureAnchorOnLiveAppend` is the pure predicate that decides
 * whether the live-append branch needs to capture+restore. It is consumed
 * at the live-append ceiling-evict site in `ChatView/index.tsx`.
 */

import { describe, expect, test } from "vitest"
import { shouldCaptureAnchorOnLiveAppend } from "../messageWindow"

describe("shouldCaptureAnchorOnLiveAppend (deep-verification item 3)", () => {
  test("at-bottom + ceiling-evict: no capture (at-bottom eviction is invisible)", () => {
    expect(
      shouldCaptureAnchorOnLiveAppend({
        atBottom: true,
        isCeilingEvict: true,
      }),
    ).toBe(false)
  })

  test("scrolled-up + ceiling-evict: CAPTURE (head mutation would jolt viewport)", () => {
    expect(
      shouldCaptureAnchorOnLiveAppend({
        atBottom: false,
        isCeilingEvict: true,
      }),
    ).toBe(true)
  })

  test("at-bottom + no-evict: no capture (nothing to restore)", () => {
    expect(
      shouldCaptureAnchorOnLiveAppend({
        atBottom: true,
        isCeilingEvict: false,
      }),
    ).toBe(false)
  })

  test("scrolled-up + no-evict: no capture (no head mutation)", () => {
    expect(
      shouldCaptureAnchorOnLiveAppend({
        atBottom: false,
        isCeilingEvict: false,
      }),
    ).toBe(false)
  })
})
