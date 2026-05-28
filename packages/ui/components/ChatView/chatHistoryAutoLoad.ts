export const OLDER_HISTORY_AUTO_LOAD_UPPER_RATIO = 0.6
export const OLDER_HISTORY_REARM_VIEWPORT_RATIO = 0.6
export const OLDER_HISTORY_REARM_MIN_PX = 320
export const OLDER_HISTORY_TOP_LOAD_PX = 96

type OlderHistoryAutoLoadInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  previousScrollTop: number
  hasUserIntent: boolean
  lastLoadScrollTop?: number | null
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
  if (scrollTop <= OLDER_HISTORY_TOP_LOAD_PX) return true
  if (scrollTop >= previousScrollTop) return false
  const upperThreshold = maxScrollTop * OLDER_HISTORY_AUTO_LOAD_UPPER_RATIO
  const crossedUpperThreshold = previousScrollTop > upperThreshold && scrollTop <= upperThreshold
  if (crossedUpperThreshold) return true

  if (typeof lastLoadScrollTop === "number" && Number.isFinite(lastLoadScrollTop) && scrollTop <= upperThreshold) {
    const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
    return lastLoadScrollTop - scrollTop >= rearmDistance
  }

  return false
}
