const PREFIX = "openclaw:active-run-reconcile"

function keyFor(sessionKey: string) {
  return `${PREFIX}:${sessionKey}`
}

const memoryLocks = new Map<string, number>()

function storage() {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis
    ? globalThis.localStorage
    : null
}

export function tryAcquireActiveRunReconcileLock(
  sessionKey: string,
  now = Date.now(),
  ttlMs = 12_000,
) {
  const key = keyFor(sessionKey)
  const store = storage()
  if (!store) {
    const until = memoryLocks.get(key) ?? 0
    if (until > now) return false
    memoryLocks.set(key, now + ttlMs)
    return true
  }
  try {
    const raw = store.getItem(key)
    const current = raw ? JSON.parse(raw) as { until?: number; owner?: string } : null
    if (current?.until && current.until > now) return false
    store.setItem(key, JSON.stringify({ until: now + ttlMs }))
    return true
  } catch {
    const until = memoryLocks.get(key) ?? 0
    if (until > now) return false
    memoryLocks.set(key, now + ttlMs)
    return true
  }
}

export function clearActiveRunReconcileLockForTests(sessionKey: string) {
  const key = keyFor(sessionKey)
  memoryLocks.delete(key)
  try { storage()?.removeItem(key) } catch {}
}
