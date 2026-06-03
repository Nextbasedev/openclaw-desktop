# 0018 — Multi-turn row ordering + stale tool `awaitingResult`

**Commit:** `e7360ed3` (branch `v5`)
**Files:** `store/handlers/{rowHelpers,userHandlers,assistantHandlers}.ts` + 2 tests.
**Trigger:** a real multi-turn screenshot from Dixit — the 2nd user message rendered
*above* the 1st assistant reply, and a tool card showed a green `DONE` badge while still
saying "waiting for result…". Both are LIVE-path store bugs (history/bootstrap unaffected,
which is why earlier single-turn verification missed them).

## Bug 1 — multi-turn ordering (seq high-water mark)
Rows sort by `seq` asc. Optimistic rows are assigned `state.maxSeq + 1`. But `maxSeq`
was only advanced for **brand-new** rows; when a **canonical/server seq** was applied to
an **existing** row, `maxSeq` was NOT bumped. The three offenders:
- `handleUserConfirmed` (existing-row branch) — set `row.seq = seq`, no bump.
- `finalizeAssistant` — `if (!existing) state.maxSeq = Math.max(...)` (but the assistant
  row always already exists from streaming).
- `upsertCanonicalUser` — same `if (!existing)` gap.

Server `openclawSeq` is a large global monotonic counter. So after turn 1 finalized with
large seqs (~5001/5002), `maxSeq` was still ~2, and turn 2's optimistic user row got
seq `3` → sorted **above** turn 1's assistant reply.

**Fix:** `noteSeq(state, seq)` helper that does `if (seq > maxSeq) maxSeq = seq`, called
wherever a server seq is observed (both branches of user-confirm, assistant finalize,
canonical-user upsert). Optimistic rows now always land after the latest finalized row.

## Bug 2 — tool card stuck "waiting for result…" under DONE
`mergeToolRow` did `awaitingResult: tool.awaitingResult ?? prev?.awaitingResult`. The
middleware marks a tool awaiting (live result stripped → placeholder `resultMeta`,
`awaitingResult: true`) and backfills the real result via a later patch that **omits**
the flag. The `?? prev` then kept the stale `true` → card stayed pending forever.

`tool` is the server's full current projection, so awaiting must come from it alone:
```ts
const awaitingResult = tool.awaitingResult === true || isAwaitingResultMeta(resultMeta);
```
where `isAwaitingResultMeta` mirrors the middleware's check (`resultMeta.awaitingResult === true`).
No `prev` fallback. When the real result lands (flag absent, real `resultMeta`) → `false`.

## Verification
- `+4` tests: `multiTurnOrdering.test.ts` (2nd-turn optimistic stays below 1st reply;
  maxSeq tracks server seq), `toolAwaiting.test.ts` (awaiting true on placeholder, clears
  on real result). 30/30 chat tests green, typecheck + build clean.
- Live re-verify with an ACTUAL tool call still owed (see below).

## Still open (NOT in this commit) — middleware side
The screenshot's `ARGUMENTS` showed `{title, itemId, kind}` (gateway timeline-item
descriptor) instead of real tool args: `apps/middleware/.../live.ts` (~line 805) builds
tool `args` from `{title, meta, itemId, kind}` on the gateway "item" stream path. And the
real result only arrives via history backfill — if that backfill doesn't reflect, the card
stays awaiting even after Bug 2's fix. Needs a live patch-stream capture + middleware fix.

## Lesson
A monotonic "next id" counter that coexists with externally-assigned ids MUST be kept at
or above the external high-water mark every time an external id is applied — not just when
minting local ids. Otherwise locally-minted ids collide low and sort wrong.
