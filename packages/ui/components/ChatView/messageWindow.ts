/**
 * Chat tail pagination helpers for ChatView.
 *
 * This module is intentionally pure: no React, no DOM, no async, no I/O.
 * We still open chats at the live tail and page older history on demand, but
 * the UI no longer evicts rows from either end of the rendered message list.
 * This intentionally removes the added sliding-window virtualization layer
 * while keeping the small initial tail fetch contract.
 */

import { UI_INITIAL_WINDOW } from "@/lib/chat-engine-v2/constants"

/** Initial tail size. Kept for contract compatibility; no longer an eviction cap. */
export const MAX_LOADED = UI_INITIAL_WINDOW
/** Page size for the initial fetch when opening a chat. */
export const INITIAL_PAGE = UI_INITIAL_WINDOW
/** Page size for subsequent older/newer page fetches. */
export const OLDER_PAGE = 100 // keep in sync with UI_OLDER_PAGE
/** Number of rows above/below the viewport at which a paging fetch fires. */
export const TOP_TRIGGER = 60
/**
 * Newer-side preload trigger. Symmetric with the older-side TOP_TRIGGER so
 * the user experiences the same scroll-then-load cycle in both directions:
 * scroll through the loaded buffer, hit ~60 rows from the boundary, see the
 * next page arrive. A wider trigger (e.g. 120) was tried but it fires too
 * early — the user barely moves before content jumps in, breaking the
 * perceived cycle.
 */
export const BOTTOM_TRIGGER = 60
/**
 * Wall-clock minimum gap (ms) between two same-direction fetches. Replaces a
 * pixel-distance refractory which became stale across major buffer mutations
 * (the scrollTop coordinate isn't comparable across prepend+evict cycles).
 * Prevents the older/newer alternation loop and rapid re-fire during fast
 * scroll bursts.
 *
 * 250ms is short enough that a deliberate user scroll never feels gated, and
 * long enough that a single fetch resolve + post-resolution evaluator pass
 * cannot cascade into a second fetch in the same direction.
 */
export const REFRACTORY_MS = 250

/**
 * The single source of truth for the chat window's load state.
 * Tracks the seq boundaries of what's loaded and whether more exists in
 * either direction.
 */
export type WindowState = {
  oldestLoadedSeq: number | null
  newestLoadedSeq: number | null
  hasOlder: boolean
  hasNewer: boolean
  isLoadingOlder: boolean
  isLoadingNewer: boolean
}

/** Initial state used before any fetch has resolved. */
export const INITIAL_WINDOW_STATE: WindowState = {
  oldestLoadedSeq: null,
  newestLoadedSeq: null,
  hasOlder: false,
  hasNewer: false,
  isLoadingOlder: false,
  isLoadingNewer: false,
}

/**
 * Virtualization is disabled: prepending older rows never evicts tail rows.
 */
export function computeEvictedAfterPrepend(
  currentLength: number,
  prependedCount: number,
  maxLoaded: number = MAX_LOADED,
): number {
  void currentLength
  void prependedCount
  void maxLoaded
  return 0
}

/**
 * Virtualization is disabled: appending newer/live rows never evicts head rows.
 */
export function computeEvictedAfterAppend(
  currentLength: number,
  appendedCount: number,
  maxLoaded: number = MAX_LOADED,
): number {
  void currentLength
  void appendedCount
  void maxLoaded
  return 0
}

/**
 * Returns true when an older-page fetch should be triggered: there's older
 * data, we're not already loading, and the viewport is near the top.
 */
export function shouldFetchOlder(input: {
  rowsAboveViewport: number
  hasOlder: boolean
  isLoadingOlder: boolean
  threshold?: number
}): boolean {
  const { rowsAboveViewport, hasOlder, isLoadingOlder } = input
  const threshold = input.threshold ?? TOP_TRIGGER
  if (!hasOlder) return false
  if (isLoadingOlder) return false
  return rowsAboveViewport <= threshold
}

/**
 * Newer-page fetches were only needed by the sliding data-window. With row
 * eviction removed, the view stays attached to the live tail and older paging
 * never creates a synthetic "newer" gap to refill.
 */
export function shouldFetchNewer(input: {
  rowsBelowViewport: number
  hasNewer: boolean
  isLoadingNewer: boolean
  threshold?: number
}): boolean {
  void input
  return false
}

/**
 * Returns the new `WindowState` after the initial page fetch resolves.
 * `hasOlder` is inferred from whether the backend filled the requested page.
 */
export function applyInitialPage(input: {
  returnedCount: number
  oldestSeq: number | null
  newestSeq: number | null
  requestedLimit?: number
}): WindowState {
  const requestedLimit = input.requestedLimit ?? INITIAL_PAGE
  return {
    oldestLoadedSeq: input.oldestSeq,
    newestLoadedSeq: input.newestSeq,
    hasOlder: input.returnedCount >= requestedLimit,
    hasNewer: false,
    isLoadingOlder: false,
    isLoadingNewer: false,
  }
}

/**
 * Returns the new `WindowState` after an older-page fetch resolves. Older
 * paging no longer evicts the tail, so it never creates `hasNewer`.
 */
export function applyOlderPage(input: {
  prevState: WindowState
  returnedCount: number
  newOldestSeq: number | null
  prevLoadedLength: number
  evictedFromEnd: number
  evictedNewestSeq: number | null
  requestedLimit?: number
}): WindowState {
  const requestedLimit = input.requestedLimit ?? OLDER_PAGE
  const { prevState } = input
  return {
    oldestLoadedSeq: input.newOldestSeq ?? prevState.oldestLoadedSeq,
    newestLoadedSeq: prevState.newestLoadedSeq,
    hasOlder: input.returnedCount >= requestedLimit,
    hasNewer: false,
    isLoadingOlder: false,
    isLoadingNewer: prevState.isLoadingNewer,
  }
}

/**
 * Returns the new `WindowState` after a newer-page fetch resolves. This path is
 * kept as a defensive no-op for stale callers; normal scrolling never requests
 * newer pages now that the sliding window is gone.
 */
export function applyNewerPage(input: {
  prevState: WindowState
  returnedCount: number
  newNewestSeq: number | null
  evictedFromStart: number
  evictedOldestSeq: number | null
  requestedLimit?: number
}): WindowState {
  const { prevState } = input
  return {
    oldestLoadedSeq: prevState.oldestLoadedSeq,
    newestLoadedSeq: input.newNewestSeq ?? prevState.newestLoadedSeq,
    hasOlder: prevState.hasOlder,
    hasNewer: false,
    isLoadingOlder: prevState.isLoadingOlder,
    isLoadingNewer: false,
  }
}

/**
 * Returns the new `WindowState` after a live patch appended one or more
 * messages at the tail. Live appends no longer evict old rows.
 */
export function applyLiveAppend(input: {
  prevState: WindowState
  prevLoadedLength: number
  appendedNewestSeq: number | null
  evictedFromStart: number
  evictedOldestSeq: number | null
}): WindowState {
  const { prevState } = input
  return {
    oldestLoadedSeq: prevState.oldestLoadedSeq,
    newestLoadedSeq: input.appendedNewestSeq ?? prevState.newestLoadedSeq,
    hasOlder: prevState.hasOlder,
    hasNewer: false,
    isLoadingOlder: prevState.isLoadingOlder,
    isLoadingNewer: prevState.isLoadingNewer,
  }
}

/**
 * Virtualization is disabled, so live appends must never evict from the start.
 */
export function canEvictFromStartOnLiveAppend(prevState: WindowState): boolean {
  void prevState
  return false
}

/**
 * Returns `{ beforeSeq, limit }` for fetching a window roughly centered on
 * `targetSeq` (used for jump-to-message when the target is outside the
 * currently-loaded window). Clamps `beforeSeq` to `Number.MAX_SAFE_INTEGER`.
 */
export function centeredWindowQuery(input: {
  targetSeq: number
  limit?: number
}): { beforeSeq: number; limit: number } {
  const limit = input.limit ?? MAX_LOADED
  const beforeSeq = Math.min(
    input.targetSeq + Math.floor(limit / 2),
    Number.MAX_SAFE_INTEGER,
  )
  return { beforeSeq, limit }
}

/**
 * Returns `{ beforeSeq, limit }` to load the latest `limit` messages
 * (relies on the middleware `beforeSeq` branch returning the N largest seqs
 * less than `beforeSeq` in ASC order).
 */
export function liveTailQuery(
  limit: number = INITIAL_PAGE,
): { beforeSeq: number; limit: number } {
  return { beforeSeq: Number.MAX_SAFE_INTEGER, limit }
}

/**
 * Live patches are cursor-ordered events, while loaded message boundaries are
 * gateway seqs. Those are different coordinate systems, so comparing
 * `patch.cursor > newestLoadedSeq` can drop the user's current run while the
 * persisted transcript is perfectly fine after reload. Keep live patches and
 * let explicit pagination/trim logic manage the bounded window.
 */
export function shouldDropPatchAsEvicted(input: {
  patchSessionCursor: number
  newestLoadedSeq: number | null
  hasNewer: boolean
}): boolean {
  void input
  return false
}
