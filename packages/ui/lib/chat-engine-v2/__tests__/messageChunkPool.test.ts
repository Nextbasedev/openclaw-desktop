import { describe, expect, test } from "vitest"
import {
  ACTIVE_CHUNK_NEIGHBOURS,
  applyLivePatch,
  CHUNK_SIZE,
  chunkIdForSeq,
  chunkSeqRange,
  createEmptyChunkPool,
  evictBeyondCap,
  hasChunk,
  MAX_CHUNKS_IN_MEMORY,
  poolMessageCount,
  resetPool,
  setActiveChunk,
  setChunkPinned,
  unionAll,
  unionAroundActive,
  upsertChunk,
} from "../messageChunkPool"

const msg = (seq: number, extra: Partial<{ messageId: string; uiId: string }> = {}) => ({
  seq,
  uiId: extra.uiId ?? `ui-${seq}`,
  messageId: extra.messageId ?? `msg-${seq}`,
})

const buildChunkMessages = (chunkId: number, count = CHUNK_SIZE) => {
  const { minSeq } = chunkSeqRange(chunkId)
  return Array.from({ length: count }, (_, i) => msg(minSeq + i))
}

describe("chunkIdForSeq / chunkSeqRange", () => {
  test("maps seq into the right chunk", () => {
    expect(chunkIdForSeq(0)).toBe(0)
    expect(chunkIdForSeq(CHUNK_SIZE - 1)).toBe(0)
    expect(chunkIdForSeq(CHUNK_SIZE)).toBe(1)
    expect(chunkIdForSeq(3 * CHUNK_SIZE + 17)).toBe(3)
  })
  test("range matches", () => {
    const { minSeq, maxSeq } = chunkSeqRange(2)
    expect(minSeq).toBe(2 * CHUNK_SIZE)
    expect(maxSeq).toBe(3 * CHUNK_SIZE - 1)
  })
})

describe("upsertChunk", () => {
  test("inserts a chunk and tracks newest/oldest known ids", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 3, buildChunkMessages(3), { nowMs: 100 })
    pool = upsertChunk(pool, 5, buildChunkMessages(5), { nowMs: 200 })
    expect(pool.chunks.size).toBe(2)
    expect(pool.newestKnownChunkId).toBe(5)
    expect(pool.oldestKnownChunkId).toBe(3)
  })

  test("replaces existing chunk and updates lastAccessedMs", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 1, buildChunkMessages(1), { nowMs: 100 })
    pool = upsertChunk(pool, 1, buildChunkMessages(1).slice(0, 3), { nowMs: 999 })
    expect(pool.chunks.get(1)!.messages).toHaveLength(3)
    expect(pool.chunks.get(1)!.lastAccessedMs).toBe(999)
  })

  test("stores messages sorted by seq even if input is unordered", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 0, [msg(5), msg(1), msg(3)])
    expect(pool.chunks.get(0)!.messages.map((m) => m.seq)).toEqual([1, 3, 5])
  })
})

describe("setActiveChunk", () => {
  test("touches lastAccessedMs of the active chunk", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 2, buildChunkMessages(2), { nowMs: 100 })
    pool = setActiveChunk(pool, 2, 500)
    expect(pool.activeChunkId).toBe(2)
    expect(pool.chunks.get(2)!.lastAccessedMs).toBe(500)
  })
  test("no-op when same active id", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 1, buildChunkMessages(1))
    pool = setActiveChunk(pool, 1, 100)
    const same = setActiveChunk(pool, 1, 999)
    expect(same).toBe(pool)
  })
})

describe("setChunkPinned", () => {
  test("pins/unpins existing chunk", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 1, buildChunkMessages(1))
    pool = setChunkPinned(pool, 1, true)
    expect(pool.chunks.get(1)!.pinned).toBe(true)
    pool = setChunkPinned(pool, 1, false)
    expect(pool.chunks.get(1)!.pinned).toBe(false)
  })
  test("no-op for missing chunk", () => {
    const pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    expect(setChunkPinned(pool, 1, true)).toBe(pool)
  })
})

describe("evictBeyondCap", () => {
  test("keeps active chunk + neighbours, evicts farthest from active first", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    // 7 chunks ids 0..6, MAX is 5 so we need to evict 2.
    for (let id = 0; id < 7; id += 1) {
      pool = upsertChunk(pool, id, buildChunkMessages(id, 5), { nowMs: 100 + id })
    }
    pool = setActiveChunk(pool, 3, 1000)
    const { state, evicted } = evictBeyondCap(pool)
    expect(state.chunks.size).toBe(MAX_CHUNKS_IN_MEMORY)
    // Active 3 + neighbours {2,4} protected. Among {0,1,5,6} unprotected,
    // farthest from active=3 are {0,6} (distance 3); both get evicted.
    expect(evicted.sort()).toEqual([0, 6])
    expect(state.chunks.has(3)).toBe(true)
    expect(state.chunks.has(2)).toBe(true)
    expect(state.chunks.has(4)).toBe(true)
    expect(state.chunks.has(1)).toBe(true)
    expect(state.chunks.has(5)).toBe(true)
  })

  test("pinned chunks are never evicted even if oldest", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    for (let id = 0; id < 7; id += 1) {
      pool = upsertChunk(pool, id, buildChunkMessages(id, 3), { nowMs: 100 + id })
    }
    pool = setChunkPinned(pool, 0, true)
    pool = setActiveChunk(pool, 6, 1000)
    const { state, evicted } = evictBeyondCap(pool, { activeNeighbours: 0 })
    // Protected: {6, pinned 0}. Pool has 7, cap 5 → 2 evictions among {1,2,3,4,5}.
    // Farthest from active=6 among those: {1, 2} (distances 5, 4). Both evicted.
    expect(state.chunks.has(0)).toBe(true)
    expect(state.chunks.has(6)).toBe(true)
    expect(evicted.sort()).toEqual([1, 2])
  })

  test("no-op when under cap", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    for (let id = 0; id < MAX_CHUNKS_IN_MEMORY; id += 1) {
      pool = upsertChunk(pool, id, buildChunkMessages(id, 2))
    }
    const result = evictBeyondCap(pool)
    expect(result.evicted).toEqual([])
    expect(result.state).toBe(pool)
  })

  test("respects custom neighbours radius", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    for (let id = 0; id < 7; id += 1) {
      pool = upsertChunk(pool, id, buildChunkMessages(id, 2), { nowMs: 100 + id })
    }
    pool = setActiveChunk(pool, 3, 1000)
    // radius 2 → protect 1..5; cap 5; size 7; overflow 2 → both unprotected
    // chunks {0,6} must be evicted, ordered oldest-first by lastAccessedMs.
    const result = evictBeyondCap(pool, { activeNeighbours: 2 })
    expect(result.state.chunks.size).toBe(5)
    expect(result.evicted.sort((a, b) => a - b)).toEqual([0, 6])
  })
})

describe("unionAroundActive / unionAll", () => {
  test("union around active includes neighbours in seq order", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 5, [msg(300), msg(301)])
    pool = upsertChunk(pool, 6, [msg(360)])
    pool = upsertChunk(pool, 7, [msg(420)])
    pool = upsertChunk(pool, 9, [msg(540)]) // out of neighbours range
    pool = setActiveChunk(pool, 6, 100)
    const seqs = unionAroundActive(pool, ACTIVE_CHUNK_NEIGHBOURS).map((m) => m.seq)
    expect(seqs).toEqual([300, 301, 360, 420])
  })

  test("union all returns everything in seq order even with sparse chunks", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 5, [msg(300)])
    pool = upsertChunk(pool, 2, [msg(120)])
    pool = upsertChunk(pool, 9, [msg(540)])
    expect(unionAll(pool).map((m) => m.seq)).toEqual([120, 300, 540])
  })

  test("falls back to unionAll when no active chunk", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 0, [msg(1)])
    pool = upsertChunk(pool, 1, [msg(60)])
    expect(unionAroundActive(pool).map((m) => m.seq)).toEqual([1, 60])
  })
})

describe("applyLivePatch", () => {
  test("inserts new message into existing chunk in seq order", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 1, [msg(60), msg(62)])
    const result = applyLivePatch(pool, msg(61))
    expect(result.accepted).toBe(true)
    expect(result.state.chunks.get(1)!.messages.map((m) => m.seq)).toEqual([60, 61, 62])
  })

  test("replaces existing message by messageId via custom upsert", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 0, [msg(0, { messageId: "m0" })])
    const incoming = { ...msg(0, { messageId: "m0" }), extra: "patched" } as any
    const result = applyLivePatch(pool, incoming, {
      upsertById: (existing, incomingMsg) => ({ ...existing, ...incomingMsg }),
    })
    expect(result.accepted).toBe(true)
    expect(result.state.chunks.get(0)!.messages[0]).toMatchObject({ extra: "patched" })
  })

  test("drops patch when target chunk not in pool", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 0, [msg(0)])
    const result = applyLivePatch(pool, msg(600)) // chunk 10, not present
    expect(result.accepted).toBe(false)
    expect(result.state).toBe(pool)
  })

  test("bumps newestKnownChunkId on accepted patch", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    pool = upsertChunk(pool, 0, [msg(0)])
    pool = upsertChunk(pool, 5, [msg(300)])
    const result = applyLivePatch(pool, msg(305))
    expect(result.state.newestKnownChunkId).toBe(5)
  })
})

describe("resetPool", () => {
  test("returns an empty pool", () => {
    expect(resetPool()).toEqual(createEmptyChunkPool())
  })
})

describe("hasChunk / poolMessageCount", () => {
  test("hasChunk + count", () => {
    let pool = createEmptyChunkPool<ReturnType<typeof msg>>()
    expect(hasChunk(pool, 1)).toBe(false)
    pool = upsertChunk(pool, 1, [msg(60), msg(61)])
    pool = upsertChunk(pool, 2, [msg(120)])
    expect(hasChunk(pool, 1)).toBe(true)
    expect(poolMessageCount(pool)).toBe(3)
  })
})
