import { describe, test, expect } from "vitest"
import {
  createPageCache,
  getCachedPage,
  putCachedPage,
  clearSessionPageCache,
  pageCacheSize,
  DEFAULT_TTL_MS,
  MAX_ENTRIES_PER_SESSION,
} from "../pageCache"

type Row = { id: string }

describe("pageCache", () => {
  test("hit returns the entry inside TTL", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "a" }], fetchedAtMs: 1000, hasMore: true })
    const hit = getCachedPage(c, "s1", "older", 100, { nowMs: 1500, ttlMs: DEFAULT_TTL_MS })
    expect(hit?.messages).toEqual([{ id: "a" }])
  })

  test("miss returns null outside TTL", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "a" }], fetchedAtMs: 0, hasMore: true })
    const hit = getCachedPage(c, "s1", "older", 100, { nowMs: DEFAULT_TTL_MS + 1, ttlMs: DEFAULT_TTL_MS })
    expect(hit).toBeNull()
  })

  test("direction is part of the key", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "older" }], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s1", "newer", 100, { messages: [{ id: "newer" }], fetchedAtMs: 0, hasMore: true })
    expect(getCachedPage(c, "s1", "older", 100, { nowMs: 100 })?.messages[0]?.id).toBe("older")
    expect(getCachedPage(c, "s1", "newer", 100, { nowMs: 100 })?.messages[0]?.id).toBe("newer")
  })

  test("session isolation: s1 entry not visible from s2", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "x" }], fetchedAtMs: 0, hasMore: true })
    expect(getCachedPage(c, "s2", "older", 100, { nowMs: 100 })).toBeNull()
  })

  test("FIFO cap evicts oldest insertion when over MAX_ENTRIES_PER_SESSION", () => {
    const c = createPageCache<Row>()
    for (let i = 0; i < MAX_ENTRIES_PER_SESSION + 3; i++) {
      putCachedPage(c, "s1", "older", i * 60, { messages: [{ id: `p${i}` }], fetchedAtMs: 0, hasMore: true })
    }
    expect(pageCacheSize(c, "s1")).toBe(MAX_ENTRIES_PER_SESSION)
    // first 3 should be evicted
    expect(getCachedPage(c, "s1", "older", 0, { nowMs: 100 })).toBeNull()
    expect(getCachedPage(c, "s1", "older", 60, { nowMs: 100 })).toBeNull()
    expect(getCachedPage(c, "s1", "older", 120, { nowMs: 100 })).toBeNull()
    // 4th onward kept
    expect(getCachedPage(c, "s1", "older", 180, { nowMs: 100 })).not.toBeNull()
  })

  test("updating an existing key keeps it and refreshes order", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "v1" }], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s1", "older", 200, { messages: [{ id: "v2" }], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "v1-updated" }], fetchedAtMs: 0, hasMore: false })
    const hit = getCachedPage(c, "s1", "older", 100, { nowMs: 100 })
    expect(hit?.messages[0]?.id).toBe("v1-updated")
    expect(hit?.hasMore).toBe(false)
    expect(pageCacheSize(c, "s1")).toBe(2)
  })

  test("clearSessionPageCache wipes only that session", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "a" }], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s2", "older", 100, { messages: [{ id: "b" }], fetchedAtMs: 0, hasMore: true })
    clearSessionPageCache(c, "s1")
    expect(pageCacheSize(c, "s1")).toBe(0)
    expect(pageCacheSize(c, "s2")).toBe(1)
  })

  test("pageCacheSize aggregates across sessions when no key given", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s2", "older", 100, { messages: [], fetchedAtMs: 0, hasMore: true })
    expect(pageCacheSize(c)).toBe(2)
  })

  test("anchor seq differentiates entries within direction", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "a" }], fetchedAtMs: 0, hasMore: true })
    putCachedPage(c, "s1", "older", 200, { messages: [{ id: "b" }], fetchedAtMs: 0, hasMore: true })
    expect(getCachedPage(c, "s1", "older", 100, { nowMs: 100 })?.messages[0]?.id).toBe("a")
    expect(getCachedPage(c, "s1", "older", 200, { nowMs: 100 })?.messages[0]?.id).toBe("b")
  })

  test("stale entry overwritten by put is fresh again", () => {
    const c = createPageCache<Row>()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "old" }], fetchedAtMs: 0, hasMore: true })
    expect(getCachedPage(c, "s1", "older", 100, { nowMs: DEFAULT_TTL_MS + 100 })).toBeNull()
    putCachedPage(c, "s1", "older", 100, { messages: [{ id: "fresh" }], fetchedAtMs: DEFAULT_TTL_MS + 100, hasMore: true })
    expect(getCachedPage(c, "s1", "older", 100, { nowMs: DEFAULT_TTL_MS + 200 })?.messages[0]?.id).toBe("fresh")
  })
})
