# 0021 — Run lifecycle authoritative on every patch (the keystone fix)

**Commit:** `ac3bf9e5` (branch `v5`)
**Files:** `store/handlers/runHandlers.ts`, `store/applyPatch.ts`, `store/state.ts`,
`__tests__/fixtures.ts`, golden `s01`/`s03` + `goldenLifecycle.test.ts`.
**Found by:** the QA bug-discovery pass (replaying real `/api/patches` streams through
the actual reducer).

## The bug (🔴 blocker)
Live successful runs **never finalized**. The real wire embeds run state
(`runStatus` + `activeRun`) in EVERY frame and delivers the success terminal
(`runStatus:done, activeRun:null`) inside **`chat.assistant.final`** — there is **no
`chat.run.done` frame** (confirmed on `/api/patches` AND the live WS, across every
captured golden stream). The old store only applied run state inside dedicated
`chat.run.*` handlers, so on the live path:
- `isGenerating` stuck **true** → Composer showed **"Stop" forever**; no model/usage footer.
- Assistant rows never left the `LiveTail`. `VirtualHistory` (finalized rows) renders
  ABOVE `LiveTail`, so live multi-turn showed **all users, then all assistants** — the
  real mechanism behind the "2nd user above the 1st reply" screenshot. (0018's `noteSeq`
  fixed `orderedRows` sort but not the finalized/live split.)
- **Self-healed on reload** (bootstrap reads run state) → every single-turn happy-path
  check passed and missed it.
- Test trap: fixtures injected a synthetic `chat.run.done` the wire never emits — the
  exact "fixtures encode a wrong assumption" failure doc 0019 warned about.

## The fix
`reconcileRunState(state, payload, now)` is applied after the content handler for
**every** patch in `applyPatch`:
- updates the per-run status registry,
- finalizes the run's assistant row on a terminal status (live tail → history),
- mirrors `activeRun` authoritatively (guarded by presence: only touch it when the frame
  carries it; every real frame does). It does NOT create rows (lazy via delta/tool/final;
  thinking placeholder covers the gap).

`chat.run.*` / `chat.status` removed from the content `HANDLERS` map (run lifecycle is now
central). `RunRow.assistantKey` widened to `RowKey | null`. Fixtures' `assistantFinal`
corrected to embed the terminal (`runStatus:done, status:done, activeRun:null`) like the
real wire; the synthetic `runDone()` is now redundant.

## Tests (real bytes)
`goldenLifecycle.test.ts` replays captured streams with **no `chat.run.done`**:
- `s01` single text: `activeRun` null, `isGenerating` false, 0 live rows, history finalized.
- `s03` multi-turn: rows interleave `u,a,u,a,u,a` (bug produced `u,u,u,a,a,a`), all finalized.
38/38 chat tests green, typecheck + build clean.

## Lesson
When the source makes state authoritative on every event, the projection must honor it on
every event — don't gate critical lifecycle transitions on a dedicated frame type you
*assume* exists. Verify the frame inventory from the wire first.
