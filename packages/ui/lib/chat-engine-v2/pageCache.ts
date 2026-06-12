/**
 * Phase 5 — Bounded page cache.
 *
 * Tiny TTL-bounded FIFO cache for paginated chat history responses,
 * keyed by `(sessionKey, direction, anchorSeq)`. Eliminates duplicate
 * fetches when the user rapidly reverses scroll direction (e.g.
 * scroll up → unload → scroll down → re-fetch the same page).
 *
 * Design constraints (per user "Simplicity > Performance"):
 *   - No LRU, no usage tracking, no eviction policy beyond FIFO + TTL.
 *   - Bounded entry count per session (`MAX_ENTRIES_PER_SESSION`).
 *   - Stale entries (older than `DEFAULT_TTL_MS`) treated as cache-miss.
 *   - Session reset clears all entries for that session.
 *
 * NOT a replacement for the message store. This cache stores raw page
 * responses (newest-first arrays as returned by the server). Consumers
 * are responsible for merging into the store.
 */

export const DEFAULT_TTL_MS = 30_000
export const MAX_ENTRIES_PER_SESSION = 8

export type PageDirection = "older" | "newer"

export type CachedPageEntry<T> = {
  messages: T[]
  fetchedAtMs: number
  /** Server-reported flag indicating whether more pages exist past this one. */
  hasMore: boolean
}

type CacheKey = string

function makeKey(direction: PageDirection, anchorSeq: number): CacheKey {
  return `${direction}:${anchorSeq}`
}

export type PageCacheState<T> = {
  // session -> key -> entry
  bySession: Map<string, Map<CacheKey, CachedPageEntry<T>>>
  // session -> ordered insertion keys (for FIFO eviction)
  orderBySession: Map<string, CacheKey[]>
}

export function createPageCache<T>(): PageCacheState<T> {
  return {
    bySession: new Map(),
    orderBySession: new Map(),
  }
}

export function getCachedPage<T>(
  cache: PageCacheState<T>,
  sessionKey: string,
  direction: PageDirection,
  anchorSeq: number,
  options: { nowMs?: number; ttlMs?: number } = {},
): CachedPageEntry<T> | null {
  const sessionCache = cache.bySession.get(sessionKey)
  if (!sessionCache) return null
  const entry = sessionCache.get(makeKey(direction, anchorSeq))
  if (!entry) return null
  const now = options.nowMs ?? Date.now()
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  if (now - entry.fetchedAtMs > ttl) {
    // Stale entry; treat as miss but leave in map (next put will overwrite).
    return null
  }
  return entry
}

export function putCachedPage<T>(
  cache: PageCacheState<T>,
  sessionKey: string,
  direction: PageDirection,
  anchorSeq: number,
  entry: CachedPageEntry<T>,
  options: { maxEntries?: number } = {},
): void {
  const cap = options.maxEntries ?? MAX_ENTRIES_PER_SESSION
  let sessionCache = cache.bySession.get(sessionKey)
  let order = cache.orderBySession.get(sessionKey)
  if (!sessionCache) {
    sessionCache = new Map()
    cache.bySession.set(sessionKey, sessionCache)
  }
  if (!order) {
    order = []
    cache.orderBySession.set(sessionKey, order)
  }
  const key = makeKey(direction, anchorSeq)
  const isNew = !sessionCache.has(key)
  sessionCache.set(key, entry)
  if (isNew) {
    order.push(key)
    while (order.length > cap) {
      const dropKey = order.shift()
      if (dropKey) sessionCache.delete(dropKey)
    }
  } else {
    // Refresh order so updated entries don't age out unfairly.
    const idx = order.indexOf(key)
    if (idx >= 0) {
      order.splice(idx, 1)
      order.push(key)
    }
  }
}

export function clearSessionPageCache<T>(cache: PageCacheState<T>, sessionKey: string): void {
  cache.bySession.delete(sessionKey)
  cache.orderBySession.delete(sessionKey)
}

export function pageCacheSize<T>(cache: PageCacheState<T>, sessionKey?: string): number {
  if (sessionKey) return cache.bySession.get(sessionKey)?.size ?? 0
  let total = 0
  for (const m of cache.bySession.values()) total += m.size
  return total
}
