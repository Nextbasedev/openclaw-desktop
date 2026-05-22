# Chat Timeline Implementation Readiness Checklist

## Status

Planning hardening pass only. No implementation should begin until this checklist is accepted.

This document consolidates duplicate audit findings from:

- `docs/chat-timeline-edge-case-matrix-plan.md`
- `docs/full-history-disk-windowed-chat-plan.md`
- `docs/chat-timeline-architecture-audit.md`
- `docs/constraints/chat-engine.md`
- `docs/constraints/middleware.md`
- `docs/constraints/ui-scroll.md`
- `docs/constraints/sessions.md`
- `docs/constraints/gateway.md`
- `docs/lessons/2026-05-22-*.md`

## Severity Model

### P0 — Correctness / Data Ownership

These can show the wrong chat, lose/clear active run state, resurrect stale state, or corrupt visible timeline ownership. P0s must have automated or instrumented stress coverage before ship.

### P1 — Reliability / Request Storm / API Contract

These cause latency, Gateway/middleware timeouts, stale metadata, or make P0s likely. P1s should be fixed before large render/windowing work.

### P2 — Performance / UX Hardening

These are important for large histories and polish, but should come after ownership, lifecycle, and API contracts are stable.

## Required Instrumentation Slice

This is the first implementation slice. It is intentionally small and should not change behavior except logging/guards where safe.

### Required Events

- `chat.apply-decision`
- `chat-view.invariant`
- `chat.request.stale-skip`
- `chat.side-metadata.skip`
- `chat.stream.recovery-decision`
- `chat.timeline.window-change`

### Required Fields

```ts
type ChatApplyDecisionLog = {
  event: string
  windowId: string | null
  instanceId: string | null
  viewGeneration: number | null
  source:
    | "bootstrap"
    | "messages"
    | "patch"
    | "send"
    | "reconcile"
    | "side-metadata"
    | "route"
    | "scroll"
  targetSessionKey: string | null
  activeSessionKey: string | null
  renderedSessionKey: string | null
  cursor: number | null
  requestId?: string
  requestGeneration?: number
  willApply: boolean
  reason: string
}
```

### Release-Blocking Invariant

```json
{
  "event": "chat-view.invariant",
  "windowId": "main",
  "viewGeneration": 42,
  "sidebarSessionKey": "agent:main:desktop:...",
  "activeSessionKey": "agent:main:desktop:...",
  "renderedSessionKey": "agent:main:desktop:...",
  "messageListSessionKey": "agent:main:desktop:...",
  "ok": true
}
```

Any `ok:false` during stress testing is a release blocker.

## Canonical Edge Case Checklist

### P0-UI-01 — Sidebar selected chat / body session mismatch

- Consolidates: UI-04, multi-window mismatch, stale bootstrap apply, split-pane desync.
- Evidence: user observed sidebar selected new chat while body showed previous chat; logs prove stale session seeds and active-session changes can overlap, but current logs lack a direct invariant to prove visual mismatch.
- Current risk: active route/sidebar state and rendered `ChatView` state are not verified atomically.
- Required invariant: `sidebarSessionKey === activeSessionKey === renderedSessionKey === messageListSessionKey` per `windowId` and `viewGeneration`.
- Forbidden: previous chat messages visible under new selected chat.
- Acceptance tests:
  - UI/integration: switch heavy chats, create new chat, refocus previous window; assert selected/body session match.
  - Split-pane test: click inactive pane tab B; body/session must equal B, not previous pane session.
- Instrumentation: `chat-view.invariant`, `chat.apply-decision` on route/tab/body apply.
- Phase: Slice 1 + Slice 9.

### P0-GEN-01 — Stale async result applies after session/window/generation changed

- Consolidates: stale bootstrap, stale pagination, stale side metadata, duplicate same-session bootstraps, stale branch-list followups.
- Current risk: unmount cancellation exists in some places, but not a shared request-generation/window/session guard.
- Required invariant: every async result checks `{ windowId, viewGeneration, sessionKey, requestGeneration }` before mutating UI/global visible state or starting follow-up work.
- Forbidden:
  - old bootstrap overwrites newer cursor/status/messages;
  - stale bootstrap starts `middleware_branch_list`;
  - old pagination prepends after route switch.
- Acceptance tests:
  - fake two same-session bootstraps resolving out of order; stale logs `willApply:false`.
  - start pagination, switch session, resolve old request; no local/global seed.
  - stale bootstrap completion must not start side metadata.
- Instrumentation: `chat.apply-decision`, `chat.request.stale-skip`, `chat.side-metadata.skip`.
- Phase: Slice 1 + Slice 2.

### P0-SR-01 — Mis-scoped/global bootstrap recovery reload

- Consolidates: global recovery event, archive refresh, stream replay recovery.
- Evidence: logs show `chat.bootstrap` patch for session B triggers `chat.bootstrap-recovery.reload` for active session A.
- Current risk: `openclaw:chat-bootstrap-recovery` has no session/reason detail, causing all mounted hooks to reload.
- Required invariant: recovery events include `{ sessionKey, reason, cursor, projectionGeneration }`; hooks ignore nonmatching sessions except true global DB reset.
- Forbidden: session B archive/import/replay event reloads session A.
- Acceptance tests:
  - two mounted hooks; dispatch recovery for A; B does not refetch.
  - stream recovery for inactive chat does not remount active chat.
- Instrumentation: `chat.stream.recovery-decision` with `willApply` and reason.
- Phase: Slice 3.

### P0-SR-02 — Recovery mode still applies replay patches

- Consolidates: `afterCursor:0` replay flood, replay-overflow recovery, metadata-only bootstrap patch pollution.
- Current risk: server can say recovery/bootstrap, but replay patch frames still apply normally.
- Required invariant: when stream is in recovery mode, replay frames are dropped/quarantined until real bootstrap establishes cursor authority.
- Forbidden: replayed `chat.bootstrap`/tool patches mutate visible active timeline before bootstrap authority.
- Acceptance tests:
  - fake WS hello `{ recovery:"bootstrap", replayWindowExceeded:true }` then patch; `handlePatch` does not mutate state.
  - afterCursor=0 stress: visible messages only from bootstrap/warm authoritative source.
- Instrumentation: `chat.stream.recovery-decision`, `recoveryReplayDropped`.
- Phase: Slice 3.

### P0-SL-01 — Quick-send/new-chat empty bootstrap clears thinking

- Consolidates: quick-send race, accepted ACK vs canonical history lag.
- Evidence: logs show new chat briefly thinking, then bootstrap with `rawMessageCount:0`/`runStatus:"idle"` clears it; answer appears later.
- Required invariant: a just-sent/new chat cannot become authoritatively empty/idle while an optimistic send is pending.
- Forbidden: empty idle bootstrap clears local pending send or hides optimistic user.
- Acceptance tests:
  - quick-send → delayed gateway history → bootstrap empty first; optimistic user remains visible and status active.
  - empty bootstrap logs `willApply:false` for status downgrade when pending send exists.
- Instrumentation: include `clientMessageId`, `pendingLocalSend`, `bootstrapMessageCount`, `runStatus`.
- Phase: Slice 4.

### P0-SL-02 — Thinking stuck after ACK/final gap

- Consolidates: heavy chat Thinking forever, stale history after send, missing terminal signal.
- Evidence: heavy chat send ACK returns, reconcile sees backend idle/freshMessageCount 0 and preserves thinking repeatedly.
- Required invariant: every accepted run reaches assistant/final/error/abort or an explicit bounded recovery/error state.
- Forbidden: silent infinite `thinking` preservation.
- Acceptance tests:
  - gateway `chat.send` done + stale `chat.history` + no stream; UI exits active with explicit recovery/error within bounded time.
  - reconcile logs active preservation count/age and transitions to recovery after threshold.
- Instrumentation: `send.end completed:false`, `activeRunAgeMs`, `terminalEvidence`.
- Phase: Slice 4.

### P0-SL-03 — Stop/abort resurrected by stale patches

- Current risk: local stop sets idle, but delayed run/tool/status patches can reintroduce active state.
- Required invariant: abort is terminal for a run generation; stale active patches from the aborted generation are ignored.
- Forbidden: aborted run returns to Thinking or pending tools.
- Acceptance tests:
  - abort while tool running + delayed tool/start patches; status remains stopped/idle and tools marked terminal once.
- Instrumentation: run generation, abort terminal marker, stale active patch skip reason.
- Phase: Slice 4.

### P0-SL-04 — Optimistic user echo confirms wrong bubble

- Current risk: text/seq fallback can mis-confirm identical rapid sends, retries, quote-stripped messages, or attachment-marker variations.
- Required invariant: confirmation primarily uses `clientMessageId`/idempotency key; text match fallback is bounded by turn/session.
- Forbidden: same confirmation resolves two optimistic messages or wrong one.
- Acceptance tests:
  - send two identical messages rapidly; each confirms once.
  - retry after failure; delayed old confirmation does not attach to new attempt.
- Instrumentation: confirmation source (`clientMessageId` vs fallback), optimistic id, gateway message id.
- Phase: Slice 4.

### P0-BP-01 — Latest/bootstrap window is marked full history

- Consolidates: wrong `historyCoverage`, UI cannot represent `windowed`, UI force-upgrades to full, ambiguous messageCount.
- Current risk: middleware and UI treat latest bounded window as full history.
- Required invariant: `full` only when returned window spans known min/max; otherwise `windowed` with `hasOlder`/`hasNewer`.
- Forbidden: `historyCoverage:"full"` with `hasOlder:true` or known total > returned window.
- Acceptance tests:
  - middleware: 200 rows + limit 160 returns `windowed`, `hasOlder:true`, `knownTotalMessages:200`.
  - UI: `windowed` round-trips through client → global store → warm cache.
- Instrumentation: `historyCoverage`, `returnedMessageCount`, `knownTotalMessages`, `hasOlder`.
- Phase: Slice 3.

### P0-BP-02 — Pagination mutates global full state / applies with stale seq generation

- Consolidates: global pagination seed, archive resequence race, old `beforeSeq` cursor after projection generation changed.
- Required invariant: pagination pages carry and check `projectionGeneration`; page metadata drives coverage; stale pages are discarded.
- Forbidden:
  - old page applies after archive resequence;
  - pagination preserves bad `full` coverage;
  - older page from session A applies to session B.
- Acceptance tests:
  - seed bad full, load page with `hasOlder:true`; state downgrades to `windowed`.
  - start page request, emit archive recovery/resequence, resolve old page; ignored.
- Instrumentation: `projectionGeneration`, `beforeSeq`, `loadedOldestSeq`, `hasOlder`, `willApply`.
- Phase: Slice 3 + Slice 7.

### P0-RS-01 — Bootstrap request storm starves active chat and Gateway

- Consolidates: non-abortable bootstrap, weak dedupe, retry loop, middleware no coalescing.
- Evidence: logs show old bootstraps completing 120s+ later, some Gateway `chat.history` timeouts.
- Required invariant: inactive/stale bootstrap requests are abortable/coalesced and cannot consume active first-paint budget.
- Forbidden: multiple same-session bootstrap applies for same generation; stale request starts follow-up work.
- Acceptance tests:
  - rapid switch 20 chats; at most one in-flight bootstrap per session/window generation; stale logs skipped/aborted.
  - backend parallel same-session bootstrap coalesces to one Gateway `chat.history`.
- Instrumentation: request id, generation, abort/coalesce reason.
- Phase: Slice 2.

### P1-RS-02 — Side metadata competes with active chat first paint

- Consolidates: branch/pins/models/voice/activity request storm, focus bootstrap refresh, stale side metadata apply.
- Required invariant: side metadata is TTL cached/deduped, low-priority, and guarded by session/window generation before applying.
- Forbidden:
  - branch/pins/models/voice blocks active chat render;
  - stale bootstrap triggers side fetch after session changed;
  - focus `/api/bootstrap` competes with active chat first paint.
- Acceptance tests:
  - rapid remount same session; one `middleware_branch_list` per TTL.
  - delayed pins response for A after switch to B does not mutate B.
  - focus during slow chat bootstrap does not add high-priority startup refresh.
- Instrumentation: `chat.side-metadata.skip`, side request TTL hit/miss, priority.
- Phase: Slice 6.

### P1-SR-03 — Cursor boundary validation incomplete

- Consolidates: persisted cursor too high, negative WS cursor, HTTP backlog inconsistent.
- Required invariant: stream hello reports latest/oldest cursor; unsafe/negative cursors normalize or recover; catch-up/recovery mode is explicit.
- Forbidden: cursor above DB max returns empty replay and no recovery; negative cursor replays all.
- Acceptance tests:
  - local cursor > latest: recovery and cursor reset.
  - WS `afterCursor=-1`: normalized safe path.
- Instrumentation: requested cursor, normalized cursor, latestCursor, recovery reason.
- Phase: Slice 3.

### P1-SL-05 — Model switch/send race

- Current risk: selected model may not be bound to actual gateway run if session patch lags/fails.
- Required invariant: send uses intended model by confirmed session patch or explicit gateway send payload.
- Acceptance test: select model then immediately send; gateway receives selected model or composer blocks until patch confirmed.
- Phase: Slice 4 or separate model-sending slice.

### P1-SL-06 — Tool lifecycle order/staleness

- Consolidates: result before assistant, terminal done without message, replay old running tool, stale detached tools.
- Required invariant: tool ownership is `(runId, toolCallId)`; terminal run closes stale tools; old cursor cannot resurrect live activity.
- Acceptance tests:
  - result-before-message ordering;
  - replay old running tool for terminal chat;
  - done before final / final before done permutations.
- Phase: Slice 4.

### P1-UI-02 — Split-pane tab/body/focus ownership

- Consolidates: inactive pane tab click desync, sidebar highlights only focused chat, inactive pane auto-scroll.
- Required invariant: split pane focus/tab selection resolves atomically from `(groupId, tabId)`; sidebar highlight means focused pane; inactive pane does not force-scroll.
- Acceptance tests:
  - two panes with tabs A/B; click B in inactive pane; body/session equals B.
  - focus each pane; sidebar active follows focused pane.
  - scroll inactive pane up, live patch arrives; scrollTop unchanged.
- Phase: Slice 9.

### P2-UI-03 — DOM/RAM grows unbounded with history

- Consolidates: no virtualization, pagination prepends forever, full tool results in state, full markdown/code parsing.
- Required invariant: UI active timeline and DOM are bounded; heavy content is preview/lazy expansion.
- Acceptance tests:
  - 5k message fixture + tool cards; DOM/heap under budget after repeated scroll-up.
  - 1MB fenced code block renders preview first, no syntax highlighter until expanded.
  - 1000 tool results x 100KB: warm/global cache stays bounded.
- Phase: Slice 8.

### P2-UI-04 — Scroll anchor uses height delta only

- Current risk: images/code/tool expansion change row heights after RAF and drift viewport.
- Required invariant: load-older preserves first visible message id/seq + offset after layout settles.
- Acceptance test: prepend page with delayed image/code; same anchor remains at same viewport offset after settle.
- Phase: Slice 8 or 9.

## Implementation Slices

### Slice 1 — Instrumentation and Apply Guards Foundation

Goal: make stale/mis-scoped applies observable and block obvious no-op stale writes where safe.

Files likely involved:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/AppPage.tsx`

Required before completion:

- `chat.apply-decision` helper exists.
- `chat-view.invariant` logs active/rendered/message-list session keys.
- Basic view generation exists for ChatView/hook lifecycle.
- No behavioral architecture rewrite yet.

Validation:

- Typecheck UI.
- Unit/log tests for helper if practical.
- Manual stress logs show enough fields to diagnose mismatch.

### Slice 2 — Request Scheduler / Stale Bootstrap Guard

Goal: stop request storms before deeper state work.

Required:

- Abort/coalesce UI bootstrap by session/generation.
- Prevent stale bootstrap from applying or starting side metadata.
- Add backend coalescing for same-session bootstrap if feasible.

Validation:

- Rapid-switch stress: stale requests log skipped/aborted.
- Duplicate same-session bootstrap test.

### Slice 3 — History Window API + Stream Recovery Authority

Goal: make bootstrap/pagination/stream contracts truthful.

Required:

- Middleware returns window metadata for bootstrap/messages.
- UI supports `windowed` coverage.
- Recovery events session-scoped.
- Recovery-mode replay frames cannot mutate visible state.
- Cursor bounds validated.

Validation:

- Middleware route tests.
- UI store/client tests for `windowed` and recovery skip.

### Slice 4 — Send / Run Lifecycle Guards

Goal: fix quick-send thinking, stuck thinking, echo confirmation, terminal run handling.

Required:

- Pending local send guard.
- Terminal evidence model.
- Bounded recovery for missing final.
- Stronger idempotency/confirmation handling.
- Abort terminal generation guard.

Validation:

- Quick-send empty bootstrap race test.
- Stuck thinking recovery test.
- identical rapid sends test.
- abort stale patch test.

### Slice 5 — Side Metadata Isolation

Goal: side metadata no longer competes with active timeline.

Required:

- Branch/pins/models/voice dedupe/TTL or central stores.
- Low-priority focus/startup refresh.
- Stale apply guards.

Validation:

- side metadata TTL tests.
- delayed pins response after switch does not apply.

### Slice 6 — Windowed Timeline State

Goal: stop treating full history as active React state.

Required:

- bounded active timeline window.
- page eviction strategy.
- `hasOlder/hasNewer` from API metadata.
- archive projection generation invalidates cursors.

Validation:

- scroll older under run active.
- archive resequence while paginating.

### Slice 7 — Virtualization / Heavy Content Lazy Loading

Goal: bound DOM/RAM and prevent heavy parsing by default.

Required:

- virtualized message list or equivalent windowed DOM.
- collapsed/lazy tool outputs.
- markdown/code preview thresholds.

Validation:

- DOM/heap budget stress.
- heavy code/tool output tests.

### Slice 8 — Multi-Window / Split-Pane Hardening

Goal: eliminate UI-only ownership bugs.

Required:

- atomic split tab selection.
- sidebar focused-pane invariant.
- inactive pane scroll ownership.
- per-window generation enforcement.

Validation:

- split-pane selection/focus tests.
- two-window refocus selected/body mismatch stress.

## Pre-Implementation Exit Criteria

Implementation should start only after:

- This checklist is accepted.
- P0 rows are agreed and not missing obvious scenarios.
- Build slices are accepted in this order or intentionally reordered.
- First slice scope is chosen.

## Ship Gate

Before shipping the eventual fix:

- No `chat-view.invariant ok:false` under stress.
- No stale async result applies without matching session/window/generation.
- No `historyCoverage:"full"` when `hasOlder:true`.
- Recovery-mode replay patches do not mutate visible timeline.
- New chat quick-send preserves thinking until terminal evidence.
- Heavy chat cannot silently think forever.
- Side metadata is not on active chat first-paint critical path.
- Split-pane inactive panes do not steal scroll.
- DOM/RAM stay bounded on heavy imported histories.

## Slice 1 Implementation Notes

Started on branch `fix/chat-timeline-slice1-instrumentation`.

Initial scope:

- Add reusable chat timeline diagnostics helpers.
- Log `chat.apply-decision` for bootstrap and older-page pagination apply decisions.
- Log `chat.request.stale-skip` when bootstrap, branch metadata, pagination, or global-session subscription callbacks become stale by generation/cancellation.
- Add `chat-view.invariant` logs for rendered session/message-list ownership.
- Add `windowId`, `instanceId`, and `viewGeneration` to chat mount/render/bootstrap logs.
- Scope archive-import recovery events with `sessionKey` where available; hooks ignore non-matching scoped recovery events.
- Preserve global stream recovery as global when no sessionKey is known.

Validation completed for initial slice:

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- `git diff --check`
