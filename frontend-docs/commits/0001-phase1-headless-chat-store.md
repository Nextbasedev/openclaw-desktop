# 0001 — Phase 1: Headless Chat Store

**Branch:** `v5`
**Scope:** `packages/ui/components/chat/**` (new), `packages/ui/vitest.config.ts` (include)
**Status:** complete — 11/11 tests pass, UI typecheck clean
**Depends on:** `CHAT_FRONTEND_PLAN_V5_APPROACH_A.md`

---

## 1. Summary

Builds the foundation of the v5 chat frontend: a **framework-agnostic, fully tested
state core** that turns the middleware's cursor-ordered patch stream into a normalized
chat transcript. No React, no DOM, no network yet — this is the pure data layer that
every later phase renders.

It exists to kill, by design, the v4 bug class (blink/remount, reordered rows, stuck
"Thinking", leaked tool cards, render storms) before any UI is written.

## 2. What was added

Contract types (split by concern, re-exported via a barrel):
- `sync/types.message.ts` — RunStatus/ToolPhase/ToolStatus, `ChatSemanticType`,
  `OCPlatformMessageData`, `ToolCallProjection`, `ActiveRunProjection`.
- `sync/types.patch.ts` — `ChatPatch`, `ChatPatchPayload`.
- `sync/types.stream.ts` — WS `hello`/`patch` frames, `ChatBootstrapSnapshot`.
- `sync/types.contract.ts` — barrel re-export.

Store (single source of truth):
- `store/state.ts` — `ChatSessionState` (normalized rows/runs/tools + id→key indexes),
  stable-key helpers (`userKey`/`runKey`/`msgKey`/`seqKey`), `cloneState`, `reorder`.
- `store/text.ts` — `textFromMessage` (kept in sync with middleware normalizer),
  id/seq/run readers, `isContinuation` streaming guard.
- `store/applyBootstrap.ts` — snapshot → initial state (active-run row kept live).
- `store/applyPatch.ts` — slim dispatcher: cursor guards + semantic→handler table +
  `applyPatches` batch.
- `store/handlers/rowHelpers.ts` — `ensureAssistantRow`, `mergeToolRow`, terminal set.
- `store/handlers/userHandlers.ts` — `chat.user.created` / `chat.user.confirmed`.
- `store/handlers/assistantHandlers.ts` — `chat.assistant.delta`, `chat.reasoning.delta`,
  canonical `chat.message.upsert`/`assistant.final`/`final`.
- `store/handlers/toolHandlers.ts` — `chat.tool.*`.
- `store/handlers/runHandlers.ts` — `chat.run.*` / `chat.status`.
- `store/selectors.ts` — `historyRows`, `liveRows`, `toolsForRow`, `toolsForRun`,
  `isGenerating`, `thinkingPlaceholderVisible`.

Tests (isolated suites + shared fixtures/helpers):
- `store/__tests__/fixtures.ts`, `helpers.ts`
- `cursorGuards`, `userReconcile`, `assistantStream`, `toolsAndRun`, `fullTurn`,
  `bootstrap` `.test.ts`.

## 3. Why (design rationale)

The v4 chat UI derived identity from message **content** (`text + attachment names +
order`), wrapped assistant-ui inside the legacy ChatView, and had no single owner for
run state. Result: duplicate text collapsed rows, reorders shifted assistant slots,
`isRunning` got stuck from many triggers, tool cards leaked across turns, and streaming
fought reconciliation (final id ≠ live id → remount → blink).

Phase 1 encodes the opposite rules, verified by tests:
- **Server identity only.** Row React keys: user = `client:<clientMessageId>`,
  assistant turn = `run:<runId>`, history = `msg:<messageId>`. Sort by `openclawSeq`.
- **Reconcile in place.** `chat.user.confirmed` rewrites the optimistic row's identity
  under the *same key* via the `byClientId` index — no delete+recreate.
- **Cumulative streaming.** `chat.assistant.delta` carries full text → set, not append.
- **One owner for status.** Only `chat.run.*` mutates `status`/`activeRun`; terminal
  states (server sends `activeRun: null`) clear it.
- **Cursor is law.** Duplicates dropped (`cursor <= state.cursor`); a hole
  (`cursor > state.cursor + 1`) returns `needsBootstrap` instead of partial apply.
- **Live vs history split.** Unfinalized rows (`finalized:false`) live in the tail;
  `chat.run.done` flips the flag so the row migrates to history. This is what lets a
  later phase render the streaming turn outside the virtualizer.

## 4. Workarounds / gotchas

- **`payload.semanticType`, not `type`.** The middleware sets the WS frame's top-level
  `type` to the *eventType* (e.g. `chat.message.upsert`) while the real classifier is
  `payload.semanticType` (e.g. `chat.assistant.delta`). The reducer dispatches on
  `semanticType`. Getting this wrong silently misroutes streaming chunks.
- **Optimistic/live rows have no server seq.** `chat.user.created` and
  `chat.assistant.delta` arrive before a canonical `openclawSeq`. We assign an
  ephemeral seq (`maxSeq + 1`, `ephemeralSeq:true`) and overwrite it with the real
  `messageSeq` on confirm/finalize. Keeps ordering stable without guessing.
- **Confirmed user must be finalized.** Early bug: the in-place reconcile updated the
  optimistic row but left `finalized:false`, so the user message stayed stuck in the
  live tail. Fix: a confirmed user message is final history → set `finalized:true`.
  (Caught by `fullTurn` expecting 2 history rows.)
- **TS named-import quirk.** In the full `tsc` project build, importing
  `OCPlatformMessageData` on a shared import line in `applyBootstrap.ts` raised a phantom
  TS2305 "no exported member", while the same import resolved fine in isolation and in
  `text.ts`. Workaround: import that type on its own line. Later refactor into split
  type modules removed the condition entirely.
- **File-size rule.** Everything kept ≤ 200 lines; the 363-line reducer was split into
  per-semantic handler modules + a 71-line dispatcher; the 205-line contract into
  three concern files + barrel; the 231-line test into 6 isolated suites.

## 5. What improved

- A provably-correct transcript model independent of any UI framework.
- Each concern in its own ≤200-line module → easy to read, test, and replace.
- The exact v4 failure modes are now regression tests, not hopes.
- Re-bootstrap recovery is a first-class reducer signal (`needsBootstrap`), ready for
  the Phase 2 sync client to act on.

## 6. What to test

Automated (this commit):
- `pnpm --filter ui vitest run components/chat` → 11 tests, 6 files, all green.
- `pnpm --filter ui typecheck` → clean.

Covered behaviors (regression guarantees):
1. Duplicate / already-applied cursor is ignored (no-op, same state ref).
2. Cursor gap → `needsBootstrap:true`, state unchanged.
3. `user.created` → `user.confirmed` keeps the same row key; no duplicate; canonical
   id + seq adopted; row becomes finalized history.
4. Assistant deltas set cumulative text on one `run:<id>` row; `delta → final` keeps
   the key; `run.done` finalizes and migrates to history; `activeRun` cleared.
5. Tool calls attach to their run row in order; `started + result` dedupe to one entry;
   result output + success status captured.
6. Run status single owner: `thinking → streaming → error` ends with `activeRun:null`.
7. Full 10-patch turn → clean 2-row transcript (user, assistant) in seq order with
   reasoning + tools; idempotent on replay; duplicate user text does NOT collapse rows.
8. Bootstrap rebuilds state, keeps the active-run row in the live tail and the user row
   in history; pagination (`hasOlder/knownTotalMessages/oldestLoadedSeq`) preserved;
   subsequent live patches respect the bootstrap cursor.

Manual: none (no UI/network in this phase).

## 7. Follow-ups
- Phase 2: `ChatSyncClient` consuming this reducer (`applyPatch`/`applyBootstrap`),
  acting on `needsBootstrap`, with fake-WS reconnect/gap tests.
- Add real captured patch fixtures (record from `/api/patches`) alongside the synthetic
  ones for extra fidelity.
