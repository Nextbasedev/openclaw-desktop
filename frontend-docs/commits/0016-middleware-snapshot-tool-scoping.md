# 0016 — Middleware: snapshot tool-scoping for historical sessions

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/projection.ts` (`buildChatBootstrapSnapshot`)
**Status:** middleware typecheck clean, 184/184 tests pass (2 new), build green.
**Follows:** 0014/0015 (archived tool projection + backfill). Implements Problem 2 §2.7.

---

## 1. What changed

`buildChatBootstrapSnapshot` previously scoped `tools`/`toolCalls` to
`latestRun.runId` whenever **any** run row existed for the session:

```
const tools = (latestRun ? listToolCalls(sessionKey, latestRun.runId)
                         : listToolCalls(sessionKey)).map(...)
```

So even after 0014/0015 projected historical tools with `runId = null`, a leftover
**terminal** `latestRun` would scope them out → historical cards still hidden.

Changed the scope gate from `latestRun` to `activeRun`
(`findLatestPendingRun`):

```
const tools = (activeRun ? listToolCalls(sessionKey, activeRun.runId)
                         : listToolCalls(sessionKey)).map(...)
```

- **Active run live** → strict run-scoping preserved (no leaking stale/detached
  historical tools into a live turn — the original anti-resurrection invariant).
- **No active run** (terminal/historical session) → session-wide tools, so
  run-detached (`runId NULL`) archived tool cards render.

## 2. Risk / behavior note

For a completed multi-run session the top-level `tools` array now contains **all**
session tools (every run + null-run) instead of only the latest run's. That is the
intended fix — tool cards attach to their message by `messageId`, and historical
turns should show their tools. Live active-run snapshots are unchanged.

## 3. What to test

- `pnpm --filter ./apps/middleware typecheck` → clean; `build` → green.
- `pnpm --filter ./apps/middleware test` → 184/184. New
  `bootstrap-snapshot-scoping.test.ts`:
  - terminal run + 2 run-detached (`runId NULL`) tools → `snapshot.tools` has both.
  - live `thinking` run → `snapshot.tools` contains only the active run's tool, not
    a stale detached historical tool.
- Manual (deploy): bootstrap the real 4371-message historical session → `tools`/
  `toolCalls` non-empty, historical cards render; a live normal session still shows
  only its active-run tools (no regression).
