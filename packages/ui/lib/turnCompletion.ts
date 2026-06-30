// Helpers for deciding whether the assistant's VISIBLE answer is finished.
//
// The overall run status can stay "active" after the user's answer is complete
// (for example a background sub-agent keeps the run alive). The "Writing…"
// indicator and the per-turn action bar must follow the visible answer, not the
// background run, so they settle as soon as the last assistant turn reaches a
// terminal stop reason.

// Stop reasons that mean "this assistant turn paused to do more work" and will
// continue — NOT that the answer is finished.
export const TURN_CONTINUATION_STOP_REASONS = new Set([
  "tool_use",
  "tool_calls",
  "tool",
  "pause",
  "continue",
])

/**
 * True when a stop reason marks the END of the visible answer. Permissive on
 * purpose: any non-empty reason that is not a known "more work coming" reason is
 * treated as terminal, so an unrecognised terminal reason settles the UI instead
 * of hanging the "Writing…" indicator forever. Empty/missing reason = still
 * streaming (not terminal).
 */
export function isTurnFinalStopReason(reason?: string | null): boolean {
  if (!reason) return false
  return !TURN_CONTINUATION_STOP_REASONS.has(reason.toLowerCase())
}
