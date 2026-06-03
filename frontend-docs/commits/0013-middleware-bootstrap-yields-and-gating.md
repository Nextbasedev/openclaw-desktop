# 0013 — Middleware: yield between bootstrap stages + chunked serialize + gated log

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts` (cold bootstrap body)
**Status:** middleware typecheck clean, 179/179 tests pass.
**Follows:** 0011 (dedupe), 0012 (single-pass tools). Implements Problem 1 §1.5(3)+(4).

---

## 1. What changed

Cooperative-yield + log-gating in the cold bootstrap path so no single stage holds
the JS thread:

- `await yieldToEventLoop()` inserted **between heavy stages**: after
  `normalizeHistoryMessages`, after `upsertMessages`, after
  `pruneSegmentToCanonicalMessages`. Pending requests (incl. `/health`) are served
  between the synchronous SQLite bursts.
- The final read-back is now a **chunked serialize loop** instead of
  `listMessages().map(serializeProjectedMessage)`: it yields every
  `BOOTSTRAP_SERIALIZE_YIELD_EVERY` (200) messages.
- `messageFactorSummary` on the hot `bootstrap.gateway.history` log line is now
  **gated** behind `BOOTSTRAP_FACTOR_SUMMARY_LIMIT` (1500). Above that we log just
  `{ total, summarySkipped: true }` instead of re-projecting every message merely
  to emit a log line.

Combined with 0011 (dedupe) and 0012 (O(n) async tools), the entire cold bootstrap
chain now yields at every heavy boundary.

## 2. Deferred (intentionally not done)

The plan §1.5(3) also suggested **bounding the foreground window to ≤300 newest
messages**. That changes the returned `messageCount` (1000→300, relying on
`hasOlder`/older-pagination), which is a **frontend-visible behavior change** that
can't be live-verified right now (production middleware wedged, no SSH; frontend
verified only against a mock). Chunked yields already remove the event-loop wedge
regardless of window size, so the bound is a payload/latency optimization, not a
correctness fix. Left the window constant `BOOTSTRAP_PROJECTION_LIMIT = 1000` (no
behavior change) and documented it as tunable once the windowing is verified live.

## 3. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 179/179.
- `bootstrap-dedupe.test.ts` setTimeout-drift probe (already present) stays < 500ms
  during a 400-message cold build — now with yields the headroom is larger.
- Manual (deploy): concurrent bootstraps on the 4371-message session while curling
  `/health`; `/health` stays sub-second; `bootstrap.end` logs same `messageCount`.
