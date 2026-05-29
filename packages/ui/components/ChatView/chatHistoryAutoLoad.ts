export const OLDER_HISTORY_PRELOAD_VIEWPORT_RATIO = 1.5
export const OLDER_HISTORY_PRELOAD_MIN_PX = 800
export const OLDER_HISTORY_REARM_VIEWPORT_RATIO = 0.75
export const OLDER_HISTORY_REARM_MIN_PX = 500

type OlderHistoryAutoLoadInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  previousScrollTop: number
  hasUserIntent: boolean
  lastLoadScrollTop?: number | null
}

type OlderHistoryPreloadAtRestInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  hasUserIntent: boolean
}

export function olderHistoryPreloadDistance(clientHeight: number) {
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return OLDER_HISTORY_PRELOAD_MIN_PX
  return Math.max(OLDER_HISTORY_PRELOAD_MIN_PX, clientHeight * OLDER_HISTORY_PRELOAD_VIEWPORT_RATIO)
}

export function shouldPreloadOlderHistoryAtRest({
  scrollTop,
  scrollHeight,
  clientHeight,
  hasUserIntent,
}: OlderHistoryPreloadAtRestInput) {
  if (!hasUserIntent) return false
  const maxScrollTop = scrollHeight - clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) return false
  const preloadDistance = Math.min(maxScrollTop, olderHistoryPreloadDistance(clientHeight))
  return scrollTop <= preloadDistance
}

export function shouldAutoLoadOlderHistory({
  scrollTop,
  scrollHeight,
  clientHeight,
  previousScrollTop,
  hasUserIntent,
  lastLoadScrollTop = null,
}: OlderHistoryAutoLoadInput) {
  if (scrollTop >= previousScrollTop) return false
  if (!shouldPreloadOlderHistoryAtRest({ scrollTop, scrollHeight, clientHeight, hasUserIntent })) return false

  if (typeof lastLoadScrollTop !== "number" || !Number.isFinite(lastLoadScrollTop)) {
    return true
  }

  const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
  return lastLoadScrollTop - scrollTop >= rearmDistance
}
