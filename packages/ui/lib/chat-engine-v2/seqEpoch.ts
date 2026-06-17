/**
 * Per-session sequence epoch comparison (BUG-5 frontend consumer).
 *
 * Background:
 *   The middleware bumps a per-session UUID `seqEpoch` every time it
 *   resequences/prunes/shifts the `openclaw_seq` space (see
 *   `repo.messages.ts:bumpSessionSeqEpoch` and call sites at
 *   resequenceSessionMessages / deleteMessageById /
 *   deleteMessagesForSegment / pruneSegmentToCanonicalMessages /
 *   seq-shifted-on-late-echo).
 *
 *   The frontend window state caches `oldestLoadedSeq` and
 *   `newestLoadedSeq` against the seq space that was current at
 *   bootstrap. If the seq space is mutated mid-session and the frontend
 *   does NOT notice, every subsequent fetch (older/newer page) and every
 *   eviction decision keys on a dead seq → silent stale-window paging.
 *
 *   The fix is end-to-end: middleware ships the epoch on every envelope
 *   and patch payload; the frontend caches the first epoch it sees and
 *   compares every subsequent arrival. On mismatch, the only safe action
 *   is `resetToLiveTail()` — clear cursors, re-bootstrap, adopt the new
 *   epoch.
 *
 * Contract:
 *   - `cachedEpoch=null, incoming=non-empty string` → returns false. The
 *     first arrival is the bootstrap response; consuming code must adopt
 *     it into the cache. Returning true here would cause an infinite
 *     reset loop on every bootstrap.
 *   - `incoming=null|undefined|""` → returns false. Either the server is
 *     pre-Bug-5 (no epoch) or this particular patch did not carry the
 *     field. Backwards compatible.
 *   - `cached === incoming` → returns false. Happy path.
 *   - Both present and different → returns true. Caller must
 *     `resetToLiveTail()`.
 */
export function shouldRebuildForEpochMismatch(input: {
  cachedEpoch: string | null
  incomingEpoch: string | null | undefined
}): boolean {
  const { cachedEpoch, incomingEpoch } = input
  if (!incomingEpoch) return false
  if (!cachedEpoch) return false
  return cachedEpoch !== incomingEpoch
}
