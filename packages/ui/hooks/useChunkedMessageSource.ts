/**
 * useChunkedMessageSource — Telegram-style chunked virtualization adapter.
 *
 * Sits between `useChatMessages` (which still owns WS streaming, optimistic
 * sends, run state, and server-driven `loadOlderMessages`) and `ChatView`
 * (which only sees a bounded slice of the conversation). Its job is to:
 *
 *   1. Group the canonical `messages[]` returned by `useChatMessages` into
 *      fixed-size chunks identified by `chunkIdForSeq(gatewayIndex)`.
 *   2. Maintain an LRU pool of at most `MAX_CHUNKS_IN_MEMORY` chunks
 *      around the current viewport (active chunk + neighbours).
 *   3. Evict chunks (and the underlying store rows) that drift outside
 *      the active window. The store keeps the optimistic / live-tail
 *      rows; everything else is dropped and re-fetched on demand.
 *   4. When the user scrolls into a range we evicted, request the chunk
 *      back from the middleware via the existing `loadOlderMessages`
 *      flow (older side) or a new `loadNewerChunk` server fetch.
 *
 * What this hook does **not** do (intentional, per Path A constraints):
 *   - Touch the WS patch reducer or applyPatches.
 *   - Reorder or rewrite the bootstrap path.
 *   - Replace `useChatMessages`. It still owns send / abort / edit /
 *     regenerate / branch-switch and all run lifecycle plumbing.
 *
 * The trade-off: WS arrivals for evicted chunks land in the store
 * transiently, but the next eviction cycle drops them again. Steady-state
 * memory is bounded by `MAX_CHUNKS_IN_MEMORY * CHUNK_SIZE` plus optimistic
 * sends and the current generation tail.
 */
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchChatMessagesV2 } from "@/lib/chat-engine-v2/client"
import {
  CHUNK_SIZE,
  chunkIdForSeq,
  chunkSeqRange,
  createEmptyChunkPool,
  evictBeyondCap,
  MAX_CHUNKS_IN_MEMORY,
  poolMessageCount,
  setActiveChunk,
  setChunkPinned,
  upsertChunk,
  type ChunkId,
  type ChunkPoolState,
  type SequencedMessage,
} from "@/lib/chat-engine-v2/messageChunkPool"
import { evictMessagesOutsideSeqRange } from "@/lib/chat-engine-v2/store"
import { frontendLog } from "@/lib/clientLogs"

/**
 * Minimal shape we need from a chat message for chunk math. Real chat
 * messages carry far more (`ChatMessage`), but this hook only depends on a
 * stable seq and id pair.
 */
export type ChunkSourceMessage = {
  uiId?: string
  messageId?: string
  gatewayIndex?: number
  isOptimistic?: boolean
  // Live row marker: any row produced by the streaming WS path is in the
  // newest chunk and we never evict it while it's actively updating.
}

/**
 * Internal pool element. The pool requires every element to expose a stable
 * `seq` field; we derive it from `gatewayIndex` and keep the original
 * message under `__src` so the projection layer (ChatView) gets the
 * original shape back unchanged.
 */
type PoolEntry<T extends ChunkSourceMessage> = SequencedMessage & {
  __src: T
}

function wrapForPool<T extends ChunkSourceMessage>(message: T, fallbackSeq: number): PoolEntry<T> {
  const seq =
    typeof message.gatewayIndex === "number" && Number.isFinite(message.gatewayIndex)
      ? (message.gatewayIndex as number)
      : fallbackSeq
  return {
    seq,
    uiId: message.uiId,
    messageId: message.messageId,
    __src: message,
  }
}

function unwrapFromPool<T extends ChunkSourceMessage>(entry: PoolEntry<T>): T {
  return entry.__src
}

export type UseChunkedMessageSourceParams<T extends ChunkSourceMessage> = {
  /** Full canonical messages array from `useChatMessages`. */
  messages: readonly T[]
  /** Active session id (used for pool reset on switch). */
  sessionKey: string
  /** True during a live assistant turn — protects the tail chunk from eviction. */
  isGenerating: boolean
  /**
   * Server-side older pagination hook (`useChatMessages.loadOlderMessages`).
   * Invoked when the active window reaches the bottom of in-memory history.
   */
  loadOlderMessages: () => Promise<void> | void
  /** True when more older messages exist on the server. */
  hasOlderMessages: boolean
}

export type UseChunkedMessageSourceResult<T extends ChunkSourceMessage> = {
  /** The bounded slice of messages projected for the UI. */
  chunkedMessages: T[]
  /** Active chunk id, or null if the pool is empty. */
  activeChunkId: ChunkId | null
  /** Sum of messages currently in the pool (telemetry). */
  poolSize: number
  /** Number of chunks held in the pool (telemetry). */
  chunkCount: number
  /** True when the active chunk is the newest known chunk. */
  isAtNewest: boolean
  /**
   * Called by the scroll layer when the user crosses the boundary between
   * chunks. Updates the pool's active chunk and triggers an eviction pass.
   */
  setActiveChunkBySeq: (seq: number | null) => void
  /**
   * Top sentinel handler. If the older chunk neighbour is missing from the
   * pool, fetch it from the server.
   */
  requestOlderChunk: () => Promise<void>
  /**
   * Bottom sentinel handler. If the newer chunk neighbour is missing from
   * the pool, fetch it from the server.
   */
  requestNewerChunk: () => Promise<void>
  /**
   * Force-mount the chunk that contains the given seq (used by
   * scroll-to-message / search).
   */
  ensureChunkForSeq: (seq: number) => Promise<void>
}

/**
 * Index helper: build a map from chunkId → messages slice from a flat
 * messages array. Messages without a `gatewayIndex` are treated as
 * belonging to the newest chunk (optimistic sends, locally-injected rows).
 */
function indexMessagesByChunk<T extends ChunkSourceMessage>(
  messages: readonly T[],
  newestKnownChunkId: ChunkId | null,
): Map<ChunkId, PoolEntry<T>[]> {
  const groups = new Map<ChunkId, PoolEntry<T>[]>()
  // Synthetic seq for optimistic / un-acked rows so they sort to the tail
  // of the newest chunk. Each gets a slightly higher seq than the last so
  // ordering is stable.
  let optimisticSeqCounter = 0
  const fallbackChunkId = newestKnownChunkId ?? 0
  const fallbackBaseSeq = chunkSeqRange(fallbackChunkId).maxSeq + 1
  for (const m of messages) {
    const hasSeq = typeof m.gatewayIndex === "number" && Number.isFinite(m.gatewayIndex)
    const id = hasSeq
      ? chunkIdForSeq(m.gatewayIndex as number)
      : fallbackChunkId
    const seqForPool = hasSeq
      ? (m.gatewayIndex as number)
      : fallbackBaseSeq + (optimisticSeqCounter += 1)
    const entry = wrapForPool(m, seqForPool)
    const list = groups.get(id)
    if (list) list.push(entry)
    else groups.set(id, [entry])
  }
  return groups
}

export function useChunkedMessageSource<T extends ChunkSourceMessage>(
  params: UseChunkedMessageSourceParams<T>,
): UseChunkedMessageSourceResult<T> {
  const { messages, sessionKey, isGenerating, loadOlderMessages, hasOlderMessages } = params

  const [pool, setPool] = useState<ChunkPoolState<PoolEntry<T>>>(() => createEmptyChunkPool<PoolEntry<T>>())
  const sessionKeyRef = useRef(sessionKey)
  // Per-direction in-flight guard so two near-simultaneous sentinel pings
  // collapse into one fetch.
  const inFlightRef = useRef<{ older: boolean; newer: boolean; ensure: Set<ChunkId> }>({
    older: false,
    newer: false,
    ensure: new Set(),
  })

  // -------------------------------------------------------------------------
  // Session switch: hard reset the pool. We never carry chunks across sessions.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) return
    sessionKeyRef.current = sessionKey
    inFlightRef.current = { older: false, newer: false, ensure: new Set() }
    setPool(createEmptyChunkPool<PoolEntry<T>>())
  }, [sessionKey])

  // -------------------------------------------------------------------------
  // Re-index the pool whenever the underlying messages change. We do NOT
  // create new chunks for chunk-ids that are not already in the pool (or
  // adjacent to active) — this is what gives us bounded memory. Server
  // fetches explicitly upsert new chunks via requestOlderChunk /
  // requestNewerChunk / ensureChunkForSeq.
  //
  // The exception: when the pool is empty (cold start, post-session-switch),
  // we seed it with whatever messages currently exist, grouped by chunk id.
  // This handles bootstrap: `useChatMessages` initially carries the newest
  // ~N messages from the patch stream / cache, and we want those visible.
  // -------------------------------------------------------------------------
  useEffect(() => {
    setPool((current) => {
      const groups = indexMessagesByChunk(messages, current.newestKnownChunkId)

      // Cold start: seed the pool from messages we have, but cap to
      // MAX_CHUNKS_IN_MEMORY chunks (newest-first).
      if (current.chunks.size === 0) {
        const chunkIds = [...groups.keys()].sort((a, b) => b - a)
        if (chunkIds.length === 0) return current
        let next = current
        const seeded = chunkIds.slice(0, MAX_CHUNKS_IN_MEMORY)
        for (const id of seeded) {
          next = upsertChunk(next, id, groups.get(id) ?? [])
        }
        const newest = Math.max(...chunkIds)
        next = setActiveChunk(next, newest)
        return next
      }

      // Hot path: update only chunks already present in the pool. Chunks we
      // evicted will not be revived implicitly by store changes; the user
      // has to scroll back to trigger an explicit fetch.
      let next = current
      let changed = false
      for (const [chunkId, slab] of groups.entries()) {
        if (!next.chunks.has(chunkId)) continue
        const previous = next.chunks.get(chunkId)!
        // Cheap identity check: same length and same id list ⇒ skip update.
        if (
          previous.messages.length === slab.length &&
          previous.messages.every((m, i) => m === slab[i])
        ) {
          continue
        }
        next = upsertChunk(next, chunkId, slab)
        changed = true
      }
      // Track the newest chunk id we've ever seen so the pool knows where
      // the tail is even if it's been evicted.
      const newestInMessages = groups.size > 0 ? Math.max(...groups.keys()) : null
      if (
        newestInMessages !== null &&
        (next.newestKnownChunkId === null || newestInMessages > next.newestKnownChunkId)
      ) {
        next = { ...next, newestKnownChunkId: newestInMessages }
        changed = true
      }
      return changed ? next : current
    })
  }, [messages])

  // -------------------------------------------------------------------------
  // Tail pinning: while a generation is active and the user is reading the
  // newest chunk, pin that chunk so it cannot be evicted.
  // -------------------------------------------------------------------------
  useEffect(() => {
    setPool((current) => {
      if (current.activeChunkId === null || current.newestKnownChunkId === null) return current
      const atTail = current.activeChunkId === current.newestKnownChunkId
      const shouldPin = isGenerating && atTail
      const tail = current.chunks.get(current.newestKnownChunkId)
      if (!tail) return current
      if (tail.pinned === shouldPin) return current
      return setChunkPinned(current, current.newestKnownChunkId, shouldPin)
    })
  }, [isGenerating, pool.activeChunkId, pool.newestKnownChunkId])

  // -------------------------------------------------------------------------
  // Eviction pass: runs whenever the pool exceeds the cap. Also fires the
  // store eviction so the underlying ChatMessage Map shrinks.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (pool.chunks.size <= MAX_CHUNKS_IN_MEMORY) return
    const { state: next, evicted } = evictBeyondCap(pool)
    if (evicted.length === 0) return
    setPool(next)
    // Compute the new visible seq range (active ± neighbours that are still
    // present in the pool) and tell the store to drop everything else.
    const remainingIds = [...next.chunks.keys()].sort((a, b) => a - b)
    if (remainingIds.length === 0) return
    const minSeq = chunkSeqRange(remainingIds[0]).minSeq
    const maxSeq = chunkSeqRange(remainingIds[remainingIds.length - 1]).maxSeq
    const storeEvicted = evictMessagesOutsideSeqRange(sessionKey, minSeq, maxSeq)
    frontendLog(
      "chat",
      "chunk-pool.evict",
      {
        sessionKey,
        poolEvicted: evicted,
        remainingChunks: remainingIds,
        seqRange: [minSeq, maxSeq],
        storeEvicted,
      },
      "debug",
    )
  }, [pool, sessionKey])

  // -------------------------------------------------------------------------
  // Active-chunk control (driven by ChatView scroll layer).
  // -------------------------------------------------------------------------
  const setActiveChunkBySeq = useCallback((seq: number | null) => {
    setPool((current) => {
      if (seq === null) return current
      if (!Number.isFinite(seq)) return current
      const id = chunkIdForSeq(seq)
      return setActiveChunk(current, id)
    })
  }, [])

  // -------------------------------------------------------------------------
  // Server fetch helpers. We re-fetch a single chunk on demand using the
  // existing middleware route. The new messages are merged into the store
  // via `seedGlobalChatSession`-driven flow inside `useChatMessages`, but
  // here we also need to insert them into our pool synchronously so the
  // sentinel doesn't re-fire on the next frame.
  // -------------------------------------------------------------------------
  const fetchChunkBySeqRange = useCallback(
    async (chunkId: ChunkId): Promise<void> => {
      if (pool.chunks.has(chunkId)) return
      const { minSeq, maxSeq } = chunkSeqRange(chunkId)
      try {
        const page = await fetchChatMessagesV2({
          sessionKey,
          afterSeq: Math.max(0, minSeq - 1),
          // Fetch a little past the chunk end so we get the full slab.
          // beforeSeq is exclusive on the server side.
          beforeSeq: maxSeq + 2,
          limit: CHUNK_SIZE * 2,
        })
        const rows: PoolEntry<T>[] = []
        for (const m of page.messages) {
          if (typeof m.openclawSeq !== "number") continue
          const merged = {
            ...(m.data as object),
            messageId: m.messageId ?? undefined,
            gatewayIndex: m.openclawSeq,
          } as unknown as T
          rows.push(wrapForPool(merged, m.openclawSeq))
        }
        if (rows.length === 0) return
        setPool((current) => upsertChunk(current, chunkId, rows, { isComplete: true }))
        frontendLog("chat", "chunk-pool.fetch", {
          sessionKey,
          chunkId,
          rangeSeq: [minSeq, maxSeq],
          fetched: rows.length,
        }, "debug")
      } catch (error) {
        frontendLog("chat", "chunk-pool.fetch.fail", {
          sessionKey,
          chunkId,
          error: error instanceof Error ? error.message : String(error),
        }, "warn")
      }
    },
    [pool.chunks, sessionKey],
  )

  const requestOlderChunk = useCallback(async () => {
    if (inFlightRef.current.older) return
    const activeId = pool.activeChunkId
    if (activeId === null) return
    const targetId = activeId - 1
    if (targetId < 0) return
    if (pool.chunks.has(targetId)) return
    // If the in-memory chunk above doesn't exist AND we know we're at the
    // oldest loaded boundary, fall through to the existing server-pagination
    // helper that handles the cold-load case. Otherwise pull a single chunk.
    inFlightRef.current.older = true
    try {
      const oldestKnown = pool.oldestKnownChunkId
      if (oldestKnown !== null && targetId < oldestKnown && hasOlderMessages) {
        await loadOlderMessages()
      } else {
        await fetchChunkBySeqRange(targetId)
      }
    } finally {
      inFlightRef.current.older = false
    }
  }, [fetchChunkBySeqRange, hasOlderMessages, loadOlderMessages, pool.activeChunkId, pool.chunks, pool.oldestKnownChunkId])

  const requestNewerChunk = useCallback(async () => {
    if (inFlightRef.current.newer) return
    const activeId = pool.activeChunkId
    if (activeId === null) return
    const targetId = activeId + 1
    if (pool.newestKnownChunkId !== null && targetId > pool.newestKnownChunkId) return
    if (pool.chunks.has(targetId)) return
    inFlightRef.current.newer = true
    try {
      await fetchChunkBySeqRange(targetId)
    } finally {
      inFlightRef.current.newer = false
    }
  }, [fetchChunkBySeqRange, pool.activeChunkId, pool.chunks, pool.newestKnownChunkId])

  const ensureChunkForSeq = useCallback(
    async (seq: number) => {
      const chunkId = chunkIdForSeq(seq)
      if (pool.chunks.has(chunkId)) {
        setActiveChunkBySeq(seq)
        return
      }
      if (inFlightRef.current.ensure.has(chunkId)) return
      inFlightRef.current.ensure.add(chunkId)
      try {
        await fetchChunkBySeqRange(chunkId)
        setActiveChunkBySeq(seq)
      } finally {
        inFlightRef.current.ensure.delete(chunkId)
      }
    },
    [fetchChunkBySeqRange, pool.chunks, setActiveChunkBySeq],
  )

  // -------------------------------------------------------------------------
  // Project the pool into a flat, seq-sorted array for ChatView.
  // -------------------------------------------------------------------------
  const chunkedMessages = useMemo<T[]>(() => {
    if (pool.chunks.size === 0) return []
    const ids = [...pool.chunks.keys()].sort((a, b) => a - b)
    const out: T[] = []
    for (const id of ids) {
      const slab = pool.chunks.get(id)
      if (!slab) continue
      for (const entry of slab.messages) out.push(unwrapFromPool(entry))
    }
    return out
  }, [pool])

  const isAtNewest =
    pool.activeChunkId !== null &&
    pool.newestKnownChunkId !== null &&
    pool.activeChunkId >= pool.newestKnownChunkId

  return {
    chunkedMessages,
    activeChunkId: pool.activeChunkId,
    poolSize: poolMessageCount(pool),
    chunkCount: pool.chunks.size,
    isAtNewest,
    setActiveChunkBySeq,
    requestOlderChunk,
    requestNewerChunk,
    ensureChunkForSeq,
  }
}
