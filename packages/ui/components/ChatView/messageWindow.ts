/**
 * Data-window virtualization helpers for ChatView.
 *
 * This module is intentionally pure: no React, no DOM, no async, no I/O.
 * It encapsulates the math and state transitions for the "data window" — the
 * bounded sliding window of messages we keep in memory while the user scrolls
 * through a potentially-huge chat history. Everything here is deterministic
 * given its inputs so it can be unit-tested in isolation and reused from the
 * ChatView component, scroll-trigger effects, and live-patch reducers.
 *
 * See `docs/CHAT_VIRTUALIZATION_PLAN.md` §2 (math), §4 (state machine),
 * §5 Step 1, and §10 (constants) for the design context.
 */

/** Maximum number of messages we hold in the active data window. */
export const MAX_LOADED = 160
/** Page size for the initial fetch when opening a chat. */
export const INITIAL_PAGE = 160
/** Page size for subsequent older/newer page fetches. */
export const OLDER_PAGE = 100
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
 * Returns how many messages must be dropped from the end of the buffer after
 * prepending `prependedCount` rows so the buffer stays at most `maxLoaded`.
 * Never returns a negative number.
 */
export function computeEvictedAfterPrepend(
  currentLength: number,
  prependedCount: number,
  maxLoaded: number = MAX_LOADED,
): number {
  const overflow = currentLength + prependedCount - maxLoaded
  return overflow > 0 ? overflow : 0
}

/**
 * Returns how many messages must be dropped from the start of the buffer after
 * appending `appendedCount` rows so the buffer stays at most `maxLoaded`.
 * Never returns a negative number.
 */
export function computeEvictedAfterAppend(
  currentLength: number,
  appendedCount: number,
  maxLoaded: number = MAX_LOADED,
): number {
  const overflow = currentLength + appendedCount - maxLoaded
  return overflow > 0 ? overflow : 0
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
 * Returns true when a newer-page fetch should be triggered: there's newer
 * data, we're not already loading, and the viewport is near the bottom.
 */
export function shouldFetchNewer(input: {
  rowsBelowViewport: number
  hasNewer: boolean
  isLoadingNewer: boolean
  threshold?: number
}): boolean {
  const { rowsBelowViewport, hasNewer, isLoadingNewer } = input
  const threshold = input.threshold ?? BOTTOM_TRIGGER
  if (!hasNewer) return false
  if (isLoadingNewer) return false
  return rowsBelowViewport <= threshold
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
  hasOlder?: boolean
}): WindowState {
  const requestedLimit = input.requestedLimit ?? INITIAL_PAGE
  return {
    oldestLoadedSeq: input.oldestSeq,
    newestLoadedSeq: input.newestSeq,
    hasOlder: input.hasOlder ?? input.returnedCount >= requestedLimit,
    hasNewer: false,
    isLoadingOlder: false,
    isLoadingNewer: false,
  }
}

/**
 * Returns the new `WindowState` after an older-page fetch resolves and any
 * tail eviction has been applied to the buffer.
 */
export function applyOlderPage(input: {
  prevState: WindowState
  returnedCount: number
  newOldestSeq: number | null
  prevLoadedLength: number
  evictedFromEnd: number
  evictedNewestSeq: number | null
  requestedLimit?: number
  hasOlder?: boolean
}): WindowState {
  const requestedLimit = input.requestedLimit ?? OLDER_PAGE
  const { prevState, evictedFromEnd } = input
  return {
    oldestLoadedSeq: input.newOldestSeq ?? prevState.oldestLoadedSeq,
    newestLoadedSeq:
      evictedFromEnd > 0 ? input.evictedNewestSeq : prevState.newestLoadedSeq,
    hasOlder: input.hasOlder ?? input.returnedCount >= requestedLimit,
    hasNewer: prevState.hasNewer || evictedFromEnd > 0,
    isLoadingOlder: false,
    isLoadingNewer: prevState.isLoadingNewer,
  }
}

/**
 * Returns the new `WindowState` after a newer-page fetch resolves and any
 * head eviction has been applied to the buffer.
 */
export function applyNewerPage(input: {
  prevState: WindowState
  returnedCount: number
  newNewestSeq: number | null
  evictedFromStart: number
  evictedOldestSeq: number | null
  requestedLimit?: number
  hasNewer?: boolean
}): WindowState {
  const requestedLimit = input.requestedLimit ?? OLDER_PAGE
  const { prevState, evictedFromStart } = input
  return {
    oldestLoadedSeq:
      evictedFromStart > 0 ? input.evictedOldestSeq : prevState.oldestLoadedSeq,
    newestLoadedSeq: input.newNewestSeq ?? prevState.newestLoadedSeq,
    hasOlder: prevState.hasOlder || evictedFromStart > 0,
    hasNewer: input.hasNewer ?? input.returnedCount >= requestedLimit,
    isLoadingOlder: prevState.isLoadingOlder,
    isLoadingNewer: false,
  }
}

/**
 * Returns the new `WindowState` after a live patch appended one or more
 * messages at the tail. Caller must only invoke this when `hasNewer` is
 * false (i.e. we are at the live tail).
 */
export function applyLiveAppend(input: {
  prevState: WindowState
  prevLoadedLength: number
  appendedNewestSeq: number | null
  evictedFromStart: number
  evictedOldestSeq: number | null
}): WindowState {
  const { prevState, evictedFromStart } = input
  return {
    oldestLoadedSeq:
      evictedFromStart > 0 ? input.evictedOldestSeq : prevState.oldestLoadedSeq,
    newestLoadedSeq: input.appendedNewestSeq ?? prevState.newestLoadedSeq,
    hasOlder: prevState.hasOlder || evictedFromStart > 0,
    hasNewer: prevState.hasNewer,
    isLoadingOlder: prevState.isLoadingOlder,
    isLoadingNewer: prevState.isLoadingNewer,
  }
}

/**
 * Returns whether the caller is allowed to evict from the start of the buffer
 * during a live append (i.e. we already know more older history exists and is
 * re-fetchable).
 */
export function canEvictFromStartOnLiveAppend(prevState: WindowState): boolean {
  return prevState.hasOlder === true
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
