// Single, dead-simple rule (2026-06-13 simplification per Krish): if the
// user is scrolling upward and the top of the loaded history is within one
// viewport above the current scroll position, load the next 100 older
// messages. Concurrent-load gating + per-call cooldown live in ChatView
// (loadOlderInFlightRef + lastOlderLoadAtRef 900ms). Everything else —
// fast-scroll preload, rearm distances, ratio thresholds — is gone because
// it was firing multiple back-to-back loads on a single user swipe and
// producing the "loads many messages back" jitter.
export const OLDER_HISTORY_LOAD_REMAINING_RATIO = 0.6 // kept for back-compat exports

type OlderHistoryAutoLoadInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  previousScrollTop: number
  // Remaining fields are kept in the type for back-compat with existing
  // call sites; they are unused by the simplified rule.
  hasUserIntent?: boolean
  lastLoadScrollTop?: number | null
  currentTimeMs?: number
  previousScrollTimeMs?: number
}

export function shouldAutoLoadOlderHistory({
  scrollTop,
  scrollHeight,
  clientHeight,
  previousScrollTop,
}: OlderHistoryAutoLoadInput) {
  // Scrolling upward only.
  if (scrollTop >= previousScrollTop) return false
  // No history visible yet — nothing to do.
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false
  if (scrollHeight <= clientHeight) return false
  // One viewport from the top. That's the whole rule.
  return scrollTop <= clientHeight
}
