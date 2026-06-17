/**
 * BUG-5 regression test (docs/audit/deep-verification-2026-06-17.md item 1).
 *
 * Middleware ships a per-session seq epoch (UUID string) end-to-end on:
 *   - /api/chat/bootstrap response envelope
 *   - /api/chat/messages response envelope (field `seqEpoch`)
 *   - SSE hello frame
 *   - Every patch payload
 *
 * The frontend caches the bootstrap epoch and compares every subsequent
 * envelope/patch frame against the cache. If the incoming epoch differs,
 * the message space has been resequenced (resequence, prune, late-echo
 * collision shift) and any stale cursors (`oldestLoadedSeq`,
 * `newestLoadedSeq`) point at a dead seq space — the only safe recovery
 * is a full re-bootstrap via `resetToLiveTail()`.
 *
 * This helper is the comparison primitive. The "no cache yet → first
 * arrival adopts" case is critical: the bootstrap response is the FIRST
 * arrival and must NOT trigger a self-reset.
 */

import { describe, expect, test } from "vitest"
import { shouldRebuildForEpochMismatch } from "../seqEpoch"

describe("shouldRebuildForEpochMismatch (BUG-5 frontend consumer)", () => {
  test("returns true when cached and incoming differ (mid-session resequence)", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: "epoch-uuid-A",
        incomingEpoch: "epoch-uuid-B",
      }),
    ).toBe(true)
  })

  test("returns false when cached and incoming match (happy path)", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: "epoch-uuid-A",
        incomingEpoch: "epoch-uuid-A",
      }),
    ).toBe(false)
  })

  test("returns false on first arrival (cached=null, incoming string) so bootstrap can adopt it", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: null,
        incomingEpoch: "epoch-uuid-A",
      }),
    ).toBe(false)
  })

  test("returns false when middleware omits the field (backwards compat)", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: "epoch-uuid-A",
        incomingEpoch: undefined,
      }),
    ).toBe(false)
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: "epoch-uuid-A",
        incomingEpoch: null,
      }),
    ).toBe(false)
  })

  test("returns false when neither side has an epoch (legacy + no server)", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: null,
        incomingEpoch: null,
      }),
    ).toBe(false)
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: null,
        incomingEpoch: undefined,
      }),
    ).toBe(false)
  })

  test("treats empty string as 'no epoch' (defensive — middleware should never send '')", () => {
    expect(
      shouldRebuildForEpochMismatch({
        cachedEpoch: "epoch-uuid-A",
        incomingEpoch: "",
      }),
    ).toBe(false)
  })
})
