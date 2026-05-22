# Chat Timeline Edge Case Matrix Plan

## Purpose

This is an audit-only planning document for the chat timeline rewrite. Do not implement fixes from this document until explicitly moving to `feature-build`.

The goal is to make hidden chat timeline edge cases visible, testable, and reviewable before changing architecture. The recent production logs show that many failures are not single bugs; they are race conditions between bootstrap, pagination, patch replay, optimistic send state, route/window state, and side metadata requests.

## Core Principle

Chat UI correctness must be guarded by explicit ownership and invariants:

- Gateway/OpenClaw remains canonical raw history.
- Middleware owns durable local projection and history-window APIs.
- UI owns only a bounded active timeline window.
- Patch stream owns live deltas only after a valid cursor.
- Optimistic send owns local pending run state until terminal evidence arrives.
- Side metadata must never block active chat first paint.
- Every async result must prove it still belongs to the active window/session/generation before applying.

## State Writers To Audit

Every row in the matrix must map to at least one writer:

- `/api/chat/bootstrap`
- `/api/chat/messages`
- `/api/stream/ws`
- `/api/patches`
- optimistic send / quick-send
- send reconcile / history polling
- run/tool status patches
- archive import refresh / resequence
- `chat.bootstrap-recovery.reload`
- route changes / sidebar selection
- mount / unmount / remount
- split panes / editor groups
- separate Tauri/browser windows
- focus / blur / app resume
- branch / pins / models / voice / activity side metadata
- heavy markdown / tool output rendering

## Required Structured Instrumentation

Before or during implementation, add apply-decision logging around every async state write.

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

Minimum log events:

- `chat.apply-decision`
- `chat-view.invariant`
- `chat.request.stale-skip`
- `chat.side-metadata.skip`
- `chat.stream.recovery-decision`
- `chat.timeline.window-change`

Example invariant log:

```json
{
  "event": "chat-view.invariant",
  "windowId": "main",
  "viewGeneration": 42,
  "sidebarSessionKey": "agent:main:desktop:mpgyvxgp-bfoq98",
  "activeSessionKey": "agent:main:desktop:mpgyvxgp-bfoq98",
  "renderedSessionKey": "agent:main:desktop:mpgyvxgp-bfoq98",
  "messageListSessionKey": "agent:main:desktop:mpgyvxgp-bfoq98",
  "ok": true
}
```

`ok:false` is a release blocker.

## Hard Invariants

### Route / Body Invariant

If a chat is selected in the sidebar or active route, the rendered `ChatView` and visible message list must belong to the same `sessionKey`.

Forbidden:

- sidebar selected new chat while body shows previous chat
- active route says session A while visible messages belong to session B

### Generation Invariant

Only the latest mounted view generation may apply async results.

Forbidden:

- stale bootstrap applies after tab switch
- stale pagination applies after route change
- stale side metadata triggers follow-up fetches

### Window Invariant

A result from one window must not mutate another window's active visible timeline.

Required apply keys:

- `windowId`
- `viewGeneration`
- `sessionKey`
- `instanceId`

### Send Lifecycle Invariant

A local pending send owns `thinking` until terminal evidence arrives.

Allowed terminal evidence:

- assistant response arrives
- explicit final/error status arrives
- confirmed user echo + terminal run state arrives
- timeout/recovery path explicitly marks failed/recovered

Forbidden:

- empty idle bootstrap clears new-chat `thinking`
- reconcile clears active run based only on empty/partial history
- accepted ACK is treated as final answer completion

### History Window Invariant

A latest window of messages is not full history when older rows exist.

Forbidden:

- `historyCoverage:"full"` for a bounded/latest window with `hasOlder:true`
- pagination writes pretending to be canonical full state

### Stream Invariant

Patch stream applies live deltas only after valid cursor/session lifecycle.

Forbidden:

- `afterCursor:0` replay mutates visible active chat directly
- bootstrap/import patch for session B reloads session A
- recovery mode still applies replay patches before bootstrap authority

### Side Metadata Invariant

Side metadata is non-blocking and lower priority than active chat render/send.

Forbidden:

- branch/pins/models/voice fetch delays chat first paint
- stale bootstrap completion starts side fetches after session changed
- duplicate side fetches for same session/window within TTL

### Render Invariant

DOM/RAM must be bounded independently of full disk history.

Forbidden:

- visible React message array grows unbounded with scroll history
- full heavy tool outputs mount by default
- huge markdown/code blocks parse/highlight before expansion

## Edge Case Matrix

### Bootstrap / Pagination / History Window

#### BP-01 — Incorrect `historyCoverage` on limited bootstrap

- Refs: `apps/middleware/src/features/chat/routes.ts`, `apps/middleware/src/features/chat/projection.ts`
- Current: bootstrap reads latest limited messages, but snapshot marks `historyCoverage:"full"` and `fullMessagesIncluded:true`.
- Failure: latest 160 of 2k rows is treated as complete; load-more/window logic becomes wrong.
- Required: `full` only when returned window spans persisted min/max seq; otherwise `windowed` with `hasOlder`/`hasNewer`.
- Test: 200 stored rows + `limit=160`; assert `knownTotalMessages=200`, `hasOlder:true`, `historyCoverage:"windowed"`.

#### BP-02 — Pagination lacks window metadata

- Refs: `/api/chat/messages`, `repo.messages.ts`, UI client types.
- Current: response only has rows + `messageCount`.
- Failure: UI guesses `hasOlder` from page length; gaps/filters/merged messages can hide older history.
- Required: return `loadedOldestSeq`, `loadedNewestSeq`, `hasOlder`, `hasNewer`, `knownTotalMessages`, `returnedMessageCount`.
- Test: first/middle/last/empty page route tests.

#### BP-03 — UI cannot represent `windowed`

- Refs: `packages/ui/lib/chat-engine-v2/types.ts`, `useChatMessages.ts`, `warmChatCache.ts`.
- Current: `HistoryCoverageV2 = "none" | "metadata" | "full"`.
- Failure: backend cannot safely return `windowed`; UI will collapse partial history into metadata/full.
- Required: add `windowed` and preserve it through fetch → global seed → warm cache.
- Test: `windowed + hasOlder:true` round-trip.

#### BP-04 — UI force-upgrades bootstrap to full

- Refs: `useChatMessages.ts` bootstrap seed/persist.
- Current: fresh bootstrap seeds/persists `historyCoverage:"full"` and `fullMessagesIncluded:true`.
- Failure: even corrected middleware metadata is overwritten by UI.
- Required: seed exact server metadata; never upgrade client-side.
- Test: bootstrap returns 160 of 500; global and warm cache remain `windowed`.

#### BP-05 — Pagination mutates global state and preserves bad full coverage

- Refs: `useChatMessages.ts` load older, chat-engine store seed.
- Current: older page prepend calls global seed; existing bad `full` can remain.
- Failure: after page load, global still says full while older rows exist.
- Required: pagination coverage comes from API metadata; downgrade invalid full.
- Test: seed bad `full`, load page with `hasOlder:true`; assert state becomes `windowed`.

#### BP-06 — Duplicate same-session bootstraps apply out of order

- Refs: `useChatMessages.ts` bootstrap effect.
- Current: unmount cancellation exists, but no per-session request generation for duplicate same-session bootstraps.
- Failure: older slow bootstrap overwrites newer cursor/status/window.
- Required: per-session request generation; only newest response applies.
- Test: two bootstraps resolve out of order; stale response logs `willApply:false`.

#### BP-07 — Archive import resequence invalidates old seq cursors

- Refs: archive import/resequence routes, message repo.
- Current: archive import can resequence messages while UI holds `beforeSeq` cursors.
- Failure: pagination with old seq returns duplicates/gaps/stuck history.
- Required: projection generation/resequence id invalidates active page cursors; matching session refetches bootstrap.
- Test: load bootstrap, resequence, resolve old pagination; assert ignored.

#### BP-08 — `messageCount` semantics are ambiguous

- Current: bootstrap count, page count, and “authoritative” count are mixed.
- Failure: UI infers older/full state incorrectly.
- Required: separate `returnedMessageCount` from `knownTotalMessages`.
- Test: contract tests on bootstrap and page responses.

### Stream / Recovery / Patch Replay

#### SR-01 — Recovery mode still applies replay patches

- Refs: `apps/middleware/src/features/patches.ts`, `chat-engine-v2/client.ts`, store patch apply.
- Current: server can send recovery hello but still send replay patch frames; client recovery triggers but later patch frames apply normally.
- Failure: `afterCursor:0` replay mutates visible state while bootstrap recovery is underway.
- Required: recovery-mode replay frames are quarantined/dropped until bootstrap owns cursor.
- Test: fake hello `recovery:"bootstrap"` followed by patch; assert no state mutation.

#### SR-02 — HTTP backlog branch is inconsistent/dead

- Current: `replayHasMore` branch is effectively shadowed by `replayWindowExceeded` handling.
- Failure: intended catch-up buffering path does not run; replay still flows unbuffered.
- Required: choose one mode explicitly: HTTP catch-up + live buffering OR bootstrap recovery + no replay mutation.
- Test: hello with all flags chooses one explicit path.

#### SR-03 — Persisted cursor above DB max is not detected

- Current: UI can restore cursor higher than middleware latest; stream returns empty replay/no recovery.
- Failure: UI falsely thinks it is caught up after DB reset/truncation.
- Required: hello includes `latestCursor`/`oldestCursor`; if `afterCursor > latestCursor`, force recovery.
- Test: seed cursor `999999`; assert recovery/cursor reset.

#### SR-04 — WS accepts negative cursor

- Current: HTTP `/api/patches` clamps cursor, WS does not.
- Failure: malformed `afterCursor=-1` replays everything.
- Required: normalize/reject WS cursor like HTTP.
- Test: WS connect negative cursor logs normalized `0` and safe path.

#### SR-05 — Recovery event is global and not session-scoped

- Refs: store recovery event, hook listener.
- Current: `openclaw:chat-bootstrap-recovery` has no detail; all mounted hooks reload.
- Failure: archive import/session A reloads active session B.
- Required: event detail `{sessionKey, reason, cursor, projectionGeneration}`; hooks ignore nonmatching sessions.
- Test: two mounted hooks; recovery for A does not invalidate B.

#### SR-06 — Archive refresh patch lacks min/max/generation metadata

- Current: archive refresh patch carries mostly `messageCount`.
- Failure: UI cannot safely invalidate seq cursors/window boundaries.
- Required: include projection generation, known total, min/max seq, reason.
- Test: archive patch updates metadata only and forces matching-session bootstrap.

### Send / Run Lifecycle

#### SL-01 — Quick-send new chat empty bootstrap race

- Current: quick-send creates/navigates; bootstrap may fetch before canonical user/assistant history exists.
- Failure: empty/idle bootstrap clears optimistic thinking; answer appears later.
- Required: just-sent/new chat cannot become authoritatively empty while pending send exists.
- Test: quick-send, delayed gateway history; optimistic user stays visible and status active.

#### SL-02 — Thinking stuck after ACK/final gap

- Current: send ACK is accepted only; done requires history/live confirmation.
- Failure: gateway returns done but history is stale/no assistant; UI stays Thinking indefinitely.
- Required: every accepted run reaches assistant/final/error/abort or bounded recovery state.
- Test: gateway done + stale history + no stream; UI exits active with explicit recovery/error.

#### SL-03 — ACK vs final lifecycle is ambiguous

- Current: UI may clear sending on accepted ACK while run remains active.
- Failure: backend queue later fails while stream is offline; user sees confirmed bubble + eternal thinking.
- Required: separate `accepted`, `confirmed`, `running`, `terminal` states keyed by idempotency.
- Test: accepted response then queue error offline; focus/reconcile marks run failed.

#### SL-04 — User echo confirmation can match wrong optimistic bubble

- Current: confirmation depends on text/seq/optimistic ids.
- Failure: same text rapid sends, quotes, attachment markers, retries confirm wrong bubble.
- Required: primary match by `clientMessageId`/idempotency key; text fallback only within turn boundary.
- Test: two identical sends; each confirms once.

#### SL-05 — Assistant finalization patch order permutations

- Failure cases: done before final, final before tool result, tool-only assistant, delayed tool result after final.
- Required: terminal run-scoped handling closes only that run and tools deterministically.
- Test: patch order permutation suite.

#### SL-06 — Abort/stop can be resurrected by stale patches

- Current: local stop sets idle; delayed active/tool patches may arrive.
- Failure: aborted run returns to Thinking or pending tools.
- Required: abort is terminal generation-specific; stale active patches ignored.
- Test: abort while tool running + delayed tool/start patches; status remains stopped/idle.

#### SL-07 — Retry/regenerate idempotency collision

- Failure: old failed attempt confirmation attaches to new retry; branch preview failure poisons parent status.
- Required: retry attempt id is distinct or explicitly same-send retry; stale confirmations rejected.
- Test: failed send → retry → delayed old confirmation.

#### SL-08 — Model switch during send

- Current risk: UI selected model may not be bound to gateway send if session patch lags/fails.
- Required: either block until session patch confirmed or send explicit intended `modelId` to gateway.
- Test: select model then immediately send; gateway receives selected model.

#### SL-09 — Tool lifecycle stale/duplicate tools

- Failure: result before assistant, terminal done without message, replayed old running tool resurrects activity.
- Required: tool ownership `(runId, toolCallId)`; terminal run closes stale tools; old cursor cannot resurrect live state.
- Test: result-before-message and replay-old-running-tool cases.

### Request Scheduling / Side Metadata

#### RS-01 — Bootstrap requests are not abortable

- Refs: `fetchChatBootstrapV2`, `useChatMessages`.
- Current: cleanup only sets local cancelled; network/Gateway work continues.
- Failure: rapid switching leaves heavy stale bootstraps running for 120s+.
- Required: AbortSignal/timeout/coalescing; stale work stops consuming active budget.
- Test: rapid switch; assert old requests aborted or coalesced.

#### RS-02 — Bootstrap dedupe is weak

- Current: fresh load invalidates dedupe; React Query `staleTime:0` refetches.
- Failure: remount/split/focus duplicates same session bootstrap.
- Required: per-session in-flight/TTL cache independent of component lifecycle.
- Test: two hook instances same session → one request.

#### RS-03 — Bootstrap retry loop can multiply storms

- Required: retry loop cancels on unmount/newer generation and shares backoff.
- Test: transient history + unmount after first attempt; no further attempts.

#### RS-04 — Side metadata fires after every bootstrap

- Branch/pins/models/voice/activity can repeat on mount/bootstrap and starve active chat.
- Required: TTL cache, dedupe, low priority, session/generation apply guards.
- Test: rapid remount same session; one side request per TTL.

#### RS-05 — Focus/visibility startup refresh competes with chat

- Current: focus/online/visible triggers `/api/bootstrap` while active chat bootstrap may run.
- Required: startup refresh idle/low-priority during active chat first-paint.
- Test: focus event during slow chat bootstrap; active latency unaffected.

#### RS-06 — Middleware bootstrap lacks server-side coalescing

- Current: each `/api/chat/bootstrap` calls Gateway `chat.history`.
- Failure: UI dedupe miss hits Gateway repeatedly.
- Required: middleware coalesces concurrent bootstrap per session/limit.
- Test: parallel same-session bootstrap → one Gateway `chat.history`.

### UI / Window / Render / Scroll

#### UI-01 — Split pane tab selection can desync clicked tab vs body

- Refs: `AppPage.tsx` editor tab select/group session handling.
- Current: tab selection dispatch then session resolution may read stale group session data.
- Failure: clicked tab/sidebar and rendered body disagree.
- Required: focus+tab selection resolves from `(groupId, tabId)` atomically.
- Test: split pane with tabs A/B; click B in inactive pane; body/session equals B.

#### UI-02 — Sidebar active state is single-focused in split mode

- Current: sidebar highlights global active chat only while split panes can show two chats.
- Required: define highlight as focused pane; log/focus pane changes; optionally secondary open indicator.
- Test: focus each pane; sidebar active follows focused pane.

#### UI-03 — Inactive split pane can auto-scroll

- Current: split panes render `ChatView` without background scroll ownership.
- Failure: non-focused visible pane scrolls while user reads older content.
- Required: only scroll owner force-scrolls; non-focused panes follow only if near bottom.
- Test: scroll inactive pane up, live patch arrives, `scrollTop` unchanged.

#### UI-04 — Sidebar selected chat vs body mismatch

- Failure: new chat selected, previous chat body visible.
- Required: rendered body keyed by `(windowId, viewGeneration, sessionKey)` and invariant logged.
- Test: create new chat in one window, switch heavy chats in another, refocus; selected/body session match.

#### UI-05 — No virtualization/windowing

- Current: every rendered message maps to DOM; older pages prepend forever.
- Required: bounded active timeline and virtualized DOM.
- Test: 5k message fixture; DOM/heap under budget after repeated scroll-up.

#### UI-06 — Scroll anchor uses height delta only

- Failure: delayed images/markdown/tool expansion change heights after RAF and shift viewport.
- Required: anchor by first visible message id/seq + offset after layout settles.
- Test: prepend page with delayed image/code; same anchor remains at same offset.

#### UI-07 — Heavy markdown/code renders full payload

- Current: full assistant text/code goes through markdown/syntax highlighter.
- Required: preview/lazy expansion before parse/highlight.
- Test: 1MB fenced code block initially renders preview, no syntax highlighter until expanded.

#### UI-08 — Tool display truncates but state stores full result

- Current: UI truncates result display, but global/warm state can hold full `resultText`.
- Required: timeline state stores preview metadata; full output by blob/ref lazy fetch.
- Test: 1000 tool results x 100KB; warm/global cache stays bounded.

## Stress Test Scenarios

Create repeatable scripts for:

1. Rapid switch 20 heavy chats.
2. Open/create new chat and send immediately.
3. Send while active bootstrap is in flight.
4. Scroll older repeatedly while a run is thinking.
5. Two windows: create/send in one, switch heavy chats in another, refocus first.
6. Split panes: inactive pane selection + scroll-up + live update.
7. Focus/blur/resume during pending bootstrap.
8. Reconnect stream from cursor 0 and from valid cursor.
9. Archive import/resequence while pagination is in flight.
10. Expand heavy tool outputs while scrolling.
11. Model switch immediately followed by send.
12. Abort while delayed tool/status patches arrive.

Stress scripts fail if logs contain:

- `chat-view.invariant ok:false`
- `willApply:true` with mismatched active/rendered session
- duplicate same-session bootstrap applies for same generation
- side metadata apply from stale generation
- `historyCoverage:"full"` with `hasOlder:true`
- recovery mode applying replay patches
- stale pagination applies after projection generation changed

## Recommended Build Order After Matrix Approval

1. Instrumentation + invariants.
2. Request scheduler/stale-result guards/abort/coalescing.
3. Correct history-window API metadata and UI `windowed` type.
4. Stream recovery scope and cursor lifecycle.
5. Send lifecycle guard for optimistic thinking/finalization.
6. Side metadata isolation/dedupe/cache.
7. Windowed timeline state + pagination ownership.
8. Virtualization/lazy heavy tool output rendering.
9. Multi-window/split-pane invariant hardening.
10. Stress-test gate and review.

## Definition of Done

Before `feature-build` starts:

- Edge-case matrix is reviewed and accepted.
- Each row has an invariant and at least one test or manual stress validation.
- Missing instrumentation is identified.
- No implementation work has started.

Before ship:

- No `chat-view.invariant ok:false` under stress.
- Stale async results log `willApply:false` with reason.
- Side metadata is not required for chat first paint.
- New chat quick-send keeps thinking until terminal evidence.
- Heavy chat send cannot stay thinking forever without explicit recovery/error.
- Sidebar selected session and rendered body session match per window/pane.
- DOM/RAM remain bounded for tool-heavy histories.
