/**
 * Telegram-Web-A style chunk pool for chat messages.
 *
 * The chat-engine-v2 store no longer accumulates the whole history; instead
 * we keep a bounded LRU of fixed-size chunks identified by their
 * `openclawSeq` range. Each chunk is a contiguous slab of messages we
 * received from the middleware in one fetch.
 *
 * Layers in this design:
 *
 *   server (middleware sqlite)  ──╮
 *                                 │  on-demand fetch by chunkId
 *                                 ▼
 *   chunk pool (this module) ─── LRU of <= MAX_CHUNKS_IN_MEMORY chunks
 *                                 │  union by seq order
 *                                 ▼
 *   ChatView render slice (messageSlice.ts) ── viewport-windowed DOM
 *
 * Pure: no React, no I/O, no DOM. The hook layer
 * (`useChunkedMessageSource`) drives this state machine.
 *
 * Heavily borrowed from telegram-tt's `messageIds` chunk + viewport-limit
 * mechanics. See:
 *   https://github.com/Ajaxy/telegram-tt/blob/master/src/config.ts
 *   https://github.com/Ajaxy/telegram-tt/blob/master/src/global/actions/api/messages.ts
 */

/** Width of one chunk in `openclawSeq` units (Telegram MESSAGE_LIST_SLICE). */
export const CHUNK_SIZE = 60
/** Hard cap on chunks held in the pool. ~5 * 60 = 300 messages mounted. */
export const MAX_CHUNKS_IN_MEMORY = 5
/** Distance (in chunks) from the active chunk we always keep loaded. */
export const ACTIVE_CHUNK_NEIGHBOURS = 1

/**
 * Stable id for a chunk: floor(seq / CHUNK_SIZE). Two messages with seq 60
 * and 119 both live in chunk #1 (covering seqs 60..119).
 */
export type ChunkId = number

export function chunkIdForSeq(seq: number, chunkSize: number = CHUNK_SIZE): ChunkId {
  return Math.floor(seq / chunkSize)
}

export function chunkSeqRange(
  chunkId: ChunkId,
  chunkSize: number = CHUNK_SIZE,
): { minSeq: number; maxSeq: number } {
  return {
    minSeq: chunkId * chunkSize,
    maxSeq: chunkId * chunkSize + chunkSize - 1,
  }
}

export type SequencedMessage = {
  uiId?: string
  messageId?: string
  /** Stable monotonic ordering key (`openclawSeq` / `gatewayIndex`). */
  seq: number
}

/**
 * In-memory representation of one chunk slab. The `messages` array is
 * already ordered by `seq` ascending. `pinned` chunks cannot be evicted
 * (used to protect the live-tail chunk during streaming).
 */
export type Chunk<T extends SequencedMessage> = {
  id: ChunkId
  /** Messages with `chunkIdForSeq(msg.seq) === id`. */
  messages: T[]
  /** Last touch wall-clock ms; older = first to evict. */
  lastAccessedMs: number
  /** When true the chunk cannot be evicted (live-tail during streaming). */
  pinned: boolean
  /**
   * `true` once we have observed the maximum seq the server has in this
   * range. Used to short-circuit re-fetches.
   */
  isComplete: boolean
}

export type ChunkPoolState<T extends SequencedMessage> = {
  /** Map of chunk id → chunk slab. Insertion order is irrelevant; LRU is by `lastAccessedMs`. */
  chunks: Map<ChunkId, Chunk<T>>
  /** Active chunk: the one that contains the current viewport center. */
  activeChunkId: ChunkId | null
  /**
   * Highest chunk id known to exist on the server (newest tail). May lag
   * one chunk behind reality during a streaming turn, but the WS layer
   * keeps the newest chunk synced via `applyLivePatch`.
   */
  newestKnownChunkId: ChunkId | null
  /** Lowest chunk id known to exist on the server. */
  oldestKnownChunkId: ChunkId | null
}

export function createEmptyChunkPool<T extends SequencedMessage>(): ChunkPoolState<T> {
  return {
    chunks: new Map(),
    activeChunkId: null,
    newestKnownChunkId: null,
    oldestKnownChunkId: null,
  }
}

/**
 * Insert (or replace) a chunk in the pool. Touches `lastAccessedMs` so the
 * LRU bumps it to "freshly used."
 */
export function upsertChunk<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  chunkId: ChunkId,
  messages: readonly T[],
  options: { pinned?: boolean; nowMs?: number; isComplete?: boolean } = {},
): ChunkPoolState<T> {
  const sorted = [...messages].sort((a, b) => a.seq - b.seq)
  const chunk: Chunk<T> = {
    id: chunkId,
    messages: sorted,
    lastAccessedMs: options.nowMs ?? Date.now(),
    pinned: options.pinned ?? false,
    isComplete: options.isComplete ?? false,
  }
  const next: ChunkPoolState<T> = {
    ...state,
    chunks: new Map(state.chunks),
  }
  next.chunks.set(chunkId, chunk)
  if (state.newestKnownChunkId === null || chunkId > state.newestKnownChunkId) {
    next.newestKnownChunkId = chunkId
  }
  if (state.oldestKnownChunkId === null || chunkId < state.oldestKnownChunkId) {
    next.oldestKnownChunkId = chunkId
  }
  return next
}

/**
 * Mark a chunk as the active one (containing current viewport center) and
 * touch its lastAccessedMs.
 */
export function setActiveChunk<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  chunkId: ChunkId | null,
  nowMs: number = Date.now(),
): ChunkPoolState<T> {
  if (state.activeChunkId === chunkId) return state
  const next: ChunkPoolState<T> = { ...state, activeChunkId: chunkId, chunks: new Map(state.chunks) }
  if (chunkId !== null) {
    const existing = next.chunks.get(chunkId)
    if (existing) {
      next.chunks.set(chunkId, { ...existing, lastAccessedMs: nowMs })
    }
  }
  return next
}

/**
 * Pin / unpin a chunk so the LRU never evicts it. Used to protect the
 * live-tail chunk during an active assistant generation.
 */
export function setChunkPinned<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  chunkId: ChunkId,
  pinned: boolean,
): ChunkPoolState<T> {
  const existing = state.chunks.get(chunkId)
  if (!existing) return state
  if (existing.pinned === pinned) return state
  const next: ChunkPoolState<T> = { ...state, chunks: new Map(state.chunks) }
  next.chunks.set(chunkId, { ...existing, pinned })
  return next
}

/**
 * Drop chunks beyond the in-memory cap. The active chunk and its
 * `ACTIVE_CHUNK_NEIGHBOURS` immediate neighbours are protected; pinned
 * chunks are also protected.
 *
 * Eviction policy: prefer evicting chunks **farthest from the active**
 * chunk, breaking ties by older `lastAccessedMs`. This keeps the pool
 * contiguous around the user's viewport so the store-side eviction range
 * (`[poolMin, poolMax]`) doesn't end up with holes — critical for Path A
 * bounded-memory: a non-contiguous pool would leave stranded messages in
 * the underlying store.
 *
 * Returns the new state and the list of evicted chunk ids so the caller
 * can adjust scroll position by their cached heights.
 */
export function evictBeyondCap<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  options: {
    maxChunks?: number
    activeNeighbours?: number
  } = {},
): { state: ChunkPoolState<T>; evicted: ChunkId[] } {
  const maxChunks = options.maxChunks ?? MAX_CHUNKS_IN_MEMORY
  const neighbours = options.activeNeighbours ?? ACTIVE_CHUNK_NEIGHBOURS

  if (state.chunks.size <= maxChunks) return { state, evicted: [] }

  const protectedIds = new Set<ChunkId>()
  if (state.activeChunkId !== null) {
    for (let d = -neighbours; d <= neighbours; d += 1) {
      protectedIds.add(state.activeChunkId + d)
    }
  }
  // Always protect the newest known chunk (and its immediate older neighbour
  // if present) so the tail stays mounted. Users predictably scroll back to
  // the tail after browsing history; evicting it causes a blank/jump flash
  // when the scroll-down sentinel has to refetch what was just there.
  if (state.newestKnownChunkId !== null) {
    protectedIds.add(state.newestKnownChunkId)
    if (neighbours >= 1) protectedIds.add(state.newestKnownChunkId - 1)
  }
  for (const [id, chunk] of state.chunks.entries()) {
    if (chunk.pinned) protectedIds.add(id)
  }

  const candidates: Chunk<T>[] = []
  for (const chunk of state.chunks.values()) {
    if (!protectedIds.has(chunk.id)) candidates.push(chunk)
  }
  // Farthest from active first, then oldest by lastAccessedMs.
  const activeId = state.activeChunkId
  candidates.sort((a, b) => {
    if (activeId !== null) {
      const da = Math.abs(a.id - activeId)
      const db = Math.abs(b.id - activeId)
      if (da !== db) return db - da // farthest first
    }
    return a.lastAccessedMs - b.lastAccessedMs
  })

  const evicted: ChunkId[] = []
  const next: ChunkPoolState<T> = { ...state, chunks: new Map(state.chunks) }
  let remainingOverflow = state.chunks.size - maxChunks
  for (const candidate of candidates) {
    if (remainingOverflow <= 0) break
    next.chunks.delete(candidate.id)
    evicted.push(candidate.id)
    remainingOverflow -= 1
  }
  return { state: next, evicted }
}

/**
 * Returns the messages from chunks within `[activeChunkId - radius,
 * activeChunkId + radius]` in seq order. This is the array the UI render
 * slice will project from.
 */
export function unionAroundActive<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  radius: number = ACTIVE_CHUNK_NEIGHBOURS,
): T[] {
  if (state.activeChunkId === null) {
    // No active chunk yet (cold bootstrap). Use everything we have.
    return unionAll(state)
  }
  const out: T[] = []
  for (let d = -radius; d <= radius; d += 1) {
    const id = state.activeChunkId + d
    const chunk = state.chunks.get(id)
    if (chunk) out.push(...chunk.messages)
  }
  return out
}

/** Flatten every loaded chunk in seq-asc order. */
export function unionAll<T extends SequencedMessage>(state: ChunkPoolState<T>): T[] {
  const ids = [...state.chunks.keys()].sort((a, b) => a - b)
  const out: T[] = []
  for (const id of ids) {
    const chunk = state.chunks.get(id)!
    out.push(...chunk.messages)
  }
  return out
}

export function hasChunk<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  chunkId: ChunkId,
): boolean {
  return state.chunks.has(chunkId)
}

/**
 * Apply a single live WebSocket message to the pool. If the chunk it
 * belongs to is *not* loaded, the message is dropped — the chunk will be
 * fetched fresh whenever the user scrolls to that range and the server
 * already has the canonical version. Returns `{state, accepted}` so the
 * caller can decide whether to fire a re-fetch.
 */
export function applyLivePatch<T extends SequencedMessage>(
  state: ChunkPoolState<T>,
  message: T,
  options: { upsertById?: (existing: T, incoming: T) => T; nowMs?: number; chunkSize?: number } = {},
): { state: ChunkPoolState<T>; accepted: boolean } {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE
  const targetChunkId = chunkIdForSeq(message.seq, chunkSize)
  const target = state.chunks.get(targetChunkId)
  if (!target) {
    // Chunk not in pool. Drop the patch; the canonical row will arrive when
    // the user scrolls to that range and we fetch the chunk.
    return { state, accepted: false }
  }
  const upsertById = options.upsertById ?? ((_existing, incoming) => incoming)
  const next: ChunkPoolState<T> = { ...state, chunks: new Map(state.chunks) }
  const nextMessages = [...target.messages]
  const existingIndex = nextMessages.findIndex(
    (m) =>
      (m.messageId && m.messageId === message.messageId) ||
      (m.uiId && m.uiId === message.uiId),
  )
  if (existingIndex >= 0) {
    nextMessages[existingIndex] = upsertById(nextMessages[existingIndex], message)
  } else {
    // Insert preserving seq order.
    let insertAt = nextMessages.length
    for (let i = 0; i < nextMessages.length; i += 1) {
      if (nextMessages[i].seq > message.seq) {
        insertAt = i
        break
      }
    }
    nextMessages.splice(insertAt, 0, message)
  }
  next.chunks.set(targetChunkId, {
    ...target,
    messages: nextMessages,
    lastAccessedMs: options.nowMs ?? Date.now(),
  })
  if (state.newestKnownChunkId === null || targetChunkId > state.newestKnownChunkId) {
    next.newestKnownChunkId = targetChunkId
  }
  return { state: next, accepted: true }
}

/** Replace the entire pool (session switch). */
export function resetPool<T extends SequencedMessage>(): ChunkPoolState<T> {
  return createEmptyChunkPool<T>()
}

/**
 * Compute the union message count without materializing the array.
 * Useful for telemetry / debug attributes.
 */
export function poolMessageCount<T extends SequencedMessage>(state: ChunkPoolState<T>): number {
  let n = 0
  for (const chunk of state.chunks.values()) n += chunk.messages.length
  return n
}
