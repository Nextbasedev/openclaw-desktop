# OCPlatform Desktop — Chat System Refactor SPEC (the contract)

Status: AGREED 2026-06-26 (Krish). This document is the source of truth for the
chat refactor. Audit (current state) = `CHAT_REFACTOR_AUDIT.md`. Target patterns =
`CHAT_ARCHITECTURE_BEST_PRACTICES.md`.

---

## 1. Scope
Refactor **both** frontend (`packages/ui`) **and** middleware (`apps/middleware`),
stage by stage. Not UI-only.

Targets:
- Eliminate race conditions and synchronization bugs (FE↔BE and BE↔FE).
- Simplify complex/duplicated logic; one clear path per concern.
- Fix chunk/stream management (ordering, dedupe, append-only).
- **Middleware performance**: it is currently slow to call the gateway API, fetch,
  and render. Reduce time-to-first-token and bootstrap latency; stop redundant
  fetches; stream incrementally instead of buffering.
- Reliability under reconnect, backend restart, session switching, virtualization.

## 2. Wire protocol contract (the key decision — backend IS in scope)
Every streamed patch frame and message carries:
- `seq` — monotonic per-session sequence number. FE applies in order; ignores
  `seq <= lastAppliedSeq` (idempotent, drops duplicates/replays).
- `epoch` — generation id that changes on backend projection reset/restart. On a
  new epoch the FE discards stale local state for that session and resyncs from
  the bootstrap. Cache is epoch-keyed.
- `clientMsgId` — client-generated id attached on send; echoed back by the
  backend so the FE reconciles its optimistic message with the server copy
  (no duplicate bubbles).
- `messageId` — server-assigned stable id. **This is the React key. Never index,
  never array position.**

Resume on reconnect: FE reconnects with `(epoch, lastSeq)`; backend replays only
frames after `lastSeq` within the same epoch, or signals epoch change → full resync.

## 3. State / ownership invariants (FE)
- **Single source of truth**: the `chat-engine-v2` store. Exposed via
  `useSyncExternalStore`. No deriving render-state inside components.
- **Single writer**: `applyChatPatch` runs in **exactly one place** (the store).
  `ChatView` and `runWatcher` become read-only subscribers. (Today: 3 writers.)
- **One WebSocket per session**, owned/ref-counted by the store. (Today: 3.)
- **One ordering+identity rule**, asserted in the reducer (`orderChatMessages` +
  dedupe live in the store; component-level defensive dedupe becomes a dev assert).
- **Per-session isolation**: messages, streaming state, scroll position, cache,
  WS lifecycle, loading/generating state, thinking/tool-call state are all keyed
  by session and never leak across sessions.

## 4. Behavior spec
### 4.1 Typewriter animation
- ON only for **live** streaming deltas. Text appears progressively as generated.
- OFF on history restore and session switch — completed messages render instantly,
  no replay.
- Each assistant response animates **exactly once**, smoothly to completion.
- Stream updates **append only**; previously rendered text is never re-animated or reset.
- Must survive: React re-renders, cache updates, WS reconnects, session switching,
  history restore, virtualization updates.
- BUG TO KILL: same response re-animated 5–6× due to state reset/replay.
- Mechanism: DOM-owned text via rAF, decoupled from React reconciliation;
  store guarantees monotonic prefix (new text only extends, never rewrites).

### 4.2 Infinite scrolling (both directions)
- Up = load older without viewport shift / jump.
- Down = load newer (if any) smoothly.
- May adopt **react-virtuoso** (`firstItemIndex` for jump-free prepend) if simpler
  and more reliable than the hand-rolled window. One virtualizer only.
- Loading more must never cause flicker/blink/reorder/duplicate-render/scroll-jump.

### 4.3 Multi-session
- Sessions fully independent (see §3 per-session isolation list).
- Switching is seamless: no message loss, no dupes, no restarted streaming, no
  reorder, no wrong scroll position, no cache corruption, no state leakage.
- Returning to an active (generating) session shows the live generating indicator
  and the in-progress response correctly.

## 5. Acceptance criteria ("production-ready")
- Zero dupe / flicker / blink / jump / reorder under normal use.
- Survives WS reconnect and backend restart with no manual refresh (epoch resync).
- Typewriter animates once per response; never restarts.
- Session switch preserves all per-session state correctly.
- No console errors/warnings on the touched paths.
- Smooth streaming + scrolling at 100+ message history.
- Measurable middleware improvement: lower time-to-first-token and bootstrap time
  vs baseline (capture before/after numbers).
- Each stage: typecheck clean; characterization + property tests green; no NEW
  lint errors; PR-style review pass before merge.

## 6. Non-goals / anti-over-engineering (explicitly rejected)
CRDTs (Yjs/Automerge), custom binary protocols, Redux+Saga/Observable stacks,
Web Workers for the reducer, GraphQL subscriptions, per-session multiple WS,
index keys, per-token setState, speculative pre-render. One server of truth +
sequence numbers is sufficient.

## 7. Verification
- Characterization tests: record real patch-frame logs, replay, lock current good
  behavior BEFORE each refactor stage.
- Property tests on the reducer: any permutation/duplication/drop of patches →
  same final state (idempotent + order-independent for the final snapshot).
- Deterministic virtual clock + fake WS transport for streaming/reconnect tests.
- Live browser proof (Playwright/webwright) **iff** a trustworthy runnable dev env
  is available on the host; otherwise tests + typecheck + code reasoning, stated
  honestly. (Host has 3.7GB RAM/no swap — full build OOMs; `next dev` may run.)

## 8. Branch / merge
- Work on `chat-refactor` off `master`. Each stage = one verified commit.
- Krish merges to `master` after review. No direct master commits.

## 9. Staged plan
- **Stage 0 (DONE, db48a782):** delete ~16k LOC dead code; lock audit + research docs.
- **Stage 1:** characterization + property tests around current store/stream
  behavior (safety net) — no behavior change.
- **Stage 2:** single-writer — collapse `applyChatPatch` to the store only;
  `ChatView`/`runWatcher` become subscribers.
- **Stage 3:** one WebSocket per session via the store's ref-counted stream.
- **Stage 4:** wire protocol — add `seq`/`epoch`/`clientMsgId` in middleware +
  idempotent ordered reducer + resume-from-cursor on FE.
- **Stage 5:** streaming text — DOM-owned rAF reveal + monotonic prefix invariant;
  kill the 5–6× re-animation.
- **Stage 6:** virtualization — consolidate to one window (react-virtuoso eval) with
  jump-free prepend; per-session scroll isolation.
- **Stage 7:** middleware performance — reduce bootstrap/fetch latency, incremental
  stream, drop redundant calls; measure before/after.
- **Stage 8:** multi-session isolation hardening + final end-to-end verification.

(Stages 2–7 each: char tests first → change → typecheck → tests → review → commit.)
