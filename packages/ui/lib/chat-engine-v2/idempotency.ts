export function chatSendIdempotencyKey(sessionKey: string, optimisticId: string): string {
  return `desktop-v2:${sessionKey}:${optimisticId}`
}
