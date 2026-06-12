/**
 * Pure helpers for the Telegram-style sliced message window.
 *
 * The chat-engine-v2 store keeps every message; this module only computes
 * *which contiguous range* of those messages should be projected into the
 * rendered ChatView at any given moment. It is intentionally pure — no React,
 * no DOM, no I/O — so it stays trivial to unit-test.
 *
 * Mirrors how `telegram-tt` keeps `messageIds` capped to
 * `MESSAGE_LIST_SLICE` (60) / `MESSAGE_LIST_VIEWPORT_LIMIT` (120) and grows /
 * trims it on scroll triggers, see:
 *   https://github.com/Ajaxy/telegram-tt/blob/master/src/config.ts
 */

/** Base slice size we keep mounted under normal conditions. */
export const SLICE_SIZE = 60
/** How many messages we add when a top/bottom sentinel triggers an extend. */
export const EXTEND_PAGE_SIZE = 30
/** Hard ceiling — we trim the opposite end once we exceed this size. */
export const MAX_SLICE_SIZE = 120
/** How many rows we trim from the opposite end after an extend. */
export const TRIM_BATCH_SIZE = 30

/**
 * Minimal shape we need from a message for sequencing decisions. Real
 * messages carry far more, but the slice math only depends on a stable,
 * monotonic sequence number (gateway seq / openclaw seq).
 */
export type SequencedMessage = {
  /** Stable display id for anchor-based scroll restoration. */
  uiId?: string
  /** Stable message id (used for jump-to-message lookups). */
  messageId?: string
  /** Stable monotonic ordering key. Required. */
  seq: number
}

export type SliceWindow = {
  /** Inclusive index into the full `messages[]` array. */
  startIndex: number
  /** Inclusive index. -1 when no rows. */
  endIndex: number
  /** True when `endIndex === messages.length - 1`. */
  isAtNewest: boolean
}

/**
 * The default window covers the newest `SLICE_SIZE` messages — Telegram's
 * "user just opened the chat, sees the most recent messages" entry path.
 */
export function initialSliceWindow(totalMessages: number, sliceSize = SLICE_SIZE): SliceWindow {
  if (totalMessages <= 0) {
    return { startIndex: 0, endIndex: -1, isAtNewest: true }
  }
  const endIndex = totalMessages - 1
  const startIndex = Math.max(0, endIndex - sliceSize + 1)
  return { startIndex, endIndex, isAtNewest: true }
}

/**
 * Project the sliced subset out of the canonical messages array. Pure slice;
 * the caller can still memoize by the window bounds.
 */
export function sliceMessages<T>(messages: readonly T[], window: SliceWindow): T[] {
  if (window.endIndex < window.startIndex) return []
  return messages.slice(window.startIndex, window.endIndex + 1)
}

/** A row count, clamped to >= 0. */
function sliceLength(window: SliceWindow): number {
  if (window.endIndex < window.startIndex) return 0
  return window.endIndex - window.startIndex + 1
}

export type ExtendOptions = {
  /** How many rows to add. Defaults to `EXTEND_PAGE_SIZE`. */
  pageSize?: number
  /** Slice-size soft ceiling. Defaults to `MAX_SLICE_SIZE`. */
  maxSliceSize?: number
  /** Trim batch from the opposite end. Defaults to `TRIM_BATCH_SIZE`. */
  trimBatchSize?: number
  /**
   * When true, never trim the newest end (the "live tail" — streaming row
   * sits there). The caller passes this while a generation is active and
   * `isAtNewest` is true so the streaming row never gets evicted mid-stream.
   */
  preserveTail?: boolean
}

export type ExtendResult = {
  window: SliceWindow
  /** True when there is no older data left in the in-memory array. */
  reachedStart: boolean
  /** True when there is no newer data left in the in-memory array. */
  reachedEnd: boolean
  /** True when we trimmed rows from the opposite end. */
  trimmed: boolean
}

/**
 * Grow the window toward older messages. Trims the newest end if the
 * resulting window would exceed `maxSliceSize`, unless `preserveTail` is set.
 */
export function extendOlder(
  current: SliceWindow,
  totalMessages: number,
  options: ExtendOptions = {},
): ExtendResult {
  const pageSize = options.pageSize ?? EXTEND_PAGE_SIZE
  const maxSliceSize = options.maxSliceSize ?? MAX_SLICE_SIZE
  const trimBatchSize = options.trimBatchSize ?? TRIM_BATCH_SIZE

  if (totalMessages <= 0) {
    return {
      window: { startIndex: 0, endIndex: -1, isAtNewest: true },
      reachedStart: true,
      reachedEnd: true,
      trimmed: false,
    }
  }

  const nextStart = Math.max(0, current.startIndex - pageSize)
  let nextEnd = current.endIndex
  let trimmed = false

  const candidateLength = nextEnd - nextStart + 1
  if (candidateLength > maxSliceSize && !options.preserveTail) {
    nextEnd = Math.max(nextStart, nextEnd - trimBatchSize)
    trimmed = true
  }

  const window: SliceWindow = {
    startIndex: nextStart,
    endIndex: nextEnd,
    isAtNewest: nextEnd === totalMessages - 1,
  }
  return {
    window,
    reachedStart: nextStart === 0,
    reachedEnd: nextEnd === totalMessages - 1,
    trimmed,
  }
}

/**
 * Grow the window toward newer messages. Trims the oldest end if the
 * resulting window would exceed `maxSliceSize`.
 */
export function extendNewer(
  current: SliceWindow,
  totalMessages: number,
  options: ExtendOptions = {},
): ExtendResult {
  const pageSize = options.pageSize ?? EXTEND_PAGE_SIZE
  const maxSliceSize = options.maxSliceSize ?? MAX_SLICE_SIZE
  const trimBatchSize = options.trimBatchSize ?? TRIM_BATCH_SIZE

  if (totalMessages <= 0) {
    return {
      window: { startIndex: 0, endIndex: -1, isAtNewest: true },
      reachedStart: true,
      reachedEnd: true,
      trimmed: false,
    }
  }

  const lastIndex = totalMessages - 1
  const nextEnd = Math.min(lastIndex, current.endIndex + pageSize)
  let nextStart = current.startIndex
  let trimmed = false

  const candidateLength = nextEnd - nextStart + 1
  if (candidateLength > maxSliceSize) {
    nextStart = Math.min(nextEnd, nextStart + trimBatchSize)
    trimmed = true
  }

  const window: SliceWindow = {
    startIndex: nextStart,
    endIndex: nextEnd,
    isAtNewest: nextEnd === lastIndex,
  }
  return {
    window,
    reachedStart: nextStart === 0,
    reachedEnd: nextEnd === lastIndex,
    trimmed,
  }
}

/**
 * Recenter the window around a target index (e.g. Ctrl+K → scroll to message).
 * Keeps the window size at roughly `sliceSize`.
 */
export function recenterAround(
  totalMessages: number,
  targetIndex: number,
  sliceSize = SLICE_SIZE,
): SliceWindow {
  if (totalMessages <= 0 || targetIndex < 0 || targetIndex >= totalMessages) {
    return initialSliceWindow(totalMessages, sliceSize)
  }
  const half = Math.floor(sliceSize / 2)
  let startIndex = Math.max(0, targetIndex - half)
  let endIndex = Math.min(totalMessages - 1, startIndex + sliceSize - 1)
  // If we hit the right edge, push start back so we still get `sliceSize` rows.
  startIndex = Math.max(0, endIndex - sliceSize + 1)
  return {
    startIndex,
    endIndex,
    isAtNewest: endIndex === totalMessages - 1,
  }
}

/**
 * Reacts to a new live message arriving from the WebSocket stream. If the
 * caller is currently pinned to the newest end, the window grows to include
 * the new row and trims the head if needed. Otherwise we leave the window
 * alone so the user's read position is preserved.
 */
export function applyLiveMessageArrival(
  current: SliceWindow,
  totalMessages: number,
  options: { maxSliceSize?: number; trimBatchSize?: number } = {},
): SliceWindow {
  if (!current.isAtNewest) return current
  if (totalMessages <= 0) return { startIndex: 0, endIndex: -1, isAtNewest: true }

  const maxSliceSize = options.maxSliceSize ?? MAX_SLICE_SIZE
  const trimBatchSize = options.trimBatchSize ?? TRIM_BATCH_SIZE
  const lastIndex = totalMessages - 1
  let startIndex = current.startIndex
  const endIndex = lastIndex

  const candidateLength = endIndex - startIndex + 1
  if (candidateLength > maxSliceSize) {
    startIndex = Math.min(endIndex, startIndex + trimBatchSize)
  }
  return { startIndex, endIndex, isAtNewest: true }
}

/**
 * Force the slice to cover the newest messages and pin to the live tail —
 * used by Jump-to-Bottom.
 */
export function pinToNewest(totalMessages: number, sliceSize = SLICE_SIZE): SliceWindow {
  return initialSliceWindow(totalMessages, sliceSize)
}

/**
 * Translate a (uiId or messageId) lookup into an index in the full
 * messages array. Returns -1 if not found.
 */
export function findMessageIndexById<T extends { uiId?: string; messageId?: string }>(
  messages: readonly T[],
  id: string,
): number {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]
    if (m.uiId === id || m.messageId === id) return i
  }
  return -1
}

export { sliceLength }
