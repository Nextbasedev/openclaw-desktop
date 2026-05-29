export const OLDER_HISTORY_AUTO_LOAD_SCROLL_UP_RATIO = 0.6
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
  // Preload one older page while there is still roughly 40% of the
  // currently loaded history above the viewport. Do not require a strict
  // previous>threshold crossing: virtualization measurement and anchor
  // restoration can move the threshold between scroll events, leaving the
  // user already inside the load zone without ever satisfying that edge.
  const loadThreshold = maxScrollTop * OLDER_HISTORY_AUTO_LOAD_SCROLL_UP_RATIO
  if (scrollTop > loadThreshold) return false

  if (typeof lastLoadScrollTop === "number" && Number.isFinite(lastLoadScrollTop)) {
    const rearmDistance = Math.max(OLDER_HISTORY_REARM_MIN_PX, clientHeight * OLDER_HISTORY_REARM_VIEWPORT_RATIO)
    return lastLoadScrollTop - scrollTop >= rearmDistance
  }

  return true
}
