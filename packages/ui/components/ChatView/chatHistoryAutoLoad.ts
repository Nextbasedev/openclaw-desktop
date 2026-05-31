export const OLDER_HISTORY_LOAD_REMAINING_RATIO = 0.6
export const OLDER_HISTORY_FAST_SCROLL_REMAINING_RATIO = 0.85
export const OLDER_HISTORY_FAST_SCROLL_MIN_DELTA_PX = 240
export const OLDER_HISTORY_FAST_SCROLL_MIN_VELOCITY_PX_PER_MS = 1.1
export const OLDER_HISTORY_REARM_VIEWPORT_RATIO = 0.75
export const OLDER_HISTORY_REARM_MIN_PX = 500

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
  if (scrollTop >= previousScrollTop) return false

  const threshold = olderHistoryLoadThreshold(scrollHeight, clientHeight)
  if (threshold === null) return false

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
