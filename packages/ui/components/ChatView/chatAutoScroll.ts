export const CHAT_BOTTOM_STICKY_THRESHOLD_PX = 120

export function isNearChatBottom(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  thresholdPx?: number
}) {
  const threshold = input.thresholdPx ?? CHAT_BOTTOM_STICKY_THRESHOLD_PX
  return input.scrollHeight - input.scrollTop - input.clientHeight <= threshold
}

export function shouldStickToChatBottomAfterScroll(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  thresholdPx?: number
}) {
  return isNearChatBottom(input)
}

export function scrollChatToBottom(container: Pick<HTMLElement, "scrollHeight" | "scrollTop">) {
  container.scrollTop = container.scrollHeight
}
