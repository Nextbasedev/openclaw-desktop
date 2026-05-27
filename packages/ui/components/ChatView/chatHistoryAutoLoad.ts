export const OLDER_HISTORY_AUTO_LOAD_UPPER_RATIO = 0.4

type OlderHistoryAutoLoadInput = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  previousScrollTop: number
  hasUserIntent: boolean
}

export function shouldAutoLoadOlderHistory({
  scrollTop,
  scrollHeight,
  clientHeight,
  previousScrollTop,
  hasUserIntent,
}: OlderHistoryAutoLoadInput) {
  if (!hasUserIntent) return false
  const maxScrollTop = scrollHeight - clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) return false
  if (scrollTop >= previousScrollTop) return false
  const upperThreshold = maxScrollTop * OLDER_HISTORY_AUTO_LOAD_UPPER_RATIO
  return scrollTop <= upperThreshold
}
