export const OLDER_HISTORY_LOAD_REMAINING_RATIO = 0.3
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

function olderHistoryLoadThreshold(scrollHeight: number, clientHeight: number) {
  const maxScrollTop = scrollHeight - clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) return null
  return maxScrollTop * OLDER_HISTORY_LOAD_REMAINING_RATIO
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
  if (scrollTop >= previousScrollTop) return false

  const threshold = olderHistoryLoadThreshold(scrollHeight, clientHeight)
  if (threshold === null || scrollTop > threshold) return false

  if (typeof lastLoadScrollTop !== "number" || !Number.isFinite(lastLoadScrollTop)) {
    return true
  }

  const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
  return lastLoadScrollTop - scrollTop >= rearmDistance
}
