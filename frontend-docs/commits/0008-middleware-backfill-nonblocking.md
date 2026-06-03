# 0008 — Middleware fix: non-blocking live history backfill

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/live.ts` (`backfillHistory`)
**Status:** middleware typecheck clean, 175/175 tests pass.
**Follows:** 0007 (archived-history import fix)

---

## 1. Symptom (observed in production logs)

After 0007, the constant freeze was gone, but `/health` still hit 12s timeouts in
**bursts**: logs showed a `history.backfill` running ~18s, and immediately after it
finished, `/health` returned 200 in 1ms. So a second path — **live history backfill**
— was still blocking the event loop for the duration of each burst.

## 2. Root cause

`live.ts:backfillHistory` is async and awaits the gateway `chat.history` fetch, but the
work *after* the fetch is a synchronous burst:
- `normalizeHistoryMessages` over up to 200 messages,
- `upsertMessages` (one large SQLite transaction),
- a tight `for (const projected of projection.changedMessages)` loop that, per message,
  does `projectToolsFromMessage` (DB writes), `appendProjectionEvent` (DB insert +
  JSON-serialize of the full message payload — can be 50–100KB+ each), and
  `patchBus.broadcast` (JSON.stringify + WS send).

With many large messages, that per-message loop runs for seconds-to-tens-of-seconds
with no `await`, so the single JS thread never returns to the event loop → `/health`
and every other request stall until it finishes.

(`scheduleHistoryBackfill` already debounces at 300ms per session, so this is one
burst, not many — the fix is to make the burst itself non-blocking.)

## 3. Fix

In `backfillHistory`:
- `await yieldToEventLoop()` once after `upsertMessages`, before the projection loop,
  so pending requests get served before the heavy loop starts.
- Inside the `changedMessages` loop, `await yieldToEventLoop()` every
  `BACKFILL_YIELD_EVERY` (8) messages, with a `this.context.db.open` guard to bail
  cleanly if the DB closes during a yield.

`yieldToEventLoop = () => new Promise(r => setImmediate(r))` (module-level in live.ts).

Patch ordering is unaffected: `appendProjectionEvent` assigns monotonically increasing
cursors, so even though broadcasts now span multiple ticks (and may interleave with new
live events), the client applies them in cursor order (and re-bootstraps on a gap).

## 4. What to test
- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 175/175 pass.
- Manual (deploy): trigger a large backfill (e.g. first bootstrap of a long session or
  an assistant-final-after-tools); `/health` should stay sub-second throughout instead
  of hitting 12s timeouts; `history.backfill.end` still logs normally.

## 5. Caveats / follow-ups
- `normalizeHistoryMessages` and the single `upsertMessages` transaction are still
  synchronous. If profiling shows either alone is multi-second on huge histories, chunk
  them too (batch upserts with yields; chunked normalize). The per-message
  broadcast/DB loop was the dominant hog here, so this should remove the visible stalls.
- Same `yieldToEventLoop` discipline should be applied to any other per-message
  broadcast loops if they surface (e.g. resequence/prune over very large sessions).
