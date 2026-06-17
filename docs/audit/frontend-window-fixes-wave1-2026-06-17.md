# Frontend Window Foundation Fixes — Wave 1 — 2026-06-17

**Branch:** `v6-1-krish-window-stabilize`
**Agent:** F2 (frontend)
**Scope:** `packages/ui/` only

## Commits (this wave)

| SHA | Subject |
| --- | --- |
| `f8259870` | fix(chat): use per-session seq for evicted-patch drop check (BUG-1) |
| `7973da41` | fix(chat): prefer server pagination flags over count heuristic (BUG-3) |
| `b968c177` | fix(chat): skip seqless rows when deriving window cursors (BUG-4) |
| `942a35c0` | feat(chat): runtime window-state invariant assertions |

Plus, landed in parallel by Agent F1 (middleware):

| SHA | Subject |
| --- | --- |
| `d582cdb0` | fix(middleware): add over-fetch window loop and envelope metadata to /api/chat/messages |

## Bugs fixed

### BUG-1 — `shouldDropPatchAsEvicted` cursor/seq namespace mismatch
- **Status:** fixed.
- **Root cause confirmed:** `frame.patch.cursor` is the global cross-session projection cursor (`store.ts` comment: *"The websocket cursor is global across all sessions"*); `newestLoadedSeq` is a per-session `gatewayIndex`. Comparing them dropped every live patch once `hasNewer=true`.
- **Fix:** Added `derivePatchTargetSeq(frame, messages)` to `applyPatches.ts` which resolves the per-session seq from (a) `payload.messageSeq` / `payload.gatewayIndex`, (b) `__openclaw.seq` on the inline message, (c) the in-window message addressed by the patch's id, (d) for tool patches, the run's parent user message. Returns `undefined` when no anchor is derivable. Renamed `shouldDropPatchAsEvicted`'s field `patchSessionCursor` → `patchTargetSeq` (now `number | undefined`) and treats `undefined` as "do not drop". Wired the call site at `ChatView/index.tsx` (was `:1024-1028`).
- **Test:** `packages/ui/components/ChatView/__tests__/cursorNamespaceDrop.test.ts` — 7 cases (helper resolution paths + the integration drop-decision matrix). Verified failing before fix, passing after.

### BUG-3 — `hasOlder` derived from `returnedCount >= requestedLimit` instead of server flag
- **Status:** fixed.
- **Root cause confirmed:** `BootstrapPayloadV2.hasOlder` and the new `/api/chat/messages` envelope flags (now shipped by F1's `d582cdb0`) were ignored. Heuristic was wrong on exact-fit pages and when `normalizeHistory` filtered rows.
- **Fix:** Extended `applyInitialPage`, `applyOlderPage`, `applyNewerPage` to accept optional `serverHasOlder?` / `serverHasNewer?`. When present, the server flag wins. When absent, falls back to the count heuristic **and** emits `console.warn("[chat-rebuild.window] server envelope missing <field>; falling back to count heuristic")` gated on `process.env.NODE_ENV === "development"` (so tests and prod stay quiet). Extended `ChatMessagesPageV2` with optional `hasOlder`, `hasNewer`, `oldestSeq`, `newestSeq`, `epoch` fields. Wired all five `applyInitialPage` sites + two `applyOlderPage` + two `applyNewerPage` sites in `ChatView/index.tsx`.
- **Test:** Four new cases in `messageWindow.test.ts` under `applyInitialPage server-flag preference (BUG-3)`: server-says-false beats heuristic-true (exact-fit); server-says-true beats heuristic-false; no flag falls back without dev warn in test env; no flag in development env emits the dev warn.

### BUG-4 — Synthetic tool rows poison `newestLoadedSeq`
- **Status:** fixed (approach B per parent task).
- **Root cause confirmed:** `applyToolPatch` synthesizes `live:${runId}:tools` with `gatewayIndex = undefined` when the parent user message is outside the window. Cursor derivations took `messages.at(-1).gatewayIndex` and ended up writing `appendedNewestSeq = null`, which `applyLiveAppend` fell back to `prevState.newestLoadedSeq` — freezing the cursor and breaking `fetchNewerPage`.
- **Fix:** Added `lastSeqfulGatewayIndex(messages)` / `firstSeqfulGatewayIndex(messages)` helpers in `messageWindow.ts` that walk past seqless rows. Wired them into all five derivation sites in `index.tsx`: the three live-append branches in the SSE patch handler (`canEvictFromStartOnLiveAppend` true, `canEvictFromStartOnLiveAppend` false, length-≤-MAX), the older-page tail derivation, and the newer-page head derivation. Synthetic seqless rows at either boundary can no longer drag derived cursors to null.
- **Test:** `packages/ui/components/ChatView/__tests__/seqfulGatewayIndex.test.ts` — 10 cases (last + first helpers; trailing seqless, multiple seqless, all seqless, empty array, NaN handling, head mirror cases). Verified failing before fix, passing after.

## Window invariants module

- **File:** `packages/ui/components/ChatView/windowInvariants.ts` (~170 LOC).
- **API:** `assertWindowInvariant(windowState, messages, label?)`. Dev throws `WindowInvariantViolationError`; prod (`NODE_ENV === "production"`) emits `console.warn("[chat-rebuild.window.invariant-violation]", context)` and returns.
- **Invariants enforced:**
  1. `messages.length <= MAX_LOADED` (160).
  2. Seqful rows sorted strictly ASC by `gatewayIndex` (seqless synthetic rows are skipped).
  3. `oldestLoadedSeq` matches first seqful row when non-null.
  4. `newestLoadedSeq` matches last seqful row when non-null.
  5. `oldestLoadedSeq <= newestLoadedSeq` when both present.
- **Wiring:** a `useEffect([windowState, state.messages])` post-commit hook in `ChatView/index.tsx` runs the assertion with label `"post-commit"`. Covers every transition (cold bootstrap, registry hydrate, reconcile, older page, newer page, live patch batch, reset-to-live-tail) automatically — by definition, a React commit is a state transition.
- **Test coverage:** `packages/ui/components/ChatView/__tests__/windowInvariants.test.ts` — 14 cases: 4 happy paths (short, empty, all-seqless, interleaved seqless), 6 violations (length, sort, duplicate seqs, oldest mismatch, newest mismatch, oldest > newest), 2 prod-warn paths, 1 label propagation, 1 test-env throw.
- **Caught any real violations?** No. Test suite is green (192/192) with assertion live in `ChatView`. No transitions in the existing covered paths trip an invariant.

## Tests added

| File | Test | What it asserts |
| --- | --- | --- |
| `cursorNamespaceDrop.test.ts` | `derivePatchTargetSeq returns payload.messageSeq when present` | helper prefers per-session payload seq over global cursor |
| `cursorNamespaceDrop.test.ts` | `falls back to in-window message gatewayIndex when payload omits seq` | helper resolves through state lookup |
| `cursorNamespaceDrop.test.ts` | `tool patch resolves to parent user message's seq via runId` | tool patches use parent user seq as anchor |
| `cursorNamespaceDrop.test.ts` | `returns undefined when no seq is derivable` | safe fallback for unrecoverable patches |
| `cursorNamespaceDrop.test.ts` | `does not drop patch when target row is in window even with global cursor >> seq` | BUG-1 regression: in-window patch must apply despite global cursor 10k |
| `cursorNamespaceDrop.test.ts` | `drops patch when target seq is beyond newestLoadedSeq (true eviction case)` | the gate still drops legitimately evicted patches |
| `cursorNamespaceDrop.test.ts` | `undefined target seq (no anchor) is treated as 'do not drop'` | safety property of the gate |
| `messageWindow.test.ts` | `server hasOlder=false beats count heuristic when 160 returned (exact-fit)` | BUG-3: server flag wins on exact-fit |
| `messageWindow.test.ts` | `server hasOlder=true beats count heuristic when fewer than limit returned` | BUG-3: server flag wins under-fill (filtered rows) |
| `messageWindow.test.ts` | `no server flag: falls back to count heuristic (no warn in test env)` | dev-warn gated correctly |
| `messageWindow.test.ts` | `no server flag in development: falls back AND emits dev warn` | dev-warn fires in dev |
| `messageWindow.test.ts` | `patchTargetSeq=undefined → false (no derivable seq, apply patch — BUG-1 safety)` | extends the gate's safety contract |
| `seqfulGatewayIndex.test.ts` | 6 `lastSeqfulGatewayIndex` cases + 4 `firstSeqfulGatewayIndex` cases | BUG-4: synthetic seqless rows are skipped at both ends |
| `windowInvariants.test.ts` | 14 cases (happy paths, all 5 rules' violations, prod warn, label propagation, test-env throw) | invariant module behaviour end-to-end |

Net: **+38 new tests**, all green.

## Verification

- **typecheck:** `pnpm --filter ui typecheck` → **pass** (clean exit 0).
- **targeted vitest:** `pnpm --filter ui exec vitest run components/ChatView/__tests__/ lib/chat-engine-v2/__tests__/applyPatches.test.ts lib/chat-engine-v2/__tests__/longConversation.test.ts` → **192 passed / 0 failed** (12 files).
- **pre-existing failures verified unrelated:** None hit in the targeted run. `chat-engine-v2/__tests__/store.test.ts` was not in the targeted set (per parent guidance about pre-existing MEMORY-noted failures); I did not regress it.
- **eslint (touched files only):** **0 errors, 7 warnings.** All 7 warnings are pre-existing — verified by running eslint on the same files at the pre-Wave-1 HEAD (`b524a011`) and getting the same count. Specifically: 2 react-hooks/exhaustive-deps in `ChatView/index.tsx` (handleSend, windowState.newestLoadedSeq) and 5 unused-vars in `lib/chat-engine-v2/client.ts` (`getMiddlewareConnection`, `HelloFrame`, `_sp`, `_ss`, `_sl`). I introduced two unused `eslint-disable-next-line no-console` directives during initial implementation and removed them before committing.
- **build:** **skipped — host OOM as documented.** Started `NODE_OPTIONS=--max-old-space-size=2560 pnpm --filter ui build`; host had 3.4 GB of 3.8 GB RAM already in use, build ran without producing any progress output for >4 minutes. Killed per parent task instructions ("don't waste hours fighting host RAM").

## Bugs deferred

- **BUG-2 (newer-page eviction grows buffer unbounded):** Wave 2. Needs the F1 envelope (now landed in `d582cdb0`) plus a bottom-proximity guard so the eviction can run at quiescence without yanking the user's scroll anchor mid-scroll. Restoring `f75e1876` straight would re-introduce the jolt unless the anchor-restore path is exercised. Not in scope here.
- **BUG-5 (triple dedupe pipeline):** Latent / unconfirmed. Defer until either repro is produced or the dedupe pipeline is consolidated.

## What the audit got right vs wrong

The audit was accurate on all three Wave-1 bugs at file:line precision. Specific confirmations from this implementation:

- **BUG-1:** `frame.patch.cursor` is unambiguously the global cursor (advanced in the SSE handler before any session filtering, persisted to a single-key `localStorage` entry). Audit verdict: correct.
- **BUG-3:** `applyInitialPage`'s old signature ignored every existing server hint. Audit verdict: correct. The audit listed the call sites well — I found exactly 5 `applyInitialPage` + 2 each of `applyOlderPage` / `applyNewerPage`, matching the audit's "3 call sites" rough estimate (the audit undercounted slightly — the optimistic-bootstrap path and the registry-reconcile fetch were not listed but exist).
- **BUG-4:** `inferToolAssistantSeqFromRun` and the synthesized row's missing `gatewayIndex` flow into the `appendedNewestSeq` derivation exactly as the audit traced. Audit verdict: correct.

No paper-fixable misclaims found.

## Notes for parent / next wave

- F1's `d582cdb0` shipped the envelope with `hasOlder`, `hasNewer`, `oldestSeq`, `newestSeq`, `epoch`. My BUG-3 code reads these defensively (optional fields) so the integration is live without further coordination. The dev warn for missing envelope fields will help catch any future endpoint that forgets to pass them through.
- The `useEffect` post-commit invariant assertion adds one extra render-time function call per commit. The function is O(n) in `messages.length`, capped at 160. Negligible cost. If anyone later finds it hot in profiling, the gate inside `assertWindowInvariant` is one branch; the body short-circuits on the first violation.
- `derivePatchTargetSeq` is now an exported API of `applyPatches.ts`. If you add a new patch type that needs its own anchor resolution, extend the helper rather than the call site so the gate stays single-sourced.
- Wave 2 BUG-2 fix should probably use the new `assertWindowInvariant` post-commit hook as a regression net: any newer-page apply that pushes `messages.length` past 160 will throw in dev, immediately surfacing the failure.
- For tests that exercise dev-warn behaviour, prefer `vi.stubEnv("NODE_ENV", "...")` over direct assignment to `process.env.NODE_ENV` — vitest's `process.env` type is read-only and the cast workaround is ugly.

## File-level diff summary (packages/ui only)

```
packages/ui/components/ChatView/__tests__/cursorNamespaceDrop.test.ts |  new
packages/ui/components/ChatView/__tests__/messageWindow.test.ts       |  +88 / -10
packages/ui/components/ChatView/__tests__/seqfulGatewayIndex.test.ts  |  new
packages/ui/components/ChatView/__tests__/windowInvariants.test.ts    |  new
packages/ui/components/ChatView/index.tsx                             |  ~50 changed
packages/ui/components/ChatView/messageWindow.ts                      |  ~75 added
packages/ui/components/ChatView/windowInvariants.ts                   |  new (~170 LOC)
packages/ui/lib/chat-engine-v2/applyPatches.ts                        |  +73
packages/ui/lib/chat-engine-v2/client.ts                              |  +10
```

No middleware files modified. No drive-by refactors. Commits are atomic per bug.
