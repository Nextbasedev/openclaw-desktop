# I2 — Multi-Writer / Double-Patch-Apply Map

Read-only investigation of the chat surface. Branch `fix-master`, repo
`openclaw-desktop`. All claims are line-referenced. ChatView is
`packages/ui/components/ChatView/index.tsx` (3041 LOC). Store is
`packages/ui/lib/chat-engine-v2/store.ts` (2307 LOC). Pure patch reducer is
`packages/ui/lib/chat-engine-v2/applyPatches.ts` (725 LOC).

The viewed-session state currently exists in **two writers**:

1. The canonical store (`store.ts`) — receives every `PatchFrame` via
   `subscribeChatPatches(globalCursor, handleFrame)` (store.ts:1992) and feeds
   `applyChatPatch` into a per-session `SessionState`. Exposes
   `subscribeGlobalChatSession` / `getGlobalChatSession`.
2. `ChatView` local React state `HistoryState` (index.tsx:132–139) and
   `WindowState`. `ChatView` ALSO opens its OWN `subscribeChatPatches`
   (index.tsx:1078–1313) and calls the SAME pure `applyChatPatch` against its
   local `current.messages`.

ChatView already imports `getGlobalChatSession` and
`subscribeGlobalChatSession` (index.tsx:19) but uses them **only** for sub-agent
sync (index.tsx:1654–1668, 1722–1727) — never to render its own messages.

---

## 1. ChatView `setState(...)` (HistoryState) call sites

Type `HistoryState = { loading, error, composerError, messages, streamStatus, statusLabel }` (index.tsx:132–139).

Classification key:
(a) patch-stream apply, (b) bootstrap/history load, (c) optimistic send,
(d) composer/UI-only field, (e) status/registry sync, (f) other.

| # | Line | Class | Trigger / Effect | What it does |
|---|------|-------|------------------|--------------|
| 1 | 600  | (b) | `useState<HistoryState>(...)` initial — runs on mount | Initializer; picks one of: optimistic-bootstrap snapshot from `initialMessages` + `streamStatus:"thinking"`, registry hydrate from `activeRunRegistry`, or empty `loading:true`. (index.tsx:600–644) |
| 2 | 900  | (b) | bootstrap effect (line ~700) `.then` callback of `fetchChatMessagesV2` during registry-hydrate **reconcile** branch | Replaces `messages` with reconciled fresh history; may flip `streamStatus → idle` when run looks complete. (index.tsx:900–907) |
| 3 | 943  | (b) | Same bootstrap effect, fall-through (no hydrate / no optimistic) | Synchronous reset to `{loading:true, …, streamStatus:"idle"}` before initial fetch. (index.tsx:942–950) |
| 4 | 985  | (b) | Bootstrap initial-fetch `.then` success | `{loading:false, messages, streamStatus:"idle"}`. Also stamps `lastBootstrapCompletedAtRef.current` (impure — see §3). (index.tsx:984–999) |
| 5 | 1004 | (b) | Bootstrap initial-fetch `.catch` | `{loading:false, error, streamStatus:"error"}`. (index.tsx:1003–1011) |
| 6 | 1135 | (a) | **`subscribeChatPatches` callback** (index.tsx:1078) — runs for every server patch frame | Calls `applyChatPatch(...)` against `current.messages`, orders, then returns next `messages/streamStatus/statusLabel`. The big patch-apply updater. Contains `frontendLog` + `setWindowState` calls inside the updater (impure — see §3). (index.tsx:1135–1313) |
| 7 | 1324 | (d) | `handleSend` — `isGenerating && !runWhileGenerating && !isStopCommand && !canEnqueueChatMessage(...)` | Sets `composerError: "Queue limit reached…"`. (index.tsx:1324–1325) |
| 8 | 1345 | (d) | `handleSend` queued-success branch | Clears `composerError`. (index.tsx:1345–1346) |
| 9 | 1396 | (c) | `handleSend` — after `beginSendIfIdle`, normal optimistic path | Inserts `optimisticMessage` into `messages`, sets `streamStatus:"thinking"`, `statusLabel:"Thinking"`, clears `composerError`. (index.tsx:1396–1404) |
| 10 | 1441 | (c) | `handleSend` `catch` branch | Marks optimistic row `sendStatus:"failed" / sendError`, sets `streamStatus:"error"`, `composerError`. (index.tsx:1441–1457) |
| 11 | 1467 | (e) | `handleAbort` start | `streamStatus:"stopping", statusLabel:"Stopping"`. (index.tsx:1467–1471) |
| 12 | 1487 | (e) | `handleAbort` settleIdle branch | `streamStatus:"idle", statusLabel:null`. (index.tsx:1487–1491) |
| 13 | 1496 | (f) | `handleTextAnimationComplete(messageId)` | Sets `message.animateText=false` per id. (index.tsx:1496–1504) |
| 14 | 1511 | (c) | `handleEdit` | Rewrites a user message text + clears `sendStatus/sendError`, then re-sends. (index.tsx:1511–1518) |
| 15 | 1525 | (c) | `handleRetrySend` | Clears `composerError` and per-message `sendStatus/sendError`. (index.tsx:1525–1533) |
| 16 | 1547 | (f) | `handleDelete` | Removes a message by id. (index.tsx:1547–1550) |
| 17 | 1943 | (f) | `useEffect([isGenerating, state.messages, sessionKey])` animate-text safety-clear | Walks `state.messages`, flips any leftover `animateText:true` → `false`. Contains `frontendLog` BEFORE the setState (not inside the updater here — the `frontendLog` is in the effect body). (index.tsx:1923–1953) |
| 18 | 2105 | (a/b) | `fetchOlderPage` success (older-page resolve) — runs inside `.then` of `fetchChatMessagesV2` | Prepends `olderMessages`, computes eviction-from-end, returns new `messages`. **Contains `setWindowState(...)` + `frontendLog(...)` calls inside the updater** (impure — see §3). (index.tsx:2105–2160) |
| 19 | 2280 | (a/b) | `fetchNewerPage` success (newer-page resolve) | Appends `newerMessages`, evicts from start IF `reachedLiveTail`, returns new `messages`. **Contains `setWindowState(...)` + `frontendLog(...)` inside updater** (impure). (index.tsx:2280–2330) |
| 20 | 2363 | (b) | `resetToLiveTail` synchronous reset | `{loading:true, …, streamStatus:"idle"}`. (index.tsx:2362–2370) |
| 21 | 2405 | (b) | `resetToLiveTail` success | `{loading:false, messages, streamStatus:"idle"}`. Also stamps `lastBootstrapCompletedAtRef.current`. (index.tsx:2405–2412) |
| 22 | 2425 | (b) | `resetToLiveTail` catch | `{loading:false, error, streamStatus:"error"}`. (index.tsx:2425–2432) |

Total: **22 `setState(...)` call sites** for HistoryState.

---

## 2. WindowState (`setWindowState(...)`)

Type `WindowState` (components/ChatView/messageWindow.ts:50–58):
`{ oldestLoadedSeq, newestLoadedSeq, hasOlder, hasNewer, isLoadingOlder, isLoadingNewer }`.

| # | Line | Trigger | Action |
|---|------|---------|--------|
| 1 | 652  | initial `useState(INITIAL_WINDOW_STATE)` | (messageWindow.ts:60–67) |
| 2 | 773  | Bootstrap effect, optimistic-bootstrap branch | `applyInitialPage({returnedCount:0, …})` |
| 3 | 823  | Bootstrap effect, registry-hydrate branch | `applyInitialPage(...)` from seeded messages |
| 4 | 908  | Bootstrap effect, registry-hydrate **reconcile** `.then` | `applyInitialPage(...)` if fresh history adopted |
| 5 | 942  | Bootstrap effect, cold-bootstrap synchronous reset | `INITIAL_WINDOW_STATE` |
| 6 | 977  | Bootstrap effect, cold-bootstrap success `.then` | `applyInitialPage(...)` from fetched history |
| 7 | 1003 | Bootstrap effect, cold-bootstrap `.catch` | `INITIAL_WINDOW_STATE` |
| 8 | 1228 | **Inside `setState` patch-apply updater** (live append with eviction) | `applyLiveAppend({prevLoadedLength, appendedNewestSeq, evictedFromStart, evictedOldestSeq})` |
| 9 | 1260 | **Inside `setState` patch-apply updater** (live append, cannot evict, hasOlder=false) | `applyLiveAppend({evictedFromStart:0})` |
| 10 | 1292 | **Inside `setState` patch-apply updater** (live append, length ≤ MAX_LOADED) | `applyLiveAppend(...)` newest-seq bump |
| 11 | 2067 | `fetchOlderPage` start | `{...s, isLoadingOlder:true}` |
| 12 | 2082 | `fetchOlderPage` success, empty response | `applyOlderPage({returnedCount:0, …})` |
| 13 | 2127 | **Inside `setState` updater of fetchOlder success path** | `applyOlderPage(...)` with eviction-from-end |
| 14 | 2161 | `fetchOlderPage` catch | `{...s, isLoadingOlder:false}` |
| 15 | 2232 | `fetchNewerPage` start | `{...s, isLoadingNewer:true}` |
| 16 | 2247 | `fetchNewerPage` success, empty response | `applyNewerPage({returnedCount:0, …})` |
| 17 | 2302 | **Inside `setState` updater of fetchNewer success path** | `applyNewerPage(...)` with eviction-from-start (only when `reachedLiveTail`) |
| 18 | 2333 | `fetchNewerPage` catch | `{...s, isLoadingNewer:false}` |
| 19 | 2362 | `resetToLiveTail` synchronous reset | `INITIAL_WINDOW_STATE` |
| 20 | 2397 | `resetToLiveTail` success | `applyInitialPage(...)` |
| 21 | 2424 | `resetToLiveTail` catch | `INITIAL_WINDOW_STATE` |

Total: **21 `setWindowState(...)` call sites.**

### Windowing — what interacts with messages
- **Eviction during live append**: index.tsx:1217–1297 (inside patch-apply
  updater). Slices `orderedMessages.slice(evict)` when length > `MAX_LOADED`
  (=160; `messageWindow.ts:13`) and `canEvictFromStartOnLiveAppend(s)` is
  true.
- **Eviction during older-page prepend**: index.tsx:2107–2126
  (`computeEvictedAfterPrepend`, slices from tail).
- **Eviction during newer-page append**: index.tsx:2282–2305 (only when
  backend returned `< OLDER_PAGE` → `reachedLiveTail`, then
  `computeEvictedAfterAppend` + `combined.slice(evictedFromStart)`).
- **Anchor capture**: `captureFirstVisibleRowAnchor()` (index.tsx:2034–2057)
  runs BEFORE older/newer fetch (index.tsx:2066, 2231). Stored in
  `pendingScrollAnchorRef.current` and consumed post-mutation (not shown
  here but used by the `useLayoutEffect` anchor restorer later in the file).

### Two windowing modules — duplication

There are **two parallel windowing implementations**:

1. **`packages/ui/components/ChatView/messageWindow.ts`** (276 LOC) —
   ChatView-owned. Constants: `MAX_LOADED=160, INITIAL_PAGE=160,
   OLDER_PAGE=100, TOP_TRIGGER=60, BOTTOM_TRIGGER=60, REFRACTORY_MS=250`
   (lines 14–46). Exposes `applyInitialPage / applyOlderPage / applyNewerPage
   / applyLiveAppend / canEvictFromStartOnLiveAppend / shouldFetchOlder /
   shouldFetchNewer / liveTailQuery / shouldDropPatchAsEvicted`. ChatView
   imports all of these (index.tsx:62–80).

2. **`packages/ui/lib/chat-engine-v2/messageWindow.ts`** (196 LOC) —
   store-owned. Constants: `PAGE_SIZE=100, WINDOW_PAGES=2, WINDOW_SIZE=200,
   LOAD_THRESHOLD_RATIO=0.2` (lines 23–26). Exposes `pageDropCount /
   classifyMessagesForTrim / planDropFromTop / planDropFromBottom / applyTrim
   / sortMessagesByGatewayIndex / detectEdgeProximity`. Consumed only by
   `trimSessionMessageWindow` in the store (store.ts:2195–2244) and by tests.

The two modules **do not share constants** (`MAX_LOADED=160` vs
`WINDOW_SIZE=200`, `OLDER_PAGE=100` vs `PAGE_SIZE=100`) and **do not share
the protected-row logic** (ChatView's `canEvictFromStartOnLiveAppend(s)`
checks `prevState.hasOlder===true`; store's `isMessageProtectedForTrim`
checks `isOptimistic || sendStatus || animateText` — store.ts:2247–2255).

`store.trimSessionMessageWindow(sessionKey, {dropFromTop, dropFromBottom})`
(store.ts:2195) is **not called from ChatView today.** A grep of the repo:
the only callers are unit tests
(`packages/ui/lib/chat-engine-v2/__tests__/store.test.ts:3741+`). So today
the store's window is effectively "all messages ever applied", and the
client-visible window is owned exclusively by ChatView's local `WindowState`.

---

## 3. IMPURE UPDATERS (side effects inside `setState` / `setWindowState`)

React invokes updater functions **multiple times** under StrictMode /
concurrent rendering. Any side effect inside the updater body fires once per
invocation. The following are **all impure**:

### setState patch-apply updater (index.tsx:1135–1313)
Side effects observed inside the updater body:
- **`frontendLog(...)`** at index.tsx:1147 (`"chat-rebuild.tool-patch.apply"`).
- **`frontendLog(...)`** at index.tsx:1175 (`"chat-rebuild.assistant-delta.render-state"`).
- **`frontendLog(...)`** at index.tsx:1191 (`"chat-rebuild.status.suppress-stale-terminal"`).
- **`setWindowState((s) => applyLiveAppend(...))`** at index.tsx:1228, 1260, 1292
  — schedules another React state mutation from within an updater. React docs
  explicitly warn against this; under StrictMode the outer updater runs
  twice → the queued setWindowState is enqueued twice as well (React
  collapses identical updates, but `applyLiveAppend` reads `s` so the two
  invocations DO produce identical updaters; the actual hazard is that
  observability code that reads windowStateRef inside the updater may see
  inconsistent state).
- **`frontendLog(...)`** at index.tsx:1238 (`"chat-rebuild.window.live-append-evicted"`)
  and at 1272 (`"…live-append-no-evict"`).
- **Reads** `windowStateRef.current` at index.tsx:1215 — not a mutation but
  an out-of-band read of a ref whose value may not match what React thinks
  the current windowState is (the ref is sync-updated by the
  `useEffect([windowState])` at index.tsx:1066–1068, so it lags by one
  commit). The decision branch (evict vs no-evict) is taken from this ref.

### setState fetchOlderPage success updater (index.tsx:2105–2160)
- **`setWindowState((s) => applyOlderPage(...))`** at index.tsx:2127 (nested
  inside the `setState` updater body).
- **`frontendLog(...)`** at index.tsx:2143 (`"…older-fetch-resolved"`).

### setState fetchNewerPage success updater (index.tsx:2280–2330)
- **`setWindowState((s) => applyNewerPage(...))`** at index.tsx:2302.
- **`frontendLog(...)`** at index.tsx:2317 (`"…newer-fetch-resolved"`).

### Effects (not updaters, but adjacent — ref mutations)
Outside `setState` updaters, these refs are mutated as observable side
effects of the same workflows:
- `cursorRef.current = ...` at index.tsx:782, 884, 956, 2354, 2402.
- `lastBootstrapCompletedAtRef.current = Date.now()` at index.tsx:788, 836,
  997, 2412.
- `lastOlderResolvedAtRef.current` at index.tsx:2098, 2162.
- `lastNewerResolvedAtRef.current` at index.tsx:2263, 2334.
- `activeRunRegistry.publish(sessionKey, {...})` at index.tsx:1045 — runs
  inside a `useEffect([state.messages, state.streamStatus, …])` so it fires
  on every committed render of state.

### Why this matters
1. `frontendLog` inside an updater that runs twice in StrictMode produces
   double-logging that masks the true patch count.
2. `setWindowState(...)` queued from inside `setState(...)` is hazardous
   because both updates land in the same React batch; the decision of
   whether to evict (which depends on a window value) is taken from
   `windowStateRef.current` BEFORE the queued setWindowState commits — so
   two patch frames arriving in the same tick can both read the
   pre-mutation window value and both decide to evict against the same
   baseline.
3. These impurities are silent: the patch-apply path is logically pure
   (`applyChatPatch` is pure — applyPatches.ts has no `frontendLog`/`emit`/
   `console`/ref mutation — verified by `grep`), but ChatView's wrapper
   adds the impurity at the React boundary.

---

## 4. Store `SessionState` shape vs ChatView `HistoryState`

`SessionState` (store.ts:16–29):

```ts
{
  cursor: number
  messages: ChatMessage[]
  historyCoverage: HistoryCoverageV2
  messageCount: number | null
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  lastPatchAtMs: number
  activityStartedAtMs: number
  deferredDoneUntilAssistant: boolean
  finalizedAssistantAtMs: number
}
```

`HistoryState` (index.tsx:132–139):
```ts
{
  loading: boolean
  error: string | null
  composerError: string | null
  messages: ChatMessage[]
  streamStatus: StreamStatus
  statusLabel: string | null
}
```

Same in both: `messages`, `status`/`streamStatus`, `statusLabel`. `ChatMessage`
already carries `text`, `role`, `runId`, `toolCalls`, `gatewayIndex`,
`animateText`, `isOptimistic`, `sendStatus` (all the fields ChatView reads).

**ChatView has, store does NOT**:
- `loading: boolean` — pre-bootstrap skeleton flag. Store has
  `historyCoverage: "none" | "partial" | "full"` (store.ts:16–29) which is
  morally equivalent but the semantics differ (`loading` is a transient
  fetch-in-flight gate; `historyCoverage` is "what did the server tell us
  about completeness").
- `error: string | null` — bootstrap/reset-to-live-tail fetch error.
- `composerError: string | null` — purely UI; queue-limit warnings,
  send-failure echoes. Has no analogue in the store and shouldn't.
- Optimistic rows BEFORE seedGlobalChatSession is called for them. The
  store DOES merge optimistic rows via `mergeSeedMessages` (store.ts:2032)
  and dedupe to a canonical row on confirm — proof in §5 — but ChatView
  inserts its optimistic row at index.tsx:1396 with NO call into the store
  (verified: no `seedGlobalChatSession` call in `handleSend`).

**Store has, ChatView's HistoryState does NOT** (but ChatView reads
elsewhere or derives):
- `cursor` — ChatView keeps its own `streamCursor` + `cursorRef.current`.
- `pendingTools` — ChatView derives tool display from `messages[].toolCalls`.
- `spawnedSubagents` — ChatView already reads via the
  `subscribeGlobalChatSession` hook at index.tsx:1651–1668 into
  `globalSpawnedSubagents` local state.
- `historyCoverage`, `messageCount` — ChatView doesn't read.
- `lastPatchAtMs`, `activityStartedAtMs`, `deferredDoneUntilAssistant`,
  `finalizedAssistantAtMs` — internal store bookkeeping; ChatView neither
  reads nor needs them.

**Bottom line**: To render from the store, ChatView needs `messages`,
`status` (renamed `streamStatus`), `statusLabel`, plus its own UI-only
locals (`loading`, `error`, `composerError`).

---

## 5. Optimistic send path

`handleSend` (index.tsx:1344–1462). Relevant subsequence:

1. **Pre-checks** at index.tsx:1346–1351: stop-command / queue check.
2. **Window reset** at index.tsx:1378: `if (windowStateRef.current.hasNewer)
   await resetToLiveTail()` — if the user was scrolled into the middle,
   reset to live tail before sending.
3. **Mint optimistic id** at index.tsx:1381–1393: `optimisticId = randomId()`,
   build `optimisticMessage` (`role:"user", isOptimistic:true,
   sendStatus:"sending"`).
4. **Optimistic render** at index.tsx:1395–1404: `setState(...)` appends
   `optimisticMessage` to LOCAL `state.messages`, sets `streamStatus:"thinking"`,
   `statusLabel:"Thinking"`.
5. **Network call** at index.tsx:1418–1430: `await sendChatV2({sessionKey,
   text, attachments, idempotencyKey: chatSendIdempotencyKey(sessionKey,
   optimisticId), clientMessageId: optimisticId, …})`.
6. **Reconcile on success**: the gateway emits `chat.user.confirmed` /
   `chat.message.confirmed` patches carrying `optimisticId`/`clientMessageId`.
   ChatView's local `subscribeChatPatches` handler (index.tsx:1078) feeds
   those through `applyChatPatch`. Inside `applyPatches.ts:patchOptimisticId`
   (applyPatches.ts:42–47), the reducer replaces the optimistic row with
   the canonical row matched by `clientMessageId`.
7. **Failure** at index.tsx:1441–1457: catch sets the row's
   `sendStatus:"failed"` + `sendError`.

**Does the store ALSO handle optimistic rows?** Yes — but ONLY when
`seedGlobalChatSession` is called with optimistic content. The store's
`mergeSeedMessages` path (store.ts:2032) reconciles client→gateway IDs.
Proof in `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`:

- Line 47: **"seed merge preserves optimistic image preview when canonical
  row has metadata only"** — first seed has `isOptimistic:true,
  sendStatus:"sending", attachments:[{content:"abc123"}]`; second seed
  carries the same logical row with `__openclaw.clientMessageId:"client-1"`
  but only metadata. Result asserts the optimistic content (image base64)
  survives.
- Line 289: **"late full bootstrap seed does not remove optimistic rows or
  reorder local messages"**.
- Line 329: **"bootstrap seed reconciles optimistic rows to confirmed rows
  under the same client key"** — the canonical proof. First seed has
  `messageId:"client:turn-1", isOptimistic:true, sendStatus:"sending"`,
  `__openclaw.clientMessageId:"turn-1"`. Second seed has
  `messageId:"gateway-turn-1", isOptimistic:false`,
  `__openclaw.clientMessageId:"turn-1"`. Assertion: final state has ONE
  message, `messageId:"gateway-turn-1"`, no `sendStatus`.
- Line 3741: **"never drops optimistic tail rows even when bottom drop
  requested"** — proves `trimSessionMessageWindow` respects
  `isOptimistic`/`sendStatus`/`animateText` protected rows
  (store.ts:2247–2255).

**Critical**: ChatView's `handleSend` does NOT call `seedGlobalChatSession`
with the optimistic row. So today the optimistic bubble exists only in
ChatView local state until the confirm patch arrives, then ALSO in the
store via its own patch subscription. Until confirm, the store knows
nothing of the optimistic row. Any feature that reads the store (e.g.
sidebar previews of "latest sent") will not see the optimistic message.

---

## 6. Divergence risks (ChatView local ↔ store) — TODAY

Concrete divergence points, with evidence:

### (a) Pre-confirm optimistic rows
**Where**: index.tsx:1395–1404 inserts optimistic row into local state with
no store write. Store learns about it only when `chat.user.confirmed` /
`chat.message.confirmed` arrives. **Effect**: `getGlobalChatSession(key)`
returns N messages, `state.messages` shows N+1. Window:
`Date.now()`–`network round-trip` worst case 1–2s.

### (b) Different patch starting cursors
**Where**:
- Store: `globalCursor` starts at the value loaded from
  `patchCursorStorageKey()` (store.ts:62–68), restored from localStorage on
  app load.
- ChatView: subscribes with `streamCursor` (index.tsx:1077) which is
  initialized to `null` and set to the cursor returned by the **history
  fetch** in the bootstrap effect (index.tsx:887, 956, 2402) — so it tracks
  the per-session history cursor.

These can drift: in the registry-hydrate fast path (index.tsx:835), ChatView
sets `streamCursor = hydrateFromRegistry.streamCursor ?? 0`. If the store's
`globalCursor` is ahead (it processes patches across all sessions), patches
that arrived between the registry snapshot and the new ChatView subscription
will be replayed by store but possibly skipped by ChatView's later
subscription (the `subscribeChatPatches` semantics are "stream from cursor
N onward" — older patches are dropped).

### (c) Window eviction differences
**Where**: ChatView's `MAX_LOADED = 160` (messageWindow.ts:13) caps its
local `state.messages.length`. The store has **no per-session length cap**
(unless `trimSessionMessageWindow` is invoked, which it never is from
ChatView today; the only caller is tests).

**Effect**: after a long-running session, the store may hold thousands of
messages while ChatView shows 160. The two arrays disagree on what
constitutes "messages[i]" at every index.

### (d) Evicted-patch drop
**Where**: index.tsx:1100–1118. When the user scrolls into older history
(`windowStateRef.current.hasNewer = true`) and the patch's cursor is past
the loaded window, `shouldDropPatchAsEvicted` returns true and ChatView
returns WITHOUT calling `setState` — but `cursorRef.current` is advanced
(index.tsx:1093). The store, however, applies the patch to ITS messages
array (store.ts:1795–1808). Consequence: store has the new assistant
message, ChatView UI does not, until the user clicks "jump to latest" and
`resetToLiveTail` re-fetches. (This is intentional; the divergence is
correct behavior given the design — but it IS a divergence.)

### (e) Bootstrap timing race
**Where**: The store may receive `chat.bootstrap` frames out of order with
ChatView's `fetchChatMessagesV2(...).then(setState)`. ChatView's bootstrap
fires at mount (index.tsx:756); the store's bootstrap is dispatched
whenever the WS layer delivers a bootstrap frame. If the WS bootstrap lands
AFTER the HTTP history fetch resolves but BEFORE the patch subscription
catches up, ChatView's `state.messages` and store `messages` can disagree
for a brief window.

### (f) Status divergence — terminal-status suppression
**Where**: index.tsx:1190–1209 introduces
`shouldSuppressTerminalStatusDuringPendingUser(...)`. ChatView may suppress
a terminal status that the store accepts (or vice-versa). The store has its
own complex status state machine (store.ts:1751–1812) with
`shouldIgnoreTerminalToActiveStatus`, `shouldIgnorePostFinalActiveStatus`,
`shouldDeferBareDoneStatus`. The two filters are NOT byte-equivalent. Net:
`state.streamStatus` and store.status can disagree on whether the chat is
"thinking" vs "idle" at any moment during a turn.

---

## 7. Safe single-writer design (proposal)

### Goal
ChatView renders `messages`, `streamStatus`, `statusLabel` from the store.
Local React state retains only: `loading`, `error`, `composerError`,
optimistic-only echoes, scroll/window UI state, and pure-UI fields
(`pinnedIds`, `reactions`, `replyTo`, etc.).

### What gets DELETED from ChatView

1. **The patch-apply subscription block at index.tsx:1078–1313** (the
   `useEffect(subscribeChatPatches(streamCursor, …) …)`). This is the
   second writer. All of its responsibilities (apply patch → derive
   messages, derive status, derive statusLabel) are already done by the
   store on identical input frames.
2. **`HistoryState.messages / streamStatus / statusLabel`** fields move
   out of `HistoryState`. Replace reads with a selector hook that wraps
   `subscribeGlobalChatSession(sessionKey, listener)` (already imported,
   index.tsx:19).
3. **The local `applyChatPatch` import** (index.tsx:17) is no longer needed
   in ChatView — only the store uses it.
4. **The `streamCursor` / `cursorRef.current` / `firstPatchLoggedRef`**
   state and effects (index.tsx:643, 1077, etc.) become dead code. The
   store owns the cursor.
5. **Live-append window eviction inside the patch-apply updater**
   (index.tsx:1217–1297) — moves out of the deleted updater. Eviction must
   happen elsewhere (see §"what MOVES" below).
6. **`shouldDropPatchAsEvicted` call** at index.tsx:1101 — moves to the
   selector layer (the hook returns the windowed slice of store messages,
   not all of them).
7. **`activeRunRegistry.publish` mirror effect** at index.tsx:1043–1062 —
   can be replaced by a store-level subscriber that publishes once per
   commit (the registry is fed by every session, not just the focused
   one; pushing this into the store is more correct anyway).
8. **The bootstrap-recovery handler at index.tsx:2540–2594** stays
   (resetToLiveTail still resets local UI state) but the
   `resetToLiveTail` body shrinks because it no longer needs to clear
   `state.messages`; it just clears UI gates (loading, error, window) and
   asks the store to re-bootstrap (via existing `seedGlobalChatSession`).

### What MUST move to the store (if anything)

The store ALREADY does everything needed for messages + status. The only
gap is **the per-session windowed view** that ChatView's `WindowState`
currently provides. Options:

**Option A** (preferred — minimal): keep `WindowState` and the data-window
math in ChatView (it's a UI concern), but make it project FROM the store's
full message list rather than maintain its own. Implementation: a
`useChatSessionMessages(sessionKey, windowState)` hook that:
- Subscribes to `subscribeGlobalChatSession(sessionKey, …)`
- Maintains `windowState` (oldest/newestLoadedSeq, hasOlder/hasNewer)
- Returns the slice of `storeState.messages` that falls within
  `[oldestLoadedSeq, newestLoadedSeq]`
- Live-append handling: when store grows past `newestLoadedSeq + 1`, if
  `hasNewer === false` slide window forward; else mark `hasNewer = true`
  and drop the patch from view (current `shouldDropPatchAsEvicted`
  semantics).

This keeps ChatView in charge of viewport-sized windowing without owning
the canonical state. The "evict from the start when length > MAX_LOADED"
becomes a pure projection from store messages, not a destructive trim of
local state.

**Option B**: collapse the two windowing modules into one and use the
store's `trimSessionMessageWindow`. This is more invasive: the store
would have to know which session is being viewed, and we'd lose the
ability to keep multiple windows on the same session (e.g. main +
sub-agent overlay).

Recommend **Option A**.

### Behaviors RISKY to preserve

1. **Optimistic send UX** (index.tsx:1395–1404). The local insert lights
   up the bubble in <16 ms. If we remove the local insert and instead call
   `seedGlobalChatSession({sessionKey, messages:[…optimistic], …})` first,
   the round trip is: setState in store → notify subscribers → React
   rerender. This is one extra microtask vs in-place setState. **Risk**:
   on slow devices an extra commit before the optimistic bubble appears.
   **Mitigation**: `seedGlobalChatSession` already uses `notifySync` (not
   the batched notify) — store.ts:2067. Should be ~indistinguishable.
   Verify with `chat-rebuild.send.optimistic-render` timestamp before/after.

2. **Optimistic reconciliation**: store's `mergeSeedMessages` is tested
   to match optimistic → canonical via `__openclaw.clientMessageId`
   (store.test.ts:329). ChatView's `handleSend` already mints
   `optimisticId` (index.tsx:1382) and threads `clientMessageId` through
   `sendChatV2` (index.tsx:1426). The store will reconcile when the
   confirm patch lands. **Risk**: optimistic `optimisticMessage` object
   built at index.tsx:1383–1393 does NOT carry the
   `__openclaw.clientMessageId` field that the merge logic uses. Must add
   that field on seed (or rely on `messageId === clientMessageId` matching
   — verify the merge codepath supports this).

3. **Scroll anchoring** (`captureFirstVisibleRowAnchor` + the layout
   effect that restores scroll on older-page resolve). This is purely DOM
   work tied to message-list mutations. Continues to work as long as
   ChatView still controls the message-list render. **Risk**: store
   notifications batch via rAF (store.ts: `batchRafId`), which may merge
   what used to be two separate React renders into one. Anchor restoration
   relies on `useLayoutEffect` firing AFTER the mutation; this still holds
   since the React commit is synchronous within the rAF tick.

4. **Sub-agent overlay** (already store-backed at index.tsx:1654–1668).
   No change needed.

5. **Status filtering** (e.g. `shouldSuppressTerminalStatusDuringPendingUser`
   at index.tsx:1190–1209). This filter is currently applied AFTER
   `applyChatPatch` in ChatView. If ChatView reads from store, this filter
   must move into the store OR be replaced by a selector. The store
   ALREADY has analogous filters (`shouldIgnoreTerminalToActiveStatus`,
   `shouldIgnorePostFinalActiveStatus`, store.ts:1751–1761) so this is
   probably redundant — verify by reading the suppression conditions in
   detail before deleting. **Risk**: if the two filter sets are not
   equivalent, we'll get visible "thinking ↔ idle" flicker on certain
   patch sequences. This needs a test before merge.

6. **Composer error and loading**: pure UI locals, keep in ChatView.

---

## 8. Verification gaps

This host: **3.7 GB RAM, no swap.** A production Next build (`next build`)
OOMs (verified previously). Things that CAN and CANNOT be verified:

### Verifiable here (unit / lib tests + dev server)

- All of `lib/chat-engine-v2/applyPatches.ts` behavior (pure).
- All of `lib/chat-engine-v2/store.ts` behavior (already covered by
  `store.test.ts` — 3800+ lines of tests).
- The proposed `useChatSessionMessages` hook in isolation (can be unit
  tested with React Testing Library + a fake `subscribeGlobalChatSession`).
- Optimistic seed/merge correctness (existing store.test.ts proves it).
- `messageWindow.ts` math (pure; testable).
- `bootstrapRecoveryGuard` / `decideBootstrapRecovery` (pure).
- Dev-server runtime: open Next in `next dev`, click through a chat,
  verify SSE patches arrive, optimistic bubble appears, scroll-up
  triggers older fetch. Dev mode runs fine on this host.

### NOT verifiable here (production build / E2E only)

- Production bundle size impact (deleting the patch subscription should
  shrink bundle ~5 KB minified; can't measure without `next build`).
- StrictMode double-invocation behavior in PROD React (StrictMode is a
  dev-only feature; the impurity bug is dev-mode only — but it can mask
  bugs that surface elsewhere in prod under concurrent rendering).
- React concurrent-mode tearing under heavy patch load — only reliably
  reproducible at 60+ FPS with realistic frame budgets, which requires a
  prod build.
- Performance regression from store-batched notifications during a
  high-throughput streaming run (many sub-millisecond patches). The store
  batches via rAF; the deleted ChatView path applied patches immediately.
  Real timing comparison needs a prod build under a representative load.
- Memory profile of holding the full session in store vs windowed in
  ChatView. With store growing unbounded today (no `trimSessionMessageWindow`
  caller), a session with 10 K messages already holds them all in store
  memory — this change just removes the second copy in ChatView. Net
  memory should drop, but quantifying needs the heap snapshot tooling on
  a real desktop build.
- Cross-tab / multi-window behavior of the activeRunRegistry mirror move.

### Minimum E2E test that would catch a regression
1. Cold start, type message → optimistic bubble visible within 50 ms.
2. Wait for streaming response → assistant text streams in token by token,
   `streamStatus` flips `thinking → streaming → idle`.
3. Scroll to top of a session with > 200 messages → older page loads,
   newer page evicted, scroll anchor stable (no visible jump).
4. Send a second message while the first is still streaming → second is
   queued (composer disabled or in queue state).
5. Switch away to another chat mid-stream, come back → registry hydrate
   shows the still-streaming bubble; no skeleton flash.
6. Force a WS reconnect (close socket) → `bootstrap-recovery` event;
   guard suppresses the second skeleton; messages restored.

(1)–(2) work in dev. (3)–(6) need a real backend; only (3) is
reproducible against the dev server with a seeded session.
