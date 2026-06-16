export type SendInFlightRef = { current: boolean }

export function beginSendIfIdle(ref: SendInFlightRef) {
  if (ref.current) return false
  ref.current = true
  return true
}

export function endSend(ref: SendInFlightRef) {
  ref.current = false
}
