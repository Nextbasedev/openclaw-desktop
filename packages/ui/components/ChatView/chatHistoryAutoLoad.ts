export const OLDER_HISTORY_LOAD_REMAINING_RATIO = 0.6
export const OLDER_HISTORY_FAST_SCROLL_REMAINING_RATIO = 0.85
export const OLDER_HISTORY_FAST_SCROLL_MIN_DELTA_PX = 240
export const OLDER_HISTORY_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS = 1.1
export const OLDER_HISTORY_REARM_VIEWPORT_RATIO = 0.75
export const OLDER_HISTORY_REARM_MIN_PX = 500
export const OLDER_HISTORY_NEAR_TOP_PX = 96
export const OLDER_HISTORY_PREFETCH_ROOT_MARGIN_VIEWPORTS = 2
export const OLDER_HISTORY_PREFETCH_MIN_MARGIN_PX = 900

type OlderHistoryAutoLoadInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  previousScrollTop: number
  hasUserIntent: boolean
  lastLoadScrollTop?: number | null
  currentTimeMs?: number
  previousScrollTimeMs?: number
}

type OlderHistoryPrefetchInput = {
  isIntersecting: boolean
  hasOlderMessages: boolean
  isFetchInFlight: boolean
  isGenerating: boolean
  hasUserIntent: boolean
  autoLoadBlockedUntilMs?: number
  currentTimeMs?: number
}

export function olderHistoryPrefetchRootMargin(clientHeight: number) {
  const marginPx = Math.max(
    OLDER_HISTORY_PREFETCH_MIN_MARGIN_PX,
    Math.round(Math.max(0, clientHeight) * OLDER_HISTORY_PREFETCH_ROOT_MARGIN_VIEWPORTS)
  )
  return `${marginPx}px 0px 0px 0px`
}

export function shouldPrefetchOlderHistory({
  isIntersecting,
  hasOlderMessages,
  isFetchInFlight,
  isGenerating,
  hasUserIntent,
  autoLoadBlockedUntilMs = 0,
  currentTimeMs = Date.now(),
}: OlderHistoryPrefetchInput) {
  return Boolean(
    isIntersecting &&
    hasOlderMessages &&
    !isFetchInFlight &&
    !isGenerating &&
    hasUserIntent &&
    currentTimeMs >= autoLoadBlockedUntilMs
  )
}

function olderHistoryLoadThreshold(scrollHeight: number, clientHeight: number, remainingRatio = OLDER_HISTORY_LOAD_REMAINING_RATIO) {
  const maxScrollTop = scrollHeight - clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) return null
  return maxScrollTop * remainingRatio
}

function isFastUpwardScroll({
  scrollTop,
  previousScrollTop,
  currentTimeMs,
  previousScrollTimeMs,
}: Pick<OlderHistoryAutoLoadInput, "scrollTop" | "previousScrollTop" | "currentTimeMs" | "previousScrollTimeMs">) {
  const upwardDeltaPx = previousScrollTop - scrollTop
  if (upwardDeltaPx < OLDER_HISTORY_FAST_SCROLL_MIN_DELTA_PX) return false
  if (typeof currentTimeMs !== "number" || typeof previousScrollTimeMs !== "number") return false

  const elapsedMs = currentTimeMs - previousScrollTimeMs
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return false

  return upwardDeltaPx / elapsedMs >= OLDER_HISTORY_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS
}

export function shouldAutoLoadOlderHistory({
  scrollTop,
  scrollHeight,
  clientHeight,
  previousScrollTop,
  hasUserIntent,
  lastLoadScrollTop = null,
  currentTimeMs,
  previousScrollTimeMs,
}: OlderHistoryAutoLoadInput) {
  if (!hasUserIntent) return false

  const threshold = olderHistoryLoadThreshold(scrollHeight, clientHeight)
  if (threshold === null) return false

  // Direct scrollbar/page jumps can land at the very top before our previous
  // scroll position ref has observed the programmatic initial bottom scroll.
  // Treat a genuine user-driven near-top position as load-worthy even when the
  // stale previous value would otherwise make the delta look non-upward.
  if (scrollTop <= OLDER_HISTORY_NEAR_TOP_PX) {
    if (typeof lastLoadScrollTop !== "number" || !Number.isFinite(lastLoadScrollTop)) return true
    const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
    return lastLoadScrollTop - scrollTop >= rearmDistance
  }

  if (scrollTop >= previousScrollTop) return false

  const fastThreshold = olderHistoryLoadThreshold(scrollHeight, clientHeight, OLDER_HISTORY_FAST_SCROLL_REMAINING_RATIO)
  const fastScrollPreload =
    fastThreshold !== null &&
    scrollTop <= fastThreshold &&
    isFastUpwardScroll({ scrollTop, previousScrollTop, currentTimeMs, previousScrollTimeMs })
  const activeThreshold = fastScrollPreload ? fastThreshold : threshold
  if (scrollTop > activeThreshold) return false

  const crossedIntoLoadZone = previousScrollTop > activeThreshold && scrollTop <= activeThreshold
  if (crossedIntoLoadZone) return true

  if (typeof lastLoadScrollTop !== "number" || !Number.isFinite(lastLoadScrollTop)) {
    return true
  }

  const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
  return lastLoadScrollTop - scrollTop >= rearmDistance
}
