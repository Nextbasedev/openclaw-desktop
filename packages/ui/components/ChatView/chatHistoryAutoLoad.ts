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

export function olderHistoryPreloadDistance(clientHeight: number) {
  if (!Number.isFinite(clientHeight) || clientHeight <= 0) return OLDER_HISTORY_PRELOAD_MIN_PX
  return Math.max(OLDER_HISTORY_PRELOAD_MIN_PX, clientHeight * OLDER_HISTORY_PRELOAD_VIEWPORT_RATIO)
}

export function shouldAutoLoadOlderHistory({
  scrollTop,
  scrollHeight,
  clientHeight,
  previousScrollTop,
  hasUserIntent,
  lastLoadScrollTop = null,
}: OlderHistoryAutoLoadInput) {
  if (!hasUserIntent) return false
  const maxScrollTop = scrollHeight - clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) return false
  if (scrollTop >= previousScrollTop) return false

  const preloadDistance = Math.min(maxScrollTop, olderHistoryPreloadDistance(clientHeight))
  if (scrollTop > preloadDistance) return false

  if (typeof lastLoadScrollTop !== "number" || !Number.isFinite(lastLoadScrollTop)) {
    return true
  }

  const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
  return lastLoadScrollTop - scrollTop >= rearmDistance
}
