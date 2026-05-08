type CacheEntry<T> = {
  promise?: Promise<T>
  value?: T
  expiresAt?: number
  settled: boolean
}

type DedupeOptions = {
  ttlMs?: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function now() { return Date.now() }

export function dedupeRequest<T>(key: string, fn: () => Promise<T>, opts: DedupeOptions = {}): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  const current = now()
  if (entry?.promise) return entry.promise
  if (entry?.settled && entry.expiresAt && entry.expiresAt > current) return Promise.resolve(entry.value as T)
  if (entry?.settled && entry.expiresAt && entry.expiresAt <= current) cache.delete(key)

  const promise = fn()
    .then((value) => {
      if (opts.ttlMs && opts.ttlMs > 0) {
        cache.set(key, { value, expiresAt: now() + opts.ttlMs, settled: true })
      } else {
        cache.delete(key)
      }
      return value
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })

  cache.set(key, { promise, settled: false })
  return promise
}

export function invalidateDedupe(keyOrPrefix: string) {
  for (const key of [...cache.keys()]) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) cache.delete(key)
  }
}

export function clearDedupeForTests() {
  cache.clear()
}
