/**
 * Phase 1 — Core Fixed-Window Virtualization
 *
 * Pure helpers for a fixed-size sliding message window. The window is
 * a contiguous slice of the loaded messages array sized to roughly
 * `WINDOW_PAGES * PAGE_SIZE` messages.
 *
 * Design priority (per user):
 *   1. Correctness
 *   2. Stability
 *   3. Smooth scrolling
 *   4. Constant memory usage
 *   5. Simplicity
 *   6. Performance optimization
 *
 * Intentionally no chunk-pool, no tombstones, no LRU, no eviction policy.
 * The window is just two integers (start seq, end seq) plus the page-size
 * load/unload step.
 */

export const PAGE_SIZE = 60
export const WINDOW_PAGES = 5
export const WINDOW_SIZE = PAGE_SIZE * WINDOW_PAGES // 300
export const LOAD_THRESHOLD_RATIO = 0.2 // load when 20% from edge

export type SequencedMessage = {
  // The canonical server seq for this message (openclaw seq / gatewayIndex).
  // May be undefined for optimistic / not-yet-acked sends.
  gatewayIndex?: number
  // Optimistic messages must NEVER be trimmed by the window.
  isOptimistic?: boolean
  // Pending-send messages must NEVER be trimmed by the window.
  sendStatus?: string
}

/**
 * Decide whether the window is over its target size and needs to drop a
 * page. Returns the number of messages to drop from the requested edge.
 */
export function pageDropCount(
  totalLoaded: number,
  options: { pageSize?: number; windowSize?: number } = {},
): number {
  const pageSize = options.pageSize ?? PAGE_SIZE
  const windowSize = options.windowSize ?? WINDOW_SIZE
  if (totalLoaded <= windowSize) return 0
  // Drop one page at a time, even if we're more than one page over.
  return pageSize
}

/**
 * Split a sorted-by-seq messages array into a trimmable head/tail and a
 * protected middle (optimistic / pending). Optimistic messages bubble to
 * the end of the array in normal use, so the protected set is typically
 * a contiguous suffix.
 */
export function classifyMessagesForTrim<T extends SequencedMessage>(
  messages: readonly T[],
): {
  trimmableHeadEnd: number // exclusive — messages[0..trimmableHeadEnd) are trimmable from the top
  trimmableTailStart: number // inclusive — messages[trimmableTailStart..) are trimmable from the bottom
} {
  // Walk from the start finding the first protected message: everything
  // before it is trimmable from the top.
  let trimmableHeadEnd = messages.length
  for (let i = 0; i < messages.length; i += 1) {
    if (isProtected(messages[i])) {
      trimmableHeadEnd = i
      break
    }
  }
  // Walk from the end finding the last protected message: everything
  // after it is trimmable from the bottom.
  let trimmableTailStart = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isProtected(messages[i])) {
      trimmableTailStart = i + 1
      break
    }
  }
  // If there are no protected messages at all, everything is trimmable
  // on both ends.
  if (!messages.some(isProtected)) {
    return { trimmableHeadEnd: messages.length, trimmableTailStart: 0 }
  }
  return { trimmableHeadEnd, trimmableTailStart }
}

function isProtected<T extends SequencedMessage>(message: T): boolean {
  return Boolean(message.isOptimistic) || Boolean(message.sendStatus)
}

/**
 * Compute the indices of messages to drop from the TOP of the array
 * during a slide-down (when the user scrolls toward newer content and
 * the window is over size).
 *
 * Returns `{ dropCount: 0 }` if no trim is needed or possible.
 */
export function planDropFromTop<T extends SequencedMessage>(
  messages: readonly T[],
  options: { pageSize?: number; windowSize?: number } = {},
): { dropCount: number } {
  const target = pageDropCount(messages.length, options)
  if (target === 0) return { dropCount: 0 }
  const { trimmableHeadEnd } = classifyMessagesForTrim(messages)
  return { dropCount: Math.min(target, trimmableHeadEnd) }
}

/**
 * Compute the indices of messages to drop from the BOTTOM of the array
 * during a slide-up (when the user scrolls toward older content and the
 * window is over size).
 */
export function planDropFromBottom<T extends SequencedMessage>(
  messages: readonly T[],
  options: { pageSize?: number; windowSize?: number } = {},
): { dropCount: number } {
  const target = pageDropCount(messages.length, options)
  if (target === 0) return { dropCount: 0 }
  const { trimmableTailStart } = classifyMessagesForTrim(messages)
  const trimmableTailLen = messages.length - trimmableTailStart
  return { dropCount: Math.min(target, trimmableTailLen) }
}

/**
 * Convenience: produce a trimmed messages array given a drop spec.
 */
export function applyTrim<T extends SequencedMessage>(
  messages: readonly T[],
  spec: { dropFromTop?: number; dropFromBottom?: number },
): T[] {
  const dropTop = Math.max(0, spec.dropFromTop ?? 0)
  const dropBottom = Math.max(0, spec.dropFromBottom ?? 0)
  if (dropTop === 0 && dropBottom === 0) return [...messages]
  return messages.slice(dropTop, messages.length - dropBottom)
}

/**
 * Read scrollTop / scrollHeight / clientHeight and decide which edge
 * (if any) is within `LOAD_THRESHOLD_RATIO` of the user. Returns:
 *   "top"    — load older
 *   "bottom" — load newer
 *   null     — neither
 */
export function detectEdgeProximity(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  thresholdRatio?: number
}): "top" | "bottom" | null {
  const ratio = input.thresholdRatio ?? LOAD_THRESHOLD_RATIO
  const max = input.scrollHeight - input.clientHeight
  if (max <= 0) return null
  const fromTop = input.scrollTop
  const fromBottom = max - input.scrollTop
  if (fromTop <= input.scrollHeight * ratio) return "top"
  if (fromBottom <= input.scrollHeight * ratio) return "bottom"
  return null
}
