/**
 * Runtime invariant assertions for `WindowState` + the loaded message buffer.
 *
 * Defence in depth for the fixed-160 sliding-window contract documented in
 * `docs/CHAT_VIRTUALIZATION_PLAN.md` and exercised by the BUG-1 / BUG-3 /
 * BUG-4 fixes (see `docs/audit/frontend-window-audit-2026-06-17.md`). If a
 * future change drifts the buffer out of alignment, this module makes the
 * regression LOUD instead of allowing silent corruption.
 *
 * Behaviour:
 *   - In production (`process.env.NODE_ENV === "production"`) the function
 *     emits `console.warn("[chat-rebuild.window.invariant-violation]", ctx)`
 *     and returns. We never throw in front of a real user.
 *   - Everywhere else (dev / test / preview) the function throws with the
 *     violated rule, the label of the calling site, and the offending state
 *     so tests fail loudly and dev sessions surface the problem immediately.
 *
 * Callers should pass through unconditionally; the gating happens inside the
 * function. That way bundler dead-code elimination cannot accidentally strip
 * the call.
 */

import { MAX_BUFFER, type WindowState } from "./messageWindow"

export type WindowInvariantRow = {
  messageId?: string
  gatewayIndex?: number | null | undefined
}

export type WindowInvariantContext = {
  rule: string
  label: string | undefined
  windowState: WindowState
  detail: Record<string, unknown>
}

export class WindowInvariantViolationError extends Error {
  readonly context: WindowInvariantContext
  constructor(context: WindowInvariantContext) {
    const labelPart = context.label ? ` [${context.label}]` : ""
    super(
      `[chat-rebuild.window.invariant-violation]${labelPart} ${context.rule}: ${JSON.stringify(context.detail)}`,
    )
    this.name = "WindowInvariantViolationError"
    this.context = context
  }
}

function isProduction(): boolean {
  if (typeof process === "undefined") return false
  return process.env?.NODE_ENV === "production"
}

function reportViolation(context: WindowInvariantContext): void {
  if (isProduction()) {
    console.warn("[chat-rebuild.window.invariant-violation]", context)
    return
  }
  throw new WindowInvariantViolationError(context)
}

function isSeqful(row: WindowInvariantRow | undefined): row is WindowInvariantRow & {
  gatewayIndex: number
} {
  if (!row) return false
  const seq = row.gatewayIndex
  return typeof seq === "number" && Number.isFinite(seq)
}

/**
 * Validate the window invariant. Call AFTER any state transition that
 * mutates `windowState` or the loaded `messages` buffer.
 *
 * Invariants checked:
 *   1. `messages.length <= MAX_BUFFER` (currently 400). The window normally
 *      stays at `MAX_LOADED` (160), but BUG-2's deferred-eviction policy
 *      allows live-append at the tail to grow the buffer up to `MAX_BUFFER`
 *      when the user is scrolled away from the bottom. `MAX_BUFFER` is the
 *      hard ceiling — anything beyond it is a real violation (eviction
 *      logic failed to run).
 *   2. Seqful rows are sorted strictly ascending by `gatewayIndex`. Seqless
 *      synthetic rows (e.g. `live:${runId}:tools` before the parent user
 *      message is in window) are skipped \u2014 they do not participate in the
 *      seq ordering.
 *   3. If `windowState.oldestLoadedSeq` is non-null, it matches the FIRST
 *      seqful row's `gatewayIndex`.
 *   4. If `windowState.newestLoadedSeq` is non-null, it matches the LAST
 *      seqful row's `gatewayIndex`.
 *   5. When both seq boundaries are present, `oldestLoadedSeq <=
 *      newestLoadedSeq`.
 */
export function assertWindowInvariant(
  windowState: WindowState,
  messages: ReadonlyArray<WindowInvariantRow>,
  label?: string,
): void {
  // Rule 1: bounded buffer. BUG-2 raised the ceiling from MAX_LOADED to
  // MAX_BUFFER to accommodate deferred-eviction during live-append when the
  // user is not at the bottom. Exceeding MAX_BUFFER means the ceiling-evict
  // logic in ChatView's live-append path failed to fire.
  if (messages.length > MAX_BUFFER) {
    reportViolation({
      rule: "messages.length <= MAX_BUFFER",
      label,
      windowState,
      detail: { length: messages.length, maxBuffer: MAX_BUFFER },
    })
    return
  }

  // Rule 2: strict ASC by seq across seqful rows.
  let lastSeq: number | null = null
  let firstSeqRow: { gatewayIndex: number; index: number } | null = null
  let lastSeqRow: { gatewayIndex: number; index: number } | null = null
  for (let i = 0; i < messages.length; i++) {
    const row = messages[i]
    if (!isSeqful(row)) continue
    const seq = row.gatewayIndex
    if (firstSeqRow === null) firstSeqRow = { gatewayIndex: seq, index: i }
    if (lastSeq !== null && seq <= lastSeq) {
      reportViolation({
        rule: "messages sorted strictly ASC by gatewayIndex",
        label,
        windowState,
        detail: {
          index: i,
          previousSeq: lastSeq,
          currentSeq: seq,
        },
      })
      return
    }
    lastSeq = seq
    lastSeqRow = { gatewayIndex: seq, index: i }
  }

  // Rule 3: oldestLoadedSeq tracks the first seqful row.
  if (
    windowState.oldestLoadedSeq !== null &&
    firstSeqRow !== null &&
    firstSeqRow.gatewayIndex !== windowState.oldestLoadedSeq
  ) {
    reportViolation({
      rule: "oldestLoadedSeq matches first seqful row",
      label,
      windowState,
      detail: {
        oldestLoadedSeq: windowState.oldestLoadedSeq,
        firstSeqfulRowSeq: firstSeqRow.gatewayIndex,
        firstSeqfulRowIndex: firstSeqRow.index,
      },
    })
    return
  }

  // Rule 4: newestLoadedSeq tracks the last seqful row.
  if (
    windowState.newestLoadedSeq !== null &&
    lastSeqRow !== null &&
    lastSeqRow.gatewayIndex !== windowState.newestLoadedSeq
  ) {
    reportViolation({
      rule: "newestLoadedSeq matches last seqful row",
      label,
      windowState,
      detail: {
        newestLoadedSeq: windowState.newestLoadedSeq,
        lastSeqfulRowSeq: lastSeqRow.gatewayIndex,
        lastSeqfulRowIndex: lastSeqRow.index,
      },
    })
    return
  }

  // Rule 5: oldest <= newest when both present.
  if (
    windowState.oldestLoadedSeq !== null &&
    windowState.newestLoadedSeq !== null &&
    windowState.oldestLoadedSeq > windowState.newestLoadedSeq
  ) {
    reportViolation({
      rule: "oldestLoadedSeq <= newestLoadedSeq",
      label,
      windowState,
      detail: {
        oldestLoadedSeq: windowState.oldestLoadedSeq,
        newestLoadedSeq: windowState.newestLoadedSeq,
      },
    })
    return
  }
}
