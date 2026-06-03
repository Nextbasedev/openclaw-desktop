# 0011 — Middleware: per-session in-flight cold-bootstrap dedupe

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts` (`GET /api/chat/bootstrap`)
**Status:** middleware typecheck clean, 177/177 tests pass (2 new).
**Follows:** 0007/0008 (non-blocking import + backfill). Implements Problem 1 §1.5(1)
of `MIDDLEWARE_STABILITY_AND_PROJECTION_PLAN.md`.

---

## 1. What changed

The cold (non-local-first) branch of the bootstrap handler had **no in-flight
dedupe**. K concurrent first-bootstraps for the same huge (4371-message) session
each ran the full synchronous projection chain in parallel → K× the CPU on one JS
thread + serialized SQLite writer locks → `/health` hangs (`http=000`).

Added a module-level `coldBootstrapJobs: Map<sessionKey, Promise<snapshot>>`,
mirroring the proven `archiveProjectionJobs` single-flight (routes.ts:49/595/680):

- On entry to the cold path, if a build is already in flight for that session,
  `log("bootstrap.cold.dedupe")` and return the **same** promise — all awaiters
  receive the identical snapshot from ONE build.
- The cold-path body is wrapped in an `async` IIFE assigned to `coldJob`; the map
  is set synchronously right after the IIFE suspends at its first `await`
  (`chat.history`), so check→set is atomic per request (no await between them →
  no race).
- `.finally` clears the map entry on **success OR failure**, so a bad/throwing
  build can't wedge future callers; rejections still propagate to every awaiter
  (Fastify returns the error), exactly like `archiveProjectionJobs`.
- `clearLocalFirstBootstrapCache()` now also clears `coldBootstrapJobs` for test
  isolation.

## 2. Why

This is the single biggest, smallest-blast-radius win against the production
wedge: it collapses the "concurrent bootstraps compound" trigger from K units of
synchronous work to 1, before any of the O(n²)/yield cleanups (0012+).

## 3. Workarounds / notes

- The IIFE keeps the existing body in place (no module-level extraction) to
  minimise blast radius; indentation is intentionally flat inside the IIFE.
- Local-first fast path is unchanged — dedupe only guards the cold path, which is
  where the wedge lives.

## 4. What improved

- N concurrent cold bootstraps → exactly **one** `chat.history` fetch + one build.
- No behavior change to the returned snapshot shape.

## 5. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 177/177 (new `bootstrap-dedupe.test.ts`):
  - 10 concurrent `/api/chat/bootstrap` for one session → `chat.history` called
    **once**; all 10 return a valid snapshot.
  - setTimeout-drift probe stays < 500ms during a cold build (responsiveness).
- Manual (deploy): wipe middleware SQLite, fire concurrent bootstraps on the
  4371-message session while curling `/health`; `/health` must not return `000`.
