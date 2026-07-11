# Telegram Chat Reliability Loop

**Date:** 2026-07-10  
**Branch:** `telegram-integrate`  
**Status:** Phase 0–4 done · Phase 5 live E2E needs connected gateway

## One goal

Imported Telegram/Discord sessions behave like normal desktop chats end-to-end:

open → ≤160 paint → send → stream without blink/order jump → tools/actions correct → scroll-up 100/100… to seq=1 → reimport/reopen stable → **normal chats unchanged**.

## Authority model

| Layer | Authority |
|-------|-----------|
| Gateway transcript | Agent context (full) |
| SQLite projection | Full local history (import + live) |
| Bootstrap / messages APIs | Windowed READ only (160 / 100) |
| Patch stream | Only live updates during a run |
| UI `state.messages` | Bounded window; never full dump |

## Invariants (must not regress)

1. Order by `openclaw_seq` only (AGENTS.md #1).
2. During active run: **no full bootstrap replace** of a longer live timeline.
3. Scroll-to-bottom only on user send + first open (AGENTS.md #3).
4. No Telegram-only branches in UI window/stream path.
5. Bootstrap prune never treats a windowed gateway sample as full truth (Phase 1).

## Phases

### Phase 1 — Data (DONE)
- Skip bootstrap prune when gateway sample is windowed or session is imported
- Skip gateway refill for imported on older-page
- `UI_INITIAL_WINDOW = 160`
- Regression: after continue + windowed history, projection count preserved

### Phase 2 — Live path (DONE)
- 2.1 Guard bootstrap recovery / re-init while run active
- 2.2 Bootstrap apply: merge/preserve when active (never shrink live list)
- 2.3 Send ACK: patch one optimistic row, not full rewrite where possible
- 2.4 Reconcile: keep windowed coverage; never drop longer live for shorter history
- 2.5 Scroll: force bottom only on user send (already policy); stream follows only if at bottom

### Phase 3 — Window contract tests + parity (DONE)
- Documented contract in `chat-engine-v2/constants.ts`:
  - `UI_INITIAL_WINDOW = 160` (open/bootstrap/warm first paint)
  - `UI_OLDER_PAGE = 100` (older/newer fetches)
  - `UI_STORE_WINDOW = 200` (scroll buffer headroom only)
- Aligned `CHAT_BOOTSTRAP_MESSAGE_LIMIT`, `CHAT_OLDER_PAGE_LIMIT`, `WARM_CHAT_MAX_MESSAGES` to those constants
- Middleware: exact 160→100→100→100→remainder sequence; short session full; imported/normal parity
- UI unit tests for constant matrix

### Phase 4 — Feature matrix no-regression (DONE)
Automated matrix mapping user problems → tests:

| User problem | Automated proof |
|--------------|-----------------|
| History wipe after send (imported) | middleware Phase 4 continue e2e + prune-skip |
| Older page broken after continue | middleware 160→100… sequence + continue e2e |
| Blink / remount mid-run | `shouldApplyBootstrapRecoveryReload` + ChatView recovery guard |
| Shrink replace mid-stream | `shouldPreserveActiveBootstrapTimeline` + merge e2e simulation |
| Order / optimistic confirm | mergeOptimistic + dedupe order tests |
| Warm paint ≠ bootstrap flash | WARM_CHAT_MAX_MESSAGES === 160 |
| Normal prune still works | Phase 4 still-prunes + existing stale prune test |
| Tools/stream reconcile safety | preserve tool_running; idle after answer allowed |

Test files:
- `packages/ui/lib/__tests__/telegramReliability.phase4.matrix.test.ts` (14)
- middleware `app.test.ts` Phase 3/4 cases + existing prune
- related suites: reconcile, bootstrapRecoveryGuard, applyPatches, timelineStoreIntegration, send, bootstrap-dedupe

### Phase 5 — Live E2E with connected gateway

## Non-goals
- Rewrite ChatView / new virtualization library
- Truncate gateway transcript
- Load full 20k into React
- Big-bang refactor of `useChatMessages`

## Exit checklist (Phase 2)
- [x] Active-run bootstrap recovery does not invalidate / remount stream
- [x] Active-run bootstrap apply does not replace longer local timeline
- [x] Send ACK does not thrash full list identity unnecessarily
- [x] Unit tests for pure merge/preserve helpers
- [x] Existing reconcile + recovery guard tests still pass

## Phase 2 implementation notes
- `shouldPreserveActiveBootstrapTimeline` / `mergeActiveBootstrapTimeline` / `shouldApplyBootstrapRecoveryReload` in `useChatMessages.ts`
- Recovery handler skips engine remount while thinking/streaming/tool_running + has user message
- Bootstrap seed merges when preserve-active; keeps `windowed` coverage
- Send ACK uses functional `setMessages` row patch
- Tests: `lib/__tests__/useChatMessages.reconcile.test.ts` (Phase 2 cases)

## Phase 3 implementation notes
- `packages/ui/lib/chat-engine-v2/constants.ts` — single documented open/page/store sizes
- Warm cache max messages = 160 (matches bootstrap first paint)
- Middleware tests in `app.test.ts` describe `imported session 160-message window contract`
- Store/slice may still use 200 internally; that is buffer, not open paint

## Phase 4 verification results (2026-07-10)

### Passed (our changes)
- UI reliability suite: **191/191** (phase4 matrix, reconcile, recovery guard, windows, warm cache, applyPatches, timeline integration)
- Middleware reliability filter: **13/13** window/prune/continue e2e cases
- Middleware send + bootstrap-dedupe + tool-inference related: **41/41**

### Pre-existing failures (NOT introduced by this work)
- `store.test.ts` 5 tool-lifecycle expectations (`pendingTools` empty vs expected) — store.ts not modified in this loop; failures are on branch baseline tool-completion policy

### Residual risk (honest)
- Full live stream/blink on real Telegram import still needs Phase 5 with gateway `connected:true`
- Force scroll-on-send remains by design (user intent), not a bug
- DOM paint timing cannot be fully proven in unit tests

## Problem → fixed? (honest)

| Problem | Fixed in code? | Proven by tests? |
|---------|----------------|------------------|
| Imported load/fetch after send wiped | Yes (Phase 1 prune) | Yes middleware |
| Older scroll after continue empty | Yes | Yes middleware |
| Blink from recovery remount mid-run | Yes (Phase 2) | Yes unit matrix |
| Bootstrap shrink mid-run | Yes (Phase 2) | Yes unit matrix |
| Order flip mid-stream (all cases) | Partially | Partial (optimistic/confirm) |
| Scroll jump on user send | By design | N/A |
| Tools/media/subagent live | Unchanged intentionally | No live gateway |

### Non-regression
- Normal short-session prune still deletes stale rows (Phase 4 safety test)
- Normal open window shape matches imported for same size projection
