// Gateway/system notices sometimes arrive wearing a "user" role, e.g.
// "System (untrusted): [2026-06-29 11:49:05 UTC] Exec failed ...". These are NOT
// real user turns. If rendered as a user bubble — or allowed to act as a turn
// boundary — they split a single assistant answer into multiple cards.
//
// This is the single shared rule used by BOTH the history parser (reload path)
// and the live turn grouping (streaming path) so the two never disagree. The
// leading "System(...): [<ISO-date>" shape is specific to the gateway injection
// format, so a human typing normally will not trip it.
export const SYSTEM_INJECTION_PREFIX_RE = /^\s*System(?:\s*\([^)]*\))?:\s*\[\d{4}-\d{2}-\d{2}/i

export function isSystemInjectedText(text: string | null | undefined): boolean {
  if (!text) return false
  return SYSTEM_INJECTION_PREFIX_RE.test(text)
}
