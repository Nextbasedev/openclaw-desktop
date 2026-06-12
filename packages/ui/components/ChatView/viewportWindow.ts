/**
 * Pure helpers for viewport-windowed message rendering in ChatView.
 *
 * The render path uses these helpers to decide:
 *   - which contiguous slice of `renderedMessages` to mount
 *   - how tall the top/bottom spacers should be so the scrollbar stays stable
 *   - where a row is positioned in the scroll container (for jump-to-message
 *     and older-history anchor restoration when the target row is unmounted)
 *
 * IMPORTANT: this module is pure — no React, no DOM. All side-effects live in
 * ChatView/index.tsx so this file stays trivially unit-testable.
 */

export const ESTIMATED_ROW_HEIGHT_PX = 140
export const OVERSCAN_VIEWPORTS = 1
export const MIN_OVERSCAN_PX = 600

export type RowHeightLookup = (uiId: string) => number | undefined

export type RowOffset = {
  uiId: string
  top: number
  height: number
}

export type ComputedOffsets = {
  offsets: RowOffset[]
  /** Total height of all rows (top of bottom spacer = totalHeight). */
  totalHeight: number
}

/**
 * Compute per-row top offsets given the ordered list of message ids and a
 * lookup for measured heights. Unmeasured rows fall back to
 * `estimatedHeightPx` so the scrollbar stays stable from the first paint.
 */
export function computeOffsets(
  rowIds: readonly string[],
  getHeight: RowHeightLookup,
  estimatedHeightPx: number = ESTIMATED_ROW_HEIGHT_PX,
): ComputedOffsets {
  const offsets: RowOffset[] = []
  let top = 0
  for (const uiId of rowIds) {
    const measured = getHeight(uiId)
    const height = typeof measured === "number" && Number.isFinite(measured) && measured > 0
      ? measured
      : estimatedHeightPx
    offsets.push({ uiId, top, height })
    top += height
  }
  return { offsets, totalHeight: top }
}

export type VisibleRangeInput = {
  scrollTop: number
  clientHeight: number
  offsets: readonly RowOffset[]
  /** Overscan in pixels on each side. If omitted, derived from clientHeight. */
  overscanPx?: number
}

export type VisibleRange = {
  firstIndex: number
  lastIndex: number
  topSpacerPx: number
  bottomSpacerPx: number
}

/**
 * Find the contiguous [firstIndex, lastIndex] slice whose rows intersect the
 * viewport expanded by `overscanPx` on each side. Returns empty range
 * (firstIndex=0, lastIndex=-1) when there are no rows.
 */
export function computeVisibleRange({
  scrollTop,
  clientHeight,
  offsets,
  overscanPx,
}: VisibleRangeInput): VisibleRange {
  if (offsets.length === 0) {
    return { firstIndex: 0, lastIndex: -1, topSpacerPx: 0, bottomSpacerPx: 0 }
  }
  const overscan = typeof overscanPx === "number" && overscanPx >= 0
    ? overscanPx
    : Math.max(MIN_OVERSCAN_PX, clientHeight * OVERSCAN_VIEWPORTS)
  const viewportTop = scrollTop - overscan
  const viewportBottom = scrollTop + clientHeight + overscan

  // Binary search for first row whose bottom >= viewportTop.
  let lo = 0
  let hi = offsets.length - 1
  let firstIndex = offsets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = offsets[mid]
    const rowBottom = row.top + row.height
    if (rowBottom >= viewportTop) {
      firstIndex = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  // Linear walk forward for last row whose top <= viewportBottom.
  let lastIndex = firstIndex
  for (let i = firstIndex; i < offsets.length; i += 1) {
    if (offsets[i].top > viewportBottom) break
    lastIndex = i
  }

  const lastRow = offsets[lastIndex]
  const firstRow = offsets[firstIndex]
  const totalHeight = offsets[offsets.length - 1].top + offsets[offsets.length - 1].height
  const topSpacerPx = Math.max(0, firstRow.top)
  const bottomSpacerPx = Math.max(0, totalHeight - (lastRow.top + lastRow.height))

  return { firstIndex, lastIndex, topSpacerPx, bottomSpacerPx }
}

/** Find a row's offset by uiId. Returns null if not present. */
export function findRowOffset(offsets: readonly RowOffset[], uiId: string): RowOffset | null {
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i].uiId === uiId) return offsets[i]
  }
  return null
}

/**
 * After a prepend of older messages, restore scroll so the anchor row stays
 * visually in the same place. `offsetWithinViewport` is how far below the
 * scroll container's top the anchor used to sit before the prepend.
 */
export function offsetBasedScrollRestoration(params: {
  anchorTop: number
  offsetWithinViewport: number
}): number {
  return Math.max(0, params.anchorTop - params.offsetWithinViewport)
}
