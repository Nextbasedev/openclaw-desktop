# 0014 — Middleware: project tool calls during archived-history import

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/routes.ts` (`persistArchivedHistorySegments`)
**Status:** middleware typecheck clean, 181/181 tests pass (2 new + 1 updated).
**Follows:** 0007 (archived import non-blocking). Implements Problem 2 §2.4 Option A
(import-time half) of the stability plan.

---

## 1. Root cause (Problem 2)

A 4371-message session is reconstructed in SQLite from **archived segments**.
`persistArchivedHistorySegments` wrote message rows (`upsertMessages`) but **never**
projected tool rows into `v2_tool_calls`. The gateway `chat.history` window that the
foreground `inferBootstrapToolCalls` sees only covers the recent tail, so the 600+
`toolCall` blocks living in archived segments yielded **zero** tool rows →
`tools`/`toolCalls` empty on historical sessions.

## 2. What changed

New `projectArchivedSegmentToolCalls(context, sessionKey, normalized)` (exported for
tests), called inside `persistArchivedHistorySegments` right after each file's
`upsertMessages`:

- **Pass 1:** build `Map<toolCallId, {status, resultMeta, finishedAtMs}>` from
  `extractToolEventsFromMessage` result/error events (reuses the existing projector
  primitive at `gateway-event-projector.ts:184`).
- **Pass 2:** one `upsertToolCall` per `toolCall` block, attaching its paired result,
  correlating `messageId` (`__openclaw.id`) and `runId` (`__openclaw.runId` or
  `null`). Yields every 25 messages (0007 discipline).
- Idempotent: `ON CONFLICT(session_key, tool_call_id)` + the terminal-state guard in
  `upsertToolCall` (`repo.runs.ts:231`) means re-import never duplicates rows nor
  resurrects terminal tools as running.
- `persistArchivedHistorySegments` now returns/logs `projectedTools`.

## 3. Behavior change (intentional) + test update

`tests/app.test.ts > "archived tool-call history is imported …"` previously asserted
`v2_tool_calls count === 0` — that asserted the **bug**. Updated to the new intended
behavior: the historical tool is projected as **one terminal, run-detached row**
(`tool_call_id: old-tool`, `run_id: null`, `status: success`) and is **not**
resurrected as running. This preserves the original "no active-tool resurrection"
invariant while fixing the empty-tools bug.

## 4. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean.
- `pnpm --filter ./apps/middleware test` → 181/181. New
  `archived-tool-projection.test.ts`:
  - synthetic archive (toolCall + matching toolResult, success + error) → one row
    per `toolCallId`, paired status, correct `messageId`.
  - re-running is a no-op (no duplicate / no running resurrection).
- The snapshot surfacing of these run-detached rows depends on the scoping fix in
  0016 (Problem 2 §2.7); the backfill for already-imported sessions is 0015.
