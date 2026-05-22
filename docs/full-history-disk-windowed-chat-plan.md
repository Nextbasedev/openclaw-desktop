# Full History on Disk + Windowed Chat Timeline Plan

## Problem

Heavy production chats contain thousands of projected rows and large tool outputs. A medium production user already has enough chat data that a naive full-history UI load is not viable:

- 14/18 production chats scanned before the long estimate process was killed.
- Scanned rows: `65,511`.
- Scanned raw projected JSON: `~290.5 MB`.
- Scanned tool-result rows: `34,250`.
- Scanned tool-result JSON: `~186.9 MB`.
- Estimated all 18 chats: `~84k rows`, `~370-380 MB` raw JSON equivalent.
- With SQLite/index/duplication overhead, naive storage could reach `~500-700 MB`; 1-2GB local disk is acceptable if it buys performance.

The issue is not disk size by itself. The issue is **putting too much history into RAM/React/DOM and transferring huge tool blobs in normal bootstrap paths**.

User-approved product direction:

- It is acceptable for middleware to use substantial disk/SSD storage, similar to Telegram Desktop.
- Full history should be locally available for performance.
- UI must stay fast by rendering only a bounded window and lazy-loading heavy content.

## Current Flow

### Middleware storage and bootstrap

Relevant files:

- `apps/middleware/src/db/migrate.ts`
- `apps/middleware/src/features/chat/repo.messages.ts`
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/projection.ts`

Current storage:

- `v2_messages` stores projected message rows with `data_json TEXT NOT NULL`.
- Primary key is `(session_key, openclaw_seq)`.
- Indexes exist for `(session_key, openclaw_seq)`, `(session_key, message_id)`, segment seq, and session id.

Current bootstrap route:

- `apps/middleware/src/features/chat/routes.ts:1110-1227`
- Calls Gateway `chat.history`.
- Normalizes and upserts messages into SQLite.
- Reads projected latest messages via `context.messages.listMessages(sessionKey, { limit, latest: true })`.
- Appends a metadata `chat.bootstrap` projection event.
- Returns `buildChatBootstrapSnapshot(...)`.

Current snapshot issue:

- `apps/middleware/src/features/chat/projection.ts:132-144` returns:
  - `historyCoverage: "full"`
  - `fullMessagesIncluded: true`
  - `messageCount: params.messageCount`
- But the route may only return latest `160`/limited messages. That is a **window**, not full history, when older rows exist.

Current pagination route:

- `apps/middleware/src/features/chat/routes.ts:1229-1261`
- Returns raw projected rows for `/api/chat/messages`.
- Includes `messageCount: messages.length` only.
- Does not return `loadedOldestSeq`, `loadedNewestSeq`, `hasOlder`, `hasNewer`, or total count.

### UI timeline and rendering

Relevant files:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/components/ChatView/index.tsx`

Current UI behavior:

- `useChatMessages.ts:1459` starts the global chat engine during mount.
- `useChatMessages.ts:1560-1642` loads bootstrap, parses history, seeds global session, and currently marks history as `full` in UI seed.
- `useChatMessages.ts:2504-2585` loads older messages and prepends them to the current local/global message array.
- `ChatView/index.tsx:723-728` computes `renderedMessages = visibleMessages(messages, messageActionState)`.
- `ChatView/index.tsx:1526-1530` maps every `renderedMessages` item into the DOM.

This means as more history pages are loaded, React state and DOM can grow toward thousands of rows and thousands of tool result/pre blocks. Production E2E confirmed DOM pressure: after switching/scrolling heavy chats, DOM reached ~14k nodes and JS heap ~177MB.

## Root Cause

The current architecture confuses four separate concepts:

1. **Durable history availability** — should be full and disk-backed.
2. **Queryable projection/index** — should be local and efficient.
3. **Active UI timeline window** — should be bounded in RAM.
4. **Rendered DOM window** — should be smaller still, visible + overscan only.

Today, bootstrap/pagination/global store move large message arrays around as if the active chat state should eventually contain all loaded history. That is why full chat access becomes laggy.

Telegram Desktop-style design avoids this: full/local history can exist, but the visible list is a slice/window with scroll anchoring and heavy-part unloading.

## Proposed Fix

### 1. Keep full local history on disk, but define it as projection storage

Keep middleware as the local source for fast UI reads:

- Full projected history lives on disk/SSD in SQLite.
- Store enough data to serve history without hitting Gateway for every scroll.
- Use `openclaw_seq` as the order key.
- Keep imported/archived history projected into segments.

Do **not** treat this as “load full history into UI.” Disk can be large; RAM and DOM must remain bounded.

### 2. Add explicit history-window metadata to middleware APIs

Update `/api/chat/bootstrap` and `/api/chat/messages` responses.

New metadata fields:

```ts
type HistoryCoverage = "metadata" | "windowed" | "full"

type ChatHistoryWindowMeta = {
  returnedMessageCount: number
  knownTotalMessages: number | null
  loadedOldestSeq: number | null
  loadedNewestSeq: number | null
  hasOlder: boolean
  hasNewer: boolean
  historyCoverage: HistoryCoverage
  fullMessagesIncluded: boolean
}
```

Rules:

- `historyCoverage:"full"` only if no older and no newer messages exist outside the returned window.
- A latest bootstrap of 160 messages should be `historyCoverage:"windowed"` when `hasOlder:true`.
- `messageCount` should either be deprecated or kept as backward-compatible returned count; new code should use `returnedMessageCount` and `knownTotalMessages`.
- `/api/chat/messages` must return the same metadata so scroll/pagination does not guess.

Implementation detail:

- Add repository helpers:
  - `countMessages(sessionKey)`.
  - `minMaxSeq(sessionKey)`.
  - `hasMessageBefore(sessionKey, seq)`.
  - `hasMessageAfter(sessionKey, seq)`.
- These can be cheap indexed SQLite queries on `(session_key, openclaw_seq)`.

### 3. Separate heavy content from normal timeline payloads

Keep full content available, but do not send huge tool outputs in default bootstrap/page payloads.

Add a “preview vs full content” model for heavy projected rows:

```ts
type HeavyContentRef = {
  kind: "inline" | "blob"
  blobId?: string
  fullSizeBytes?: number
  previewText?: string
  truncated?: boolean
  contentHash?: string
}
```

Plan:

- Keep small messages inline.
- For large tool outputs / command outputs / huge text blocks:
  - store preview inline in `data_json`, or mark as truncated in serialized response.
  - store full blob separately, compressed and content-addressed where possible.
  - expose endpoint for full content expansion, e.g. `GET /api/chat/message-content?sessionKey&seq&part=...`.

This is not required for the first metadata/windowing phase, but it is required before calling the architecture complete.

Storage strategy options:

- Phase A: keep existing `data_json` full content, but serialize previews by default.
- Phase B: add blob table and migrate only oversized content.

Suggested blob table later:

```sql
v2_message_blobs(
  blob_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  encoding TEXT NOT NULL, -- gzip/zstd/plain
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL
)
```

### 4. Introduce bounded UI timeline state

Replace “messages array grows forever” behavior with a window model.

UI timeline state should track:

```ts
type ChatTimelineState = {
  sessionKey: string
  messages: ChatMessage[] // bounded active window, not full history
  loadedOldestSeq: number | null
  loadedNewestSeq: number | null
  knownTotalMessages: number | null
  hasOlder: boolean
  hasNewer: boolean
  historyCoverage: "metadata" | "windowed" | "full"
  cursor: number
  status: StreamStatus
  pendingTools: InlineToolCall[]
}
```

Rules:

- Keep only a bounded number of parsed messages in React state, e.g. current window + overscan pages.
- If user scrolls far upward, load older page and optionally evict far-bottom pages while preserving ability to jump back down.
- If user returns bottom, fetch latest window again or keep a small bottom cache.
- Live patches merge into active window if relevant; otherwise update metadata/unread/jump state.

### 5. Virtualize `ChatView`

Current render path maps every rendered message:

- `ChatView/index.tsx:1526-1530` maps all `renderedMessages`.

Change this to virtualized rendering:

- Visible viewport + overscan only.
- Estimate row heights initially; measure real row heights after render.
- Preserve scroll anchor by message id/seq + offset, not scrollHeight delta alone.
- Avoid rendering thousands of `<pre>` / tool blocks.

Important scroll invariants from `docs/constraints/ui-scroll.md` must remain:

- first open scrolls latest/bottom,
- user send force-scrolls bottom,
- live updates follow only if user is near bottom,
- user scroll-up is preserved,
- load older preserves viewport,
- background panes do not steal scroll.

### 6. Lazy render and lazy fetch heavy tool outputs

Tool cards should default to compact/collapsed preview:

- Show tool name, status, duration, small preview/summary.
- Do not mount full output until expanded and visible.
- If full output was omitted/truncated from bootstrap, fetch it on expansion.
- Cache fetched full output in memory with a bounded LRU and/or disk blob cache.

This directly addresses production data where tool results dominate size:

- 14 scanned chats: `~186.9 MB` of `~290.5 MB` was tool-result JSON.
- Some single tool result rows were `~400KB+`.

### 7. Request scheduler and side metadata isolation

Rapid switching currently starts many bootstraps and side calls. Add scheduler rules:

- one active bootstrap per visible pane/session,
- abort or ignore stale bootstrap results on switch,
- dedupe same-session bootstrap requests,
- pins/branches/models are side metadata and must not block chat render,
- cache/dedupe side metadata with short TTL.

This should be planned alongside windowed timeline but can be built as a separate phase.

### 8. Stream lifecycle compatibility

Patch stream remains the live delta source, not full history.

Rules:

- `/api/stream/ws` must not replay from `afterCursor:0` into visible active chat after bootstrap cursor exists.
- Replayed `chat.bootstrap` patches are metadata/recovery hints, not a replacement for the active timeline window.
- If cursor is missing/too old, enter recovery: refetch bootstrap/window and then apply buffered live patches.

## Files to Change

### Middleware

- `apps/middleware/src/features/chat/repo.messages.ts`
  - Add count/min/max/has-before/has-after helpers.
  - Possibly add preview/blob-aware serialization helpers later.

- `apps/middleware/src/features/chat/routes.ts`
  - Update `/api/chat/bootstrap` to compute and return window metadata.
  - Update `/api/chat/messages` to compute and return page metadata.
  - Keep response backward-compatible for existing UI fields.

- `apps/middleware/src/features/chat/projection.ts`
  - Stop hardcoding bootstrap snapshot as `historyCoverage:"full"`.
  - Accept `ChatHistoryWindowMeta` from route.

- `apps/middleware/src/db/migrate.ts`
  - Later phase: add blob/heavy-content table if implementing compressed/deduped large content.

- `apps/middleware/tests/*`
  - Add route/repository tests for window metadata and coverage.

### UI

- `packages/ui/lib/chat-engine-v2/types.ts`
  - Add history-window metadata types.

- `packages/ui/lib/chat-engine-v2/client.ts`
  - Parse new metadata from bootstrap/messages.
  - Add full-content fetch client later.

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Store bounded timeline metadata separately from full history count.
  - Prevent metadata/replay from overwriting active message window.

- `packages/ui/hooks/useChatMessages.ts`
  - Use API metadata instead of guessing from page size or `messageCount`.
  - Track bounded window and anchor state.
  - Add stale result guards/request scheduling hooks.

- `packages/ui/components/ChatView/index.tsx`
  - Replace full `.map()` render with virtualized/windowed rendering.
  - Preserve scroll semantics.

- `packages/ui/components/ChatView/*Tool*` / tool rendering components
  - Collapse/lazy-render heavy outputs.
  - Fetch full output on expansion in later phase.

## Risks

- **Scroll regressions:** virtualization can break first-open bottom scroll or load-older anchor preservation if not seq/id anchored.
- **Live streaming regressions:** if the active window evicts the latest messages while a run is active, assistant/tool patches may appear detached. Keep active run region pinned in window.
- **Search/edit/fork regressions:** features that assume all loaded messages are in `messages[]` must use history query APIs instead.
- **Accessibility regressions:** virtualized lists need sane focus/keyboard behavior.
- **Memory cache regressions:** if page eviction is too aggressive, rapid scroll can refetch too much.
- **Storage growth:** full disk projection can grow to GBs; add DB size diagnostics and later cleanup/compaction.
- **Blob migration complexity:** splitting heavy content into blob storage must preserve export/debug/raw data behavior.
- **Backward compatibility:** existing warm cache/global state may mark latest windows as `full`; migration/normalization must downgrade invalid full coverage safely.

## Testing

### Middleware tests

- Bootstrap with fewer total messages than limit returns `historyCoverage:"full"`, `hasOlder:false`.
- Bootstrap with more total messages than limit returns `historyCoverage:"windowed"`, `hasOlder:true`.
- `/api/chat/messages?beforeSeq=N` returns correct `loadedOldestSeq`, `loadedNewestSeq`, `hasOlder`, `hasNewer`.
- `knownTotalMessages` matches repository count when available.
- Existing `messageCount` compatibility does not break current consumers.

### UI store/hook tests

- Bootstrap metadata seeds timeline as `windowed` when older messages exist.
- Pagination uses API `hasOlder`, not guessed page length only.
- Stale bootstrap result after switching sessions is ignored.
- Metadata-only replay does not replace active window.
- Active run/live patch stays visible even if older pages are evicted.

### ChatView tests/manual verification

- First open scrolls bottom.
- Scroll up loads older messages without viewport jump.
- Full heavy chat can be traversed without DOM growing to thousands of mounted message rows.
- Tool output remains collapsed until expanded.
- Expanding a heavy tool output fetches/renders only that output.
- Rapid switching 10+ chats does not create long loading or request storm.

### Production E2E verification

Use production-like heavy chats:

- `skills` (~5,470 rows measured, ~23.1MB raw JSON equivalent).
- `openAi or Anthropic Blog` (~4,568 rows, ~21.1MB).
- `youtube to text` (~4,582 rows, ~21.2MB).

Verify:

- UI can reach oldest history without freezing.
- DOM node count remains bounded.
- JS heap remains bounded compared to current ~177MB observation.
- Disk DB may grow, but RAM/DOM should not scale linearly with total history.

## Stop

This is a `feature-plan` artifact only. Do not implement until `feature-build` is explicitly requested.

## Additional Trace: Heavy Chat Thinking + New Tab Missing Thinking

From the attached frontend log (`message---f44b4a55-ff59-441e-bbfa-e5cf6c78dc9d.txt`), there are two related symptoms.

### Heavy chat stays thinking too long

At `19:09:41`, sending in heavy session `agent:main:desktop:migrated-telegram-96b54ee1-0920-4039-b6b7-5406178eda49` sets the local/global session to `thinking` and renders `isGenerating:true`.

At `19:09:44`, `/api/chat/send` returns quickly, but the UI correctly stays `thinking` because send acknowledgement is not final generation completion.

After that, reconciliation attempts see backend/session status as `idle`, but preserve the local active state:

- `chat.reconcile-preserve-active`
- `status:"thinking"`
- `nextStatus:"idle"`
- `freshMessageCount:0`
- `currentMessageCount:46`
- `backendStatus:"idle"`

This means the UI is protecting an active optimistic run from being incorrectly cleared by incomplete/empty history. That protection is directionally right, but it exposes that the authoritative completion signal/history echo is missing or delayed for this heavy chat.

### New tab send briefly thinks, then immediately goes idle

At `19:10:23-19:10:24`, quick-send creates a new chat `agent:main:desktop:mpgyvxgp-bfoq98` and dispatches `/api/chat/send` with an optimistic user message.

The new chat initially renders thinking:

- `chat-view.render-state`
- `status:"thinking"`
- `isGenerating:true`
- `messageCount:1`

Immediately after, status flips to idle before any assistant response:

- `chat.status-change` from `thinking` to `idle`
- `/api/chat/bootstrap` returns `rawMessageCount:0`, `runStatus:"idle"`, `canonicalToolCount:0`
- `chat.bootstrap.applied` applies `status:"idle"` with `messageCount:0`

So the new-chat path has the opposite bug from the heavy-chat path: bootstrap with empty canonical history is allowed to overwrite the optimistic send/thinking state too early.

### Shared underlying cause

The UI currently has competing authorities:

1. optimistic send state,
2. bootstrap/history snapshot,
3. patch stream/live run state,
4. reconcile polling/session metadata.

Heavy chat protects optimistic `thinking` from stale idle history, while new-chat quick-send lets empty idle bootstrap win immediately. Both should use the same lifecycle rule: once a local send starts, bootstrap/reconcile must not clear `thinking` until a valid completion signal arrives, an assistant message arrives, an explicit error arrives, or a timeout/recovery path runs.

### Fix to include in implementation

- Add a per-session `activeLocalSend` / `pendingClientMessageId` guard.
- Bootstrap must preserve `thinking` when it returns `rawMessageCount:0` for a session with an active optimistic send.
- Bootstrap should merge/keep optimistic initial messages until confirmed by Gateway echo.
- Reconcile should only clear `thinking` when history contains the confirmed user echo plus assistant response/final status, or when an explicit terminal run status is received.
- Stream/bootstrap recovery reloads must be session-scoped; unrelated `chat.bootstrap` archive-import patches should not remount the active chat.

## Additional Trace: Activity/Side Metadata Load Storm + Delayed New Chat Answer

Second attached log (`message---cb0ec88d-0bdb-4f90-83a6-40c02a46c7f9.txt`) confirms two more issues.

### Activity/side metadata is loading in the hot path

During rapid tab switching, every mount starts side metadata calls such as:

- `middleware_pins_list`
- `middleware_models_list`
- `middleware_voice_settings_get`
- `middleware_branch_list`

Many of these abort after ~8s while bootstrap requests are still running. The backend often answers these side routes in `0-7ms`, so the visible delay is not backend compute; it is frontend/request scheduling pressure and request starvation behind long chat bootstrap/history work.

This means activity/sidebar/metadata loading must be isolated from the active chat render path. Side metadata should be cached, deduped, abortable, low priority, and not allowed to block chat first paint or composer/send lifecycle.

### Old bootstrap requests finish much later and keep applying work

The log shows many stale bootstrap responses completing after 90-186 seconds, e.g. multiple `chat.bootstrap.loaded` events for sessions that are no longer active. These completions then trigger more `middleware_branch_list` calls, producing a second wave of request storm.

Implementation must add strict stale-result guards: if a bootstrap response is not for the current mount generation/session view, it should be ignored and must not kick off branch/model/pins follow-up work.

### New chat answer appears later because early bootstrap races send

For new chat `agent:main:desktop:mpgyvxgp-bfoq98`:

- `19:10:24` quick-send dispatches optimistic message.
- Immediately, bootstrap reads Gateway history before send is accepted and returns `messageCount:0`, `runStatus:idle`.
- UI applies idle and clears thinking.
- `19:10:26` backend finally accepts send, persists optimistic user, broadcasts `chat.status thinking`, and starts `chat.send`.
- `19:10:53` a later bootstrap returns `rawMessageCount:5`, `runStatus:done`, and the answer appears.

So the answer is not lost; the UI temporarily hides the correct lifecycle because bootstrap happened too early and won over optimistic send state.

Fix requirement: send/create/new-chat bootstrap must be ordered or guarded. For a newly created chat with a pending quick-send, either delay bootstrap until send acceptance/status patch, or preserve optimistic thinking until a terminal response arrives.

## Additional Trace: Multi-window Sidebar Selection / Chat Body Mismatch

User reported another edge case: after many tab switches/runs, returning to a desktop app window showed the newly-created chat selected in the sidebar, but the main chat body displayed the previous chat's data.

Likely ownership problem:

- Sidebar/route active chat state and `ChatView` rendered session state are not committed atomically.
- A stale bootstrap/global-session seed can update the rendered message list after the active sidebar/chat selection has moved on.
- Multi-window state increases this risk because each window has its own route/layout scope, but chat/global-session cache and patch stream are shared.

Implementation requirements:

- Treat active route/sidebar selection and active `ChatView` session as one window-scoped transaction.
- Every rendered message list must be keyed by `(windowId, viewGeneration, sessionKey)`.
- If `activeSessionKey !== renderedSessionKey`, the UI must not show stale previous messages; it should show a transition/loading state until the matching session window is ready.
- Stale bootstrap/pagination/patch results must include `targetSessionKey`, `activeSessionKey`, `windowId`, and `viewGeneration` checks before applying.
- Add a regression test: open two windows, create/send in a new chat in one, switch many heavy chats in the other, focus the first window; sidebar-selected chat and chat body session must match.

## Full-Proof Edge Case Discovery + Verification Approach

The implementation should not proceed from intuition alone. Before `feature-build`, run a short `feature-plan v2` audit whose only goal is to make edge cases explicit and testable.

### 1. Build the chat state writer map

Inventory every code path that can change visible chat state, activity state, or side metadata:

- `GET /api/chat/bootstrap`
- `GET /api/chat/messages`
- `/api/stream/ws` / `/api/patches`
- optimistic send / quick-send
- send reconcile / polling / history refresh
- run/tool status updates
- `chat.bootstrap-recovery.reload`
- archive import refresh/background bootstrap
- branch/pins/models/voice/activity side metadata
- route changes / sidebar selection
- mount/unmount/remount
- split panes
- separate Tauri/browser windows
- focus/blur/resume

For each writer, document:

- owner file/function
- state it is allowed to mutate
- state it must never mutate
- required guards before applying
- current logs emitted
- missing logs needed

### 2. Define hard UI/state invariants

These invariants are the real safety net. Every scenario in the matrix should validate them.

#### Route/body invariant

If a chat is selected in the sidebar, the rendered `ChatView` must belong to the same `sessionKey`.

Forbidden:

- sidebar selected new chat, body shows previous chat
- active route says session A, visible message list contains session B

#### Generation invariant

Only the latest mounted view generation may apply async results.

Forbidden:

- stale bootstrap applies after tab switch
- stale pagination applies after route change
- stale side metadata triggers follow-up fetches

#### Window invariant

A result from one window must not mutate another window's active visible timeline.

Required keys:

- `windowId`
- `viewGeneration`
- `sessionKey`
- `instanceId`

#### Send lifecycle invariant

A local pending send owns `thinking` until terminal evidence arrives.

Forbidden:

- empty idle bootstrap clears new-chat `thinking`
- reconcile clears active run based only on empty/partial history

Allowed terminal evidence:

- assistant response arrives
- explicit final/error status arrives
- confirmed user echo + terminal run state arrives
- timeout/recovery path explicitly marks failed/recovered

#### History window invariant

A latest window of 160 messages is not full history when older rows exist.

Forbidden:

- `historyCoverage:"full"` for a bounded/latest window with older messages
- pagination writes pretending to be canonical full state

#### Stream invariant

Patch stream applies live deltas only after a valid cursor/session lifecycle.

Forbidden:

- `afterCursor:0` replay mutates visible active chat directly
- bootstrap/import patch for session B reloads session A

#### Side metadata invariant

Side metadata is non-blocking and lower priority than active chat render/send.

Forbidden:

- branch/pins/models/voice fetch delays chat first paint
- stale bootstrap completion starts branch-list after session changed
- many duplicate side fetches for same session/window

#### Render invariant

DOM/RAM must be bounded independently of full disk history.

Forbidden:

- visible React message array grows unbounded as user scrolls
- all heavy tool outputs mount by default

### 3. Add structured instrumentation before/with fixes

Add a reusable structured log schema around every async apply decision:

```ts
type ChatApplyDecisionLog = {
  event: string
  windowId: string | null
  instanceId: string | null
  viewGeneration: number | null
  source: "bootstrap" | "messages" | "patch" | "send" | "reconcile" | "side-metadata" | "route"
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

Minimum required events:

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

If `ok:false`, this is a release blocker.

### 4. Create the edge-case matrix

Matrix columns:

- ID
- Scenario
- State writer(s)
- Expected owner
- Required invariant(s)
- Allowed mutations
- Forbidden mutations
- Current evidence/logs
- Instrumentation needed
- Automated test
- Manual/stress test
- Fix phase

Initial matrix rows:

1. Heavy chat send while bootstrap/history is slow.
2. New chat quick-send while empty bootstrap returns first.
3. Mis-scoped `chat.bootstrap-recovery.reload` from session B reloads session A.
4. Stale bootstrap completes after tab switch.
5. Stale bootstrap triggers branch-list/model/pins follow-up.
6. Duplicate same-session bootstraps all complete and apply.
7. Patch stream starts with `afterCursor:0` and replays old bootstrap/import patches.
8. Scroll-up pagination while run is active.
9. Pagination repeatedly seeds global state and marks `historyCoverage:"full"`.
10. Sidebar selected chat and rendered body session mismatch.
11. Multi-window focus returns with stale body state.
12. Split pane/background chat receives live patch.
13. Focus/blur/resume starts app bootstrap while chat requests are active.
14. Side metadata request storm under rapid switching.
15. Gateway `chat.history` timeout under request storm.
16. Heavy tool output renders many DOM nodes.
17. Heavy tool expansion while virtualized/offscreen.
18. Assistant final response arrives after user switched away.
19. Confirmed user echo arrives after optimistic message was evicted from window.
20. Abort/stop while reconcile/bootstrap is pending.
21. Model switch while send/bootstrap is pending.
22. Branch/pins metadata arrives for stale session.
23. Archive import resequences messages while user is paginating.
24. Imported/history segment has inconsistent timestamps; ordering must still use `openclaw_seq`.
25. Warm cache has session A while active route is session B.

### 5. Stress test scripts

Create repeatable stress scripts that run against prod-like local UI and middleware:

- rapid switch 20 heavy chats
- open/create new chat and send immediately
- send while active bootstrap is in flight
- scroll older repeatedly while active run is thinking
- open two windows and switch/focus them alternately
- trigger focus/blur/resume during pending bootstrap
- reconnect stream from cursor 0 and from valid cursor
- expand heavy tool outputs while scrolling
- split pane active/background switching

Each script should fail if logs contain:

- `chat-view.invariant ok:false`
- `willApply:true` with mismatched active/rendered session
- duplicate same-session bootstrap applies for same generation
- side metadata apply from stale generation
- `historyCoverage:"full"` with `hasOlder:true`

### 6. Use independent audit subagents before build

Run five isolated audits and merge their findings into the matrix:

1. Stream/recovery auditor
   - patch cursor lifecycle, replay, archive import refresh, recovery reload scope.
2. Bootstrap/pagination auditor
   - API contract, history window metadata, pagination ownership.
3. Send/run lifecycle auditor
   - optimistic messages, thinking/finalization, user echo confirmation, stop/abort.
4. Side metadata/request scheduler auditor
   - branch/pins/models/activity fetches, dedupe, stale result guards.
5. UI render/window auditor
   - sidebar/body invariant, windowId, split panes, virtualization, scroll anchoring.

Each auditor must output:

- concrete file/function references
- race scenario
- current behavior
- required guard/invariant
- proposed test

### 7. Build order after matrix is complete

Recommended phases:

1. Instrumentation + invariants first.
2. Request scheduler/stale-result guards.
3. Correct history-window API metadata.
4. Stream recovery scope/cursor lifecycle.
5. Send lifecycle guard for optimistic thinking/finalization.
6. Side metadata isolation/dedupe/cache.
7. Windowed timeline state + pagination ownership.
8. Virtualization/lazy heavy tool output rendering.
9. Multi-window/split-pane invariant hardening.
10. Full stress-test gate before ship.

### 8. Definition of done

The fix is not done until:

- Edge-case matrix exists in docs with every row assigned a test or explicit manual validation.
- Stress tests reproduce old failure modes before fix or prove the invariant would catch them.
- No `chat-view.invariant ok:false` under stress.
- Stale async results log `willApply:false` with reasons.
- Side metadata is never required for chat first paint.
- New chat quick-send keeps thinking until terminal evidence.
- Heavy chat send does not stay thinking forever without an explicit recovery/error path.
- Sidebar selected session and rendered body session always match per window.
- DOM/RAM remain bounded for tool-heavy histories.
