# 0015 — Middleware: idempotent backfill of archived tool calls + lazy trigger

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts`, `repo.runs.ts`
**Status:** middleware typecheck clean, 182/182 tests pass (1 new).
**Follows:** 0014 (import-time tool projection). Implements Problem 2 §2.4 backfill.

---

## 1. What changed

0014 fixes tool projection for **new** archive imports, but sessions imported
**before** 0014 already have message rows and **zero** tool rows. Added a one-shot,
idempotent backfill:

- `backfillArchivedToolCalls(context, sessionKey)` — reads projected SQLite messages
  in bounded 300-row pages via `listMessages({ afterSeq, limit })`, in **two paged
  passes**:
  1. collect all tool results across the session (`collectArchivedToolResults`),
  2. upsert one row per `toolCall` block, attaching its session-wide-paired result
     (`upsertArchivedToolCalls`).
  Two passes (not per-page) so toolCall/result pairing is correct across page
  boundaries. Yields between pages.
- `projectArchivedSegmentToolCalls` (0014) refactored to reuse the same two phases.
- `RunRepository.countToolCalls(sessionKey)` — cheap `count(*)` gate.
- **Lazy trigger** in the background `scheduleArchivedHistoryProjection` job: when
  `countToolCalls(sessionKey) === 0`, run the backfill; if it projects any rows,
  the existing `chat.bootstrap` refresh broadcast now also fires
  (`archivedProjection.changed || backfilledTools > 0`) so live clients refetch and
  render the historical tool cards. Post-0014 imports have `countToolCalls > 0` →
  the backfill is skipped.

## 2. Idempotency

`upsertToolCall`'s `ON CONFLICT(session_key, tool_call_id)` + terminal-state guard
(`repo.runs.ts:231`) means re-running never duplicates rows nor resurrects terminal
tools as running — safe to run on every cold bootstrap of a historical session.

## 3. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 182/182. New
  `archived-tool-backfill.test.ts`:
  - messages-but-zero-tools (toolCall + result across the set, success + error) →
    backfill projects 2 rows with correct paired status; `countToolCalls` 0 → 2.
  - second run is a no-op (count stays 2, nothing running).
- Manual (deploy): cold-bootstrap a pre-0014 historical session → background job
  logs `bootstrap.archived-history.tools.backfill`, broadcasts a refresh, tool cards
  appear (with 0016 scoping).
