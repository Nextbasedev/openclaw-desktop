# 0022 — Remove per-session gap guard (spurious rebootstrap under concurrent sessions)

**Commit:** `3c92ab0d` (branch `v5`)
**Files:** `store/applyPatch.ts` + cursorGuards/store tests.
**Found by:** the real subagent golden replay (0023) — frames had non-contiguous cursors.

## The bug (introduced by 0020)
The patch cursor is **global**. After 0020 the store consumes a session-**filtered**
substream (foreign frames are dropped by `ChatSyncClient`, only the cursor advances). So
per-session cursors are legitimately non-contiguous — e.g. while a **subagent** runs, its
child-session frames advance the global cursor and the parent session sees `…1494, 1496,
1498…`. The old `applyPatch` gap guard treated any forward jump `> cursor+1` as a missed
hole and returned `needsBootstrap`, so the store spuriously re-bootstrapped (reload/flicker)
whenever a subagent or any concurrent session was active.

## Fix
Remove the gap guard from `applyPatch`. Gap/recovery is owned by `ChatSyncClient`, which
sees the **contiguous global** stream and re-bootstraps on a real hole (unchanged, still
tested in `chatSyncClient.test.ts`). The store now only dedupes (`cursor <= prev → ignore`)
and keeps the session guard. `ApplyResult.needsBootstrap` remains in the type but is never
set by the reducer.

## Tests
- `cursorGuards.test.ts`: a forward cursor jump now APPLIES (not flagged).
- `store.test.ts`: a forward jump does NOT call `onNeedBootstrap`; store cursor advances.

## Lesson
Gap detection must live at the layer that sees the *complete, contiguous* stream. Once a
consumer filters that stream by entity, its local cursor is non-contiguous by design —
don't gap-check there.
