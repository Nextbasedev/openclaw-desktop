# Bootstrap Prune Recovery

## Context

The duplicate chat bubble fixes already covered live user echoes, delayed backfill echoes, same-run duplicate rows, and stale SQLite projection pruning in middleware.

One remaining failure mode exists after middleware prunes stale local rows: the middleware can emit a `chat.bootstrap` metadata patch with `{ pruned: N }`, but the frontend global chat engine keeps its in-memory `state.messages` unchanged unless a full bootstrap reload runs. A metadata patch updates cursor/count, but it cannot remove already-visible stale rows.

## Root Cause

`packages/ui/lib/chat-engine-v2/store.ts` already dispatched `openclaw:chat-bootstrap-recovery` for `backgroundArchiveImport` bootstrap patches, because archive imports mutate canonical history outside normal message upserts.

The SQLite prune path is the same class of event: canonical history changed outside normal message patches. The frontend did not treat `{ pruned: N }` as a recovery signal, so the duplicate could remain visible until a manual reload/tab reopen triggered `/api/chat/bootstrap` again.

## Fix

When a `chat.bootstrap` patch includes `pruned > 0`, dispatch the same scoped bootstrap recovery event used for archive imports:

- reason: `bootstrap-pruned`
- event: `openclaw:chat-bootstrap-recovery`
- effect: active chat hook invalidates bootstrap cache and refetches authoritative `/api/chat/bootstrap`

This keeps the fix narrow: middleware remains the canonical prune owner; UI only refetches when middleware says rows were pruned.

## Regression Test

Added `bootstrap prune metadata triggers scoped bootstrap recovery` in `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`.

The test seeds a duplicate visible row, ingests a metadata-only `chat.bootstrap` patch with `pruned: 1`, and asserts that the scoped recovery event fires.
