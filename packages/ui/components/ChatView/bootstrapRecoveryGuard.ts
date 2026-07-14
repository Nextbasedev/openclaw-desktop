import type { StreamStatus } from "@/components/ChatView/types"
import { isActiveRunStatus } from "@/lib/chat-engine-v2/activeRunRegistry"

/**
 * Minimum gap between two consecutive resetToLiveTail() calls triggered by
 * bootstrap-recovery events. Old sessions whose persisted cursor is far ahead
 * of the gateway's SSE replay buffer can emit replay-buffer-exceeded `hello` frames
 * on every SSE (re)connect; without this guard the UI runs resetToLiveTail in a
 * loop, producing a constant skeleton ↔ messages blink.
 */
export const RECOVERY_DEBOUNCE_MS = 4000

/**
 * Grace period after a successful cold-bootstrap (or successful full-history reload)
 * during which incoming bootstrap-recovery events are treated as redundant and
 * skipped. The motivation: when the user clicks into an existing session,
 *
 *   1. ChatView mounts with state.loading=true → ChatLoadingSkeleton (#1)
 *   2. fetchChatMessagesV2 resolves → setState(loading:false, messages) →
 *      messages render
 *   3. The SSE patch stream connects → hello frame arrives → if the persisted
 *      cursor is past the gateway's SSE replay buffer the server emits
 *      replayWindowExceeded=true → client.ts dispatches
 *      `openclaw:chat-bootstrap-recovery`
 *   4. ChatView's recovery handler runs resetToLiveTail → setState(loading:true,
 *      messages:[]) → ChatLoadingSkeleton (#2)
 *   5. Fetch resolves → messages render again
 *
 * The view at step (3) is already up-to-date with the gateway because step (2)
 * just fetched the full history. The recovery would only re-fetch the same history.
 * This grace period suppresses that wasted reset so the second skeleton blink
 * does not occur. The debounce alone (RECOVERY_DEBOUNCE_MS) cannot fix this:
 * it only protects against the SECOND and later events in a burst — the first
 * one still slips through, which is what produces Krish's "single blink" case.
 *
 * 2500ms is long enough to cover the worst-case SSE hello/connect race after a
 * cold bootstrap on slow machines but short enough that genuine recoveries
 * (e.g., a long-lived tab whose server epoch reset) still recover within a
 * normal UX debounce period.
 */
export const RECOVERY_GRACE_AFTER_BOOTSTRAP_MS = 2500

export type BootstrapRecoveryDecisionReason =
  | "skipped-active-run"
  | "skipped-loading"
  | "skipped-recent-bootstrap"
  | "debounced"
  | "apply"

export interface BootstrapRecoveryDecisionInput {
  /** Current ChatView state.loading. */
  isLoading: boolean
  /** Current ChatView state.streamStatus. */
  streamStatus: StreamStatus
  /** Whether the current rendered messages contain any user message. */
  hasUserMessage: boolean
  /** Wall-clock ms since epoch when the most recent cold-bootstrap or
   *  resetToLiveTail finished successfully. 0 if none yet. */
  lastBootstrapCompletedAt: number
  /** Wall-clock ms since epoch when the previous bootstrap-recovery handler
   *  invocation accepted (debounce reference). 0 if none yet. */
  lastRecoveryAt: number
  /** Wall-clock now used for both grace and debounce comparisons. */
  now: number
  /** Override debounce periods in tests. */
  graceAfterBootstrapMs?: number
  debounceMs?: number
}

export interface BootstrapRecoveryDecision {
  apply: boolean
  reason: BootstrapRecoveryDecisionReason
  /** Time elapsed since last recovery when `reason === "debounced"`, or since
   *  bootstrap when `reason === "skipped-recent-bootstrap"`. Undefined
   *  otherwise. Useful for diagnostics logging. */
  elapsedMs?: number
}

/**
 * Pure decision: given the current ChatView state and timing refs, should the
 * incoming openclaw:chat-bootstrap-recovery event run resetToLiveTail or be
 * skipped? Skips are layered (most specific first) so diagnostics can identify
 * the suppression reason.
 */
export function decideBootstrapRecovery(
  input: BootstrapRecoveryDecisionInput,
): BootstrapRecoveryDecision {
  const grace = input.graceAfterBootstrapMs ?? RECOVERY_GRACE_AFTER_BOOTSTRAP_MS
  const debounce = input.debounceMs ?? RECOVERY_DEBOUNCE_MS

  // 1. Active-run guard: a fresh send is in flight (optimistic user bubble +
  //    thinking/tool-running). Resetting would briefly swap to a full skeleton
  //    and lose the optimistic bubble until patches re-arrive.
  if (isActiveRunStatus(input.streamStatus) && input.hasUserMessage) {
    return { apply: false, reason: "skipped-active-run" }
  }

  // 2. In-flight bootstrap guard: a previous reset has not resolved yet. A
  //    second reset would thrash the messages array and steal focus.
  if (input.isLoading) {
    return { apply: false, reason: "skipped-loading" }
  }

  // 3. Recent-bootstrap guard: the cold-bootstrap (or last resetToLiveTail)
  //    completed within the grace period. The visible view is already fresh —
  //    the recovery would simply re-fetch the same page and cause a skeleton
  //    blink. This is the primary fix for the single "skeleton → messages →
  //    skeleton → messages" blink on the first click into an existing session
  //    whose persisted cursor is past the SSE replay buffer.
  if (input.lastBootstrapCompletedAt > 0) {
    const elapsedSinceBootstrap = input.now - input.lastBootstrapCompletedAt
    if (elapsedSinceBootstrap >= 0 && elapsedSinceBootstrap < grace) {
      return {
        apply: false,
        reason: "skipped-recent-bootstrap",
        elapsedMs: elapsedSinceBootstrap,
      }
    }
  }

  // 4. Debounce guard: ignore recoveries that arrive shortly after the previous
  //    accepted one. Protects against rapid SSE recovery storms on old sessions
  //    in a reconnect loop.
  if (input.lastRecoveryAt > 0) {
    const elapsedSinceRecovery = input.now - input.lastRecoveryAt
    if (elapsedSinceRecovery >= 0 && elapsedSinceRecovery < debounce) {
      return {
        apply: false,
        reason: "debounced",
        elapsedMs: elapsedSinceRecovery,
      }
    }
  }

  return { apply: true, reason: "apply" }
}
