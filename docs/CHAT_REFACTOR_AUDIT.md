# CHAT_REFACTOR_AUDIT.md

Read-only architectural audit of the chat subsystem on `master` (HEAD `6b482e7c`).
Goal: root-cause the reported chat bugs and propose a staged consolidation
onto `chat-engine-v2` as the single source of truth. **No code changes.**

All citations are `path:line`. Where line numbers refer to file regions that
were excerpted during the audit they are accurate as of the cited HEAD; if a
hotfix lands the audit must be re-anchored.

---

## 0. TL;DR

The chat subsystem has **three independent live patch pipelines** mutating
**three independent message stores**, all fed by **three independent
WebSocket connections** to the *same* `PatchBus`. The UI then derives state
from a mix of these stores via captured-at-mount snapshots, reactive
subscriptions, and reconcile fetches. The reported flicker, jumping,
streaming-break, lagging-tool, and multi-session bugs all sit on top of this.

* Three call sites of `applyChatPatch` (ChatView, store, runWatcher).
* Three concurrent WebSockets per mounted chat (ChatView own + global store + runWatcher).
* Three `messageWindow` modules (`ChatView/messageWindow.ts`,
  `chat-engine-v2/messageWindow.ts`, and `useChatMessages.ts` window plans).
* One 3,041-LOC component, one 3,555-LOC hook that is fully **dead code**.
* Multiple parallel UI variants (`assistant-ui/`, `vercel-ui/`,
  `chat-rebuild-preserved/`) — none of them wired into the live render path.

The good news: the live render path is much smaller than the file tree
suggests, because most of the parallel surfaces are dead. Stage 0 of the
consolidation is dominated by deletion, which removes huge amounts of
cognitive load with no behavior risk.

---

## 1. End-to-end data flow (as-built)

### 1.1 Server → wire

```
                       ┌───────────────────────────────────────────────┐
                       │  apps/middleware/src/features/chat/            │
Gateway/Anthropic ──▶  │  live.ts  (1208 LOC)                           │
                       │   • subscribes to gateway events               │
                       │   • normalizes/dedupes user echoes (idem keys) │
                       │   • broadcasts patches via context.patchBus    │
                       │   • broadcastLiveAssistantText / Reasoning     │
                       │   • broadcastRunStatus                         │
                       └──────────────┬────────────────────────────────┘
                                      │ context.patchBus.broadcast(...)
                                      ▼
                       ┌───────────────────────────────────────────────┐
                       │ apps/middleware/src/features/patches.ts        │
                       │   PatchBus (one bus, one fan-out)              │
                       │   GET /api/stream/ws       (WebSocket)         │
                       │   GET /api/patches         (HTTP backfill)     │
                       │   sends `hello` w/ replayCount, replayWindowExceeded │
                       └──────────────┬────────────────────────────────┘
                                      │ JSON frames { type:"patch"|"hello", patch:{cursor,sessionKey,type,payload,createdAtMs} }
                                      ▼
```

### 1.2 Wire → UI

```
                       openPatchStreamV2(afterCursor, onFrame)   // packages/ui/lib/chat-engine-v2/client.ts:235
                          ▲           ▲            ▲
                          │           │            │
                          │           │            │  (three independent callers,
                          │           │            │   three independent WebSockets,
                          │           │            │   same backend PatchBus)
                          │           │            │
   ChatView/index.tsx ────┘           │            └──── runWatcher.ts:172  (global, persistent)
   line 1079                          │
                                      │
                          store.ts:1991  (global, persistent — opened lazily on first subscribeGlobalChatSession)
```

The three pipelines are:

| Pipeline | Source | Patch sink | Visible to |
| -------- | ------ | ---------- | ---------- |
| **ChatView own SSE** | `openPatchStreamV2(streamCursor, …)` `index.tsx:1079` | `setState({messages: applyChatPatch(...)})` `index.tsx:1075-1199` | Foreground chat render |
| **Global store SSE** | `openPatchStreamV2(globalCursor, handleFrame)` `store.ts:1991` | `applyChatPatch(state, frame)` `store.ts:1804` | `useAgentActivity`, `useSubagentMessages`, `subagent panels`, sidebar (via `getGlobalChatSession`) |
| **runWatcher SSE** | `openPatchStreamV2(lastSeenCursor, …)` `runWatcher.ts:172` | `applyChatPatch({...}, frame)` `runWatcher.ts:112`, then `activeRunRegistry.publish(...)` | `activeRunRegistry` → sidebar generating flag, ChatView remount hydration |

ChatView additionally **publishes** its own state into `activeRunRegistry`
on every render-relevant change (`index.tsx:1043-1062`).

### 1.3 ChatView local data flow

```
sessionKey prop changes ──▶ useEffect "bootstrap" (index.tsx:737)
                              │
                              │  1. hasOptimisticBootstrap?  → seed from initialMessages, skip fetch
                              │  2. hydrateFromRegistry?     → seed from activeRunRegistry.get(sessionKey),
                              │                                also fire a background "reconcile" fetchChatMessagesV2
                              │  3. else                     → setState{loading:true}; fetchChatMessagesV2
                              ▼
                          ┌─────────────────────────────────────┐
                          │ openPatchStreamV2(streamCursor) (1079) │◀── streamCursor state
                          │   per-frame:                             │
                          │     - patchBelongsToSession check        │
                          │     - cursor monotonic guard             │
                          │     - shouldDropPatchAsEvicted           │
                          │     - applyChatPatch + orderChatMessages │
                          │     - setState({messages,streamStatus})  │
                          └─────────────────────────────────────────┘
                              │
                              ▼
                          state.messages ─▶ orderChatMessages ─▶ messageRowKey/messageListKeys ─▶ JSX rows
```

In parallel ChatView also subscribes to **the global store** for the same
sessionKey (`index.tsx:1652-1667`) to read `spawnedSubagents`, which means
the same patch is applied (a) into ChatView's own `state.messages` via
ChatView's WS, and (b) into the global store's `SessionState.messages` via
the store's WS — they coexist and are kept "almost" but not exactly in
sync (ordering, dedupe, and live-tool-merge rules differ between
`applyChatPatch` callers because of the pre/post processing each call site
layers on).

---

## 2. Where each symptom originates

### 2.1 Patches applied in multiple places (root cause for flicker + duplication)

| # | Site | Output sink | Notes |
| - | ---- | ----------- | ----- |
| 1 | `packages/ui/components/ChatView/index.tsx:1138` (`setState` inside SSE handler) | ChatView local `state.messages` | The only one that drives the foreground render |
| 2 | `packages/ui/lib/chat-engine-v2/store.ts:1804` (`applyChatPatch` inside `handleFrame`) | Global store `SessionState.messages` | Drives subagent panels, activity tab, sidebar generating, hooks consumers |
| 3 | `packages/ui/lib/chat-engine-v2/runWatcher.ts:112` (`applyChatPatch` inside `handlePatch`) | `activeRunRegistry` snapshot | Drives remount hydration + sidebar |

The same wire patch is therefore applied **three times** in three slightly
different reducer environments. Differences observed at the call sites:

* ChatView wraps with `orderChatMessages(patched.messages)` then puts it
  into React state (`index.tsx:1145`).
* Store wraps the result with `preserveActiveTurnToolTranscript` while a
  run is active, and with `finalizePreviousRunningToolsForNewTurn` on
  user-message patches (`store.ts:1806-1810`).
* runWatcher wraps with a custom `sortByGatewayIndex` (`runWatcher.ts:39`)
  but no order-chat / no dedupe / no preserveActiveTurn.

These three reducers therefore **diverge** on edge cases (out-of-order
tool patches, terminal-then-late-delta, replays). Whenever ChatView
remounts and hydrates from `activeRunRegistry` (which was produced by
the runWatcher reducer), then re-applies its own subsequent patches via
its own SSE, the resulting messages array can be visibly different from
what was on screen the instant before the unmount — **manifests as
flicker and jumping on session-switch back-and-forth.**

### 2.2 Message order and identity / key instability

* Ordering authority is split:
  - `ChatView/orderChatMessages.ts` (24 LOC) — `gatewayIndex` then
    `createdAt` then array index. Used **only** by ChatView (`index.tsx:225`,
    `index.tsx:1146`, etc.).
  - `runWatcher.ts:39 sortByGatewayIndex` — `gatewayIndex` only, no
    timestamp tiebreak. The pre-hydration ordering can therefore disagree
    with ChatView's post-mount ordering, producing a 1-frame reorder on
    remount.
  - `chat-engine-v2/store.ts` does **not** call either — the store relies
    on `dedupeChatMessages` to keep order; in practice the order is
    determined by insertion order from `applyChatPatch`.
* Identity authority is split:
  - `messageRowKey.ts:38` — `messageId` only, used **by ChatView**.
  - `chatStableIds.ts:104` — `runId`-coalescing `uiId` scheme. Used
    **only by dead `vercel-ui/timeline.ts:7`**. The presence of the file
    suggests a previous architectural intent that was abandoned and never
    deleted — **active confusion**.
* `messageListKeys` (`messageRowKey.ts:74`) does a final dedupe pass so
  that two rows with the same `messageId` get suffixed keys (`id`, `id#1`).
  This is "last line of defense" code and the comment at lines 64-72
  explicitly says it should never trigger. When it does trigger
  (live-during-stream), React unmount/remount happens for the
  ambiguous row → **visible blink in the streaming bubble.** Common
  cause is the merge between `live:${runId}:assistant` and the canonical
  `assistant-final` rows: `mergeToolOnlyAssistantMessages` in
  `applyPatches.ts:723` and `assistantRowsAreSameTurn` in
  `chatStableIds.ts:90` use **different** equality semantics, so the
  upstream dedupe can leave a brief window with both rows present.

### 2.3 Virtualization / windowing ownership

Three windowing modules exist:

| File | LOC | Consumed by | Status |
| ---- | --- | ----------- | ------ |
| `packages/ui/components/ChatView/messageWindow.ts` | 276 | `ChatView/index.tsx` | **Live** |
| `packages/ui/components/ChatView/viewportWindow.ts` | 140 | only its own test | **Dead** |
| `packages/ui/lib/chat-engine-v2/messageWindow.ts` | 196 | only `useChatMessages.ts` (which is dead) | **Effectively dead** |

There are not "two competing window implementations actually running" —
only `ChatView/messageWindow.ts` actually runs. But the **store** has
its own implicit window bookkeeping via `trimSessionMessageWindow` in
`store.ts` and `historyCoverage` projection. So while the foreground
window math is single-sourced, the **store-side window** evolves
independently and feeds reattachment hydration with a different shape
than the foreground knows about (`store.ts:2186` comment acknowledges
this dependency). On reattach (`index.tsx:794-916`) the foreground
re-derives `applyInitialPage` from registry seedMessages and then runs
a background reconcile fetch that can swap to a different page — visible
as a flash.

Scroll-anchor logic for prepend/append lives only in `ChatView/index.tsx`:

* `pendingScrollAnchorRef` capture: `index.tsx:2020-2050`
* Restore in `useLayoutEffect`: `index.tsx:2637-2664`
* Programmatic-scroll re-entrancy guard: `index.tsx:2654` (sets
  `isProgrammaticScrollRef.current = true` and clears it on `setTimeout 0`).

Race window: the layout effect depends on `state.messages` only. When
both the ChatView WS and the global-store WS land patches in the same
React batch, `state.messages` can update twice within one paint and the
anchor restoration runs on the **second** snapshot, but the
`anchorMessageId` was captured for the **first**, so the offset
calculation can be off — **manifests as a small jump (10-100px) when
scrolling near a page boundary while a stream is also running.**

### 2.4 Cache layers and staleness

* `pageCache.ts` (120 LOC) — used **only by dead** `useChatMessages.ts`.
* `bootstrapPreview.ts` (37 LOC) — used **only by dead**
  `useChatMessages.ts`.
* `timelineStore.ts` (394 LOC) — used **only by dead**
  `useChatMessages.ts` (and its own integration tests).
* `bootstrapRecoveryGuard.ts` (136 LOC) — **live**, used by
  `ChatView/index.tsx:99`.

The actually-live cache layers are:

| Layer | What it stores | Eviction |
| ----- | -------------- | -------- |
| `activeRunRegistry` | Last-published full snapshot per sessionKey | Cleared on terminal + explicit `releaseTerminal`, otherwise sticky |
| Global store `states` (`store.ts`) | `SessionState` per sessionKey | Sticky, `trimSessionMessageWindow` shrinks per-session messages |
| ChatView local `state.messages` | Foreground view only | Per-mount; thrown away on unmount |
| TanStack Query caches (sessions list etc.) | Out of scope | n/a |

The "live cache updates not reflecting" reports almost certainly come
from the divergence in §2.1: the global store sees the patch and
publishes; ChatView's own SSE may have **dropped** the same patch via
`shouldDropPatchAsEvicted` (`index.tsx:1099-1118`) because its window
state thinks the patch is past the loaded tail. Then a subagent
sub-render or the sidebar reflects new state but the main message list
doesn't, until the user scrolls/refetches.

`bootstrapRecoveryGuard.ts` adds two debounce stamps
(`lastBootstrapRecoveryAtRef`, `lastBootstrapCompletedAtRef` —
`index.tsx:693, 705, 715`), which are heuristic time windows. When two
recovery events fire within the heuristic, one is swallowed and the
foreground can latch onto a stale window. Replay-window-exceeded `hello`
frames (`patches.ts:152`, `client.ts:289`) are the main producer.

### 2.5 Streaming text animation breakage

`useStreamingText.ts` (199 LOC). Sequence in the effect (`useStreamingText.ts:75-185`):

1. Reads `target`, recomputes whether to animate (`canAnimate`).
2. If `!target.startsWith(displayRef.current)` → **stops animation and
   re-seeds** `displayRef` to a fresh prefix (lines 131-138). Any patch
   that delivers a *replaced* text rather than a strict append (which
   can happen when `applyChatPatch` merges a live partial with a final
   canonical that has a different rendering of the same content, or
   when `preserveActiveTurnToolTranscript` reshuffles message order)
   resets the display → **stutter / restart of the animation.**
3. `commitState` uses `queueMicrotask` to setState (lines 80-86), but
   `step` (`useStreamingText.ts:147`) calls `setDisplay` synchronously
   inside RAF. Asymmetric scheduling → a frame where `display` and
   `isRevealing` are inconsistent → **micro-flicker.**
4. Reduce-motion path bypasses animation entirely but still calls
   `completeRef.current?.()` (lines 103-115). If the message is
   re-rendered with `streaming=true` again after that, animation does
   not restart because the completion already fired —
   **animation looks "dead" for the remainder of the message** until
   the message is unmounted.

Also: the *trigger* for animation is `message.animateText === true`
(`index.tsx:1910` comment), which is set by `applyChatPatch` only on
specific patch types. On registry-hydration reattach (`index.tsx:794-916`),
seedMessages from the registry already have `animateText` cleared (the
registry snapshot is the post-animation state) → **streaming bubble
appears already settled with no reveal animation**, then the next
delta patch sets `animateText:true` and the animation jerks into life
mid-message.

### 2.6 Race conditions

* **Optimistic ↔ confirmed user**: `chatSendIdempotencyKey` (`idempotency.ts`)
  is the only correlation key. `applyChatPatch` removes the optimistic by
  `optimisticId` (`applyPatches.ts:708-714`) and inserts the canonical.
  If a *different* patch (subagent text update) lands between the send
  and the gateway echo and ChatView re-renders in between, the optimistic
  row's `messageId` is still present and the merge sees it as a normal
  user message — for one render the user sees **both** their optimistic
  bubble and the gateway's canonical user bubble. `dedupeChatMessages`
  collapses this on the next reducer pass, but the intermediate render is
  visible.
* **Active-run lifecycle**: `activeRunRegistry.publish` is called from
  both ChatView (`index.tsx:1045`) and `runWatcher.ts:155`. The two
  writers don't coordinate; the registry just last-write-wins per field.
  Sidebar therefore sees a `streamStatus` value that ping-pongs between
  ChatView's view and runWatcher's view during the millisecond after a
  patch lands on both WS connections — **sidebar spinner blinks** in
  rare cases.
* **WebSocket reconnect / epoch reset**: `client.ts:289` handles the
  `replayWindowExceeded` hello by dispatching a
  `openclaw:chat-bootstrap-recovery` DOM event. **Three** stream openers
  receive their own copy of this event; each one re-runs its bootstrap.
  ChatView listens for the event (search `bootstrap-recovery` in
  `index.tsx`) and runs `resetToLiveTail` which can rebuild the foreground
  while the global store rebuilds the per-session SessionState
  independently. **Multi-second blank during reconnect** in long sessions.
* **Multi-session focus switches**: ChatView is keyed by `chatId:sessionKey`
  in `AppPage` so a switch unmounts+remounts. The chain on remount is:
  1. Snapshot `hasOptimisticBootstrap` and `hydrateFromRegistry` at mount
     time (`index.tsx:572, 587`).
  2. If hydrating from registry: setState with registry snapshot,
     **and** fire background reconcile fetch (`index.tsx:826-916`).
  3. Open new SSE at the registry cursor.
  4. Reconcile fetch may land before, after, or interleaved with the
     first patch from the SSE; the merge between reconcile and live SSE
     is implicit (last setState wins; cursor comparison guards the
     SSE path, but the reconcile path uses `freshCursor > reattachCursor`
     and **replaces** messages wholesale (`index.tsx:894-906`)). If a
     live patch landed between the registry snapshot and the reconcile
     resolve, it gets **stomped**.

Net effect: switching away mid-run, switching back: depending on
timing, you may briefly see the registry snapshot, then a flicker to
the reconcile result (losing a recent delta), then the SSE resumes —
**the canonical reproduction of "messages jumping / blinking on
session switch."**

---

## 3. Dead-code and redundancy catalog

### 3.1 Provably-dead variant directories (no imports anywhere)

| Path | LOC (approx) | Verified by |
| ---- | ------------ | ----------- |
| `packages/ui/components/ChatView/assistant-ui/` | ~ | `grep -rn "OCPlatformAssistantThread\|assistant-ui" packages/ apps/` → only inside the directory itself |
| `packages/ui/components/ChatView/vercel-ui/` | ~ | `grep -rn "OCPlatformVercelChat\|vercel-ui"` → only inside the directory itself |
| `packages/ui/components/chat-rebuild-preserved/` | ~ | `grep -rn "chat-rebuild-preserved"` → only inside the directory itself (a `LegacyChatViewIndex.tsx.snapshot` lives here) |

### 3.2 Files that are reachable only from other dead code

| File | LOC | Reachable only from |
| ---- | --- | ------------------- |
| `packages/ui/hooks/useChatMessages.ts` | **3,555** | only tests (`useChatMessages.reconcile.test.ts`); the function `useChatMessages(...)` is **never called from non-test code** (`grep -rn "useChatMessages(" ` → only the export declaration line) |
| `packages/ui/hooks/useChatMessageSlice.ts` | — | only the export declaration; **no callers** |
| `packages/ui/lib/chat-engine-v2/messageSlice.ts` | 278 | only `useChatMessageSlice.ts` (dead) + its own tests |
| `packages/ui/lib/chat-engine-v2/messageWindow.ts` | 196 | only `useChatMessages.ts` (dead) + its own tests |
| `packages/ui/lib/chat-engine-v2/pageCache.ts` | 120 | only `useChatMessages.ts` (dead) + its own tests |
| `packages/ui/lib/chat-engine-v2/timelineStore.ts` | 394 | only `useChatMessages.ts` (dead) + its own tests |
| `packages/ui/lib/chat-engine-v2/bootstrapPreview.ts` | 37 | only `useChatMessages.ts` (dead) + its own tests |
| `packages/ui/components/ChatView/chatStableIds.ts` | 163 | only `vercel-ui/timeline.ts` (dead) + own test (`chatStableIds.test.ts`) |
| `packages/ui/components/ChatView/viewportWindow.ts` | 140 | only its own test |
| `packages/ui/components/ChatView/chatHistoryAutoLoad.ts` | 37 | only `vercel-ui/` (dead) + own test |

Total provably-dead LOC under `packages/ui`: **≈ 5,000+ lines** of TS
that contribute nothing to the running product but soak up reading
time and confuse new contributors. Stage 0 deletes all of this.

### 3.3 Overlapping live logic between `ChatView/index.tsx` and `chat-engine-v2/store.ts`

ChatView re-implements, in component-local code, things the store
already does:

| Behavior | ChatView/index.tsx | store.ts |
| -------- | ------------------ | -------- |
| Apply patch → new messages | `1138-1145` (uses `applyChatPatch`) | `1804` (uses `applyChatPatch`) |
| Track stream status | `1187-1191` (`patchImpliesActiveRun ? "thinking" : null`) | `1747-1801` (full status machine with deferral, post-final guard) |
| Active-run snapshot for re-mount | `activeRunRegistry.publish` `1045` | `getGlobalChatSession` exposes equivalent |
| Subagent derivation | `subagentDerive.deriveSpawnedSubagents` consumed via `derivedSubagents` `index.tsx` | `spawnedSubagents` already on `SessionState` |
| Optimistic ↔ confirmed | implicit via `applyChatPatch`'s `idsToReplace` | identical |
| Tool transcript preservation | none | `preserveActiveTurnToolTranscript` `store.ts:1098-1259` (active turn only) |
| Ordering | `orderChatMessages` `225` | implicit insertion order + `dedupeChatMessages` |

The store does **more** than ChatView's local reducer does, but
ChatView **does not consume** the store. So the store's smarter
post-processing only helps the subagent panel; the foreground view
sees the simpler, more bug-prone path.

---

## 4. Staged consolidation plan

Single principle for the whole plan: **`chat-engine-v2` is the single
source of truth, and the foreground view subscribes to it.** Patches
are applied in exactly one place. Other consumers read derived state
through documented selectors.

Each stage is independently shippable. Stage 0 is delete-only and has
no behavior risk.

### Stage 0 — Delete dead code, write characterization tests

* **Scope**
  * Delete `packages/ui/components/ChatView/assistant-ui/`,
    `vercel-ui/`, `packages/ui/components/chat-rebuild-preserved/`.
  * Delete `packages/ui/hooks/useChatMessages.ts` and its tests
    (`useChatMessages.reconcile.test.ts`); also delete
    `useChatMessageSlice.ts` and the cluster of helpers used only by
    them (`messageSlice.ts`, `messageWindow.ts` under
    `chat-engine-v2/`, `pageCache.ts`, `timelineStore.ts`,
    `bootstrapPreview.ts`, `chatStableIds.ts`, `viewportWindow.ts`,
    `chatHistoryAutoLoad.ts`) and their tests.
  * Delete the `LegacyChatViewIndex.tsx.snapshot`.
* **Add characterization tests (vitest) that lock current good behavior:**
  1. **Optimistic-send echo dedup**: one `applyChatPatch` test that
     sends an optimistic user, then a canonical user with the same
     `optimisticId`, asserts exactly one user row with the canonical id.
  2. **Out-of-order tool patches**: tool start → tool result with
     `cursor` arriving in reverse order, assert final state matches
     in-order.
  3. **Live → final assistant merge** with no text duplication
     (`applyPatches.test.ts` already covers some of this — extend to
     the `live:${runId}:assistant` → `assistant-final` transition).
  4. **Registry snapshot ↔ reconcile fetch wins**: simulate
     `activeRunRegistry.publish` then a reconcile that returns the
     same content; assert ChatView setState is idempotent.
  5. **Streaming text strict-prefix invariant**: a fuzz test that
     applies a sequence of assistant deltas and asserts the cumulative
     `text` is always a prefix-extension (no replacement).
  6. **`messageListKeys` uniqueness** across the full
     optimistic/confirmed/replay lifecycle (extend existing
     `messageRowKey.test.ts`).
  7. **WebSocket reconnect**: mock `openPatchStreamV2` to emit a
     `hello{replayWindowExceeded}` and assert that the foreground
     resets exactly once even when three opener-callbacks exist.
* **Invariant established**: no behavior change, but the codebase shrinks
  by ≈5,000 LOC and we have a regression net for stages 1+.
* **Risk**: very low. Only deletions; if a path is still wired it will
  fail typecheck.
* **Verify**: `pnpm -w typecheck`, `pnpm -w test`, manual smoke (new
  chat → send → reply, switch sessions during a run).

### Stage 1 — Collapse `applyChatPatch` to exactly one call site

* **Scope**
  * Make the **global store** the only place that calls `applyChatPatch`.
  * `runWatcher` becomes a **status-only** consumer: it reads
    `statusFromPatch`/`patchImpliesActiveRun`, updates
    `activeRunRegistry` lifecycle fields (`streamStatus`, `statusLabel`,
    `streamCursor`), and **stops mutating `messages`**. (The store is
    the writer for messages; the registry reads from the store on
    reattach.)
  * ChatView's per-mount SSE handler stops calling `applyChatPatch`
    locally. It instead **subscribes to the global store** for
    `sessionKey` and renders from `getGlobalChatSession(sessionKey).messages`.
  * ChatView keeps `streamCursor`/loading bookkeeping local (UX state)
    but messages, streamStatus, statusLabel come from the store.
* **Files touched** (foreground): `index.tsx` (large rewrite of the
  patch-handler effect block at `1075-1199`), `runWatcher.ts`,
  `activeRunRegistry.ts` (no longer needs `messages` field — but keep
  for one release for safe fallback).
* **Invariant established**: **patches are applied in exactly one
  place**, and the foreground render is a *projection* of store state.
* **Risk**: moderate. The store currently doesn't run
  `orderChatMessages`; we have to either (a) run order/dedupe inside
  the store after every `applyChatPatch` mutation, or (b) push
  `orderChatMessages` into a selector that the foreground subscribes to.
  Option (b) is safer because it keeps the store output identical for
  existing consumers (subagent panels, activity tab).
* **Verify**: characterization tests from Stage 0 + a new test asserting
  ChatView and the store agree on `messages` for every patch sequence.
  Manual: long stream, session switch mid-stream, multi-session
  concurrent runs.

### Stage 2 — Collapse WebSockets to one

* **Scope**
  * Remove the per-ChatView `openPatchStreamV2(streamCursor, …)` call
    at `index.tsx:1079`.
  * Remove the runWatcher's own `openPatchStreamV2` (`runWatcher.ts:172`).
  * Keep the **global store**'s `openPatchStreamV2` (`store.ts:1991`)
    as the only WebSocket. Wire `activeRunRegistry` and ChatView to it
    via store subscriptions.
  * `ensureGlobalChatEngine` already ref-counts; lifecycle should now
    be: connect on first non-zero subscriber, disconnect on zero (with
    a short grace period to absorb session-switch unmount→remount).
* **Invariant established**: **one WebSocket per browser**, and
  reconnect storms cannot fan out into three parallel resets.
* **Risk**: moderate-to-high. The current per-ChatView SSE pinned the
  cursor to ChatView's mount lifecycle, which let the foreground
  rebuild cleanly on session switch. The global store's cursor is
  monotonic and global; we have to verify that a session-switch
  doesn't lose any patches that were already enqueued in the store
  but not yet read by the foreground (it shouldn't, because we
  subscribe synchronously; but this is the riskiest interaction).
* **Verify**: a vitest integration test that opens two `useChatStore`
  consumers in parallel and asserts a single `openPatchStreamV2` call
  in the mock. Manual: pull network for 60s in DevTools, restore;
  assert exactly one reconnect + one replay, not three.

### Stage 3 — Single ordering / identity rule

* **Scope**
  * Move `orderChatMessages` and `dedupeChatMessages` to run **inside
    the store reducer** as the final step of every state update.
  * Delete `runWatcher`'s `sortByGatewayIndex` (no longer needed; it
    no longer writes messages anyway).
  * Centralize the **row key** on `messageId` + `chatStableIds`-style
    `runId` coalescing, **but only after** confirming the
    `live:${runId}:assistant` ↔ canonical merge in `applyPatches.ts`
    is the actual deduplication authority. The "last line of defense"
    in `messageListKeys` becomes a `process.env.NODE_ENV === "production"`
    assertion (collapsed in dev, throws in test, no-op in prod) so we
    catch regressions early instead of papering over them.
* **Invariant established**: **one row → one stable key for the entire
  optimistic→confirmed→replay lifecycle**, asserted at the store level.
* **Risk**: moderate. We're already in this regime *in practice*, but
  the invariant is currently only enforced by defensive code; making
  it a real assertion will expose any latent bug we've been hiding.
* **Verify**: extend `applyPatches.test.ts` with the exhaustive
  lifecycle test; add a property test for `(applyChatPatch ∘
  permutation-of-frames)` → same final `messageId` set.

### Stage 4 — Window math single-sourced; scroll anchor robust to mid-flight patches

* **Scope**
  * Move window state (`oldestLoadedSeq`, `newestLoadedSeq`,
    `hasOlder`, `hasNewer`, etc.) **into the store** so older/newer
    page fetches and the SSE stream agree on what's loaded.
  * Foreground keeps DOM-level scroll anchor; but the
    `pendingScrollAnchorRef` capture & restore both observe the
    *store-level* `messages` (selector subscription), not React state.
    React state is the rendered projection.
  * `shouldDropPatchAsEvicted` becomes a store-side filter, applied
    once.
* **Invariant established**: **the loaded window is one fact, owned by
  the store**. ChatView projects it; older/newer fetches request it
  via store actions.
* **Risk**: moderate. Touches the most user-visible behavior (paging
  near the boundary). Mitigation: enable behind a feature flag, A/B
  with the existing behavior.
* **Verify**: existing `messageWindow.test.ts` (64 tests) becomes the
  spec; add tests for "patch arrives during older-page fetch", "evict
  during patch", "reconnect during paging".

### Stage 5 — Streaming text animation: prefix-only invariant

* **Scope**
  * Guarantee at the **store level** that for a given live assistant
    row, `text` is monotonic-by-prefix during the run. If the store
    has to apply a non-prefix update (e.g., terminal final replaces
    partial live text with a slightly different render), it does it as
    a single atomic swap *after* setting a "finalized" flag on the
    message — `useStreamingText` then knows the swap is intentional
    and runs a fade-in instead of restarting the typewriter.
  * Make `commitState` and the RAF `step` in `useStreamingText.ts`
    both go through the same setter (drop the `queueMicrotask` /
    direct `setDisplay` asymmetry).
* **Invariant established**: **streaming text never restarts mid-run.**
* **Risk**: low. Local change to `useStreamingText.ts`; store-side
  invariant is a single check.
* **Verify**: extend `useStreamingText.test.ts` to fuzz patch
  sequences. Manual: long answer (>3,000 chars) on slow network,
  reduce-motion, dark mode.

### Stage 6 — Decompose `ChatView/index.tsx` (3,041 LOC)

* **Scope**
  * Extract `useChatSession(sessionKey)` — returns
    `{messages, streamStatus, statusLabel, send, abort, ...}` as a
    selector over the store.
  * Extract `<MessageList>`, `<MessageInputBar>` (already
    `<ChatBox>`), `<StatusStrip>`, `<SubagentSidecar>` as pure
    children.
  * `ChatView` becomes a thin shell that wires these together.
* **Invariant established**: foreground has **one mega-component**
  fewer; each piece is testable in isolation.
* **Risk**: low if Stages 1-5 land first. High if attempted before
  them (you'd be refactoring a moving target).
* **Verify**: behavior unchanged; characterization tests still pass;
  Storybook stories for each extracted child.

---

## 5. Existing test coverage and gaps

### 5.1 Existing tests (vitest)

`chat-engine-v2/__tests__/` (12 files):

| File | Test count |
| ---- | ---------- |
| `store.test.ts` | 108 |
| `applyPatches.test.ts` | 34 |
| `timelineStore.test.ts` | 30 *(covers a dead module — can delete with Stage 0)* |
| `messageWindow.test.ts` | 29 *(covers a dead module — can delete with Stage 0)* |
| `messageSlice.test.ts` | 24 *(covers a dead module)* |
| `timelineStoreIntegration.test.ts` | 16 *(dead module)* |
| `activeRunRegistry.test.ts` | 15 |
| `pageCache.test.ts` | 10 *(dead module)* |
| `client.test.ts` | 7 |
| `bootstrapPreview.test.ts` | 5 *(dead module)* |
| `longConversation.test.ts` | 5 |
| `idempotency.test.ts` | 2 |

`components/ChatView/__tests__/` and adjacent:

| File | Test count |
| ---- | ---------- |
| `messageWindow.test.ts` | 64 (foreground window math — live) |
| `subagentDerive.test.ts` | 18 |
| `viewportWindow.test.ts` | 14 *(dead module)* |
| `bootstrapRecoveryGuard.test.ts` | 13 (live) |
| `messageRowKey.test.ts` | 9 |
| `useStreamingText.test.ts` | 6 |
| `orderChatMessages.test.ts` | 2 |
| `sendInFlightGuard.test.ts` | 1 |

There is **no React-level component test for `ChatView` itself.** All
ChatView coverage is via pure helpers that the component imports. The
component's reducer-like effect block at `index.tsx:1075-1199` is
**entirely uncovered**.

### 5.2 Characterization tests to add BEFORE refactoring

These should land in Stage 0 to lock the current correct behavior so
the refactor cannot regress it silently:

1. **`applyChatPatch` × 3 reducers parity**: for a representative
   sequence of 30+ patches (user → assistant deltas → tools → final),
   assert that the three current applyChatPatch callers produce
   message arrays that are **equal modulo ordering** when given the
   same input. This makes the divergence in §2.1 testable and
   regression-proof.
2. **Optimistic ↔ confirmed echo (real timing)**: model the gateway
   round trip with `vi.useFakeTimers`; assert exactly one user row at
   every intermediate frame (no double-bubble window).
3. **Session-switch mid-stream**: open ChatView A, send, advance the
   stream halfway, unmount, mount ChatView B, send, then remount
   ChatView A with `hasOptimisticBootstrap=false` and
   `hydrateFromRegistry` set. Assert the reattach sequence in
   `index.tsx:794-916` does not drop any patch that landed during the
   unmounted period.
4. **`bootstrap-recovery` debouncing**: emit two `hello{recovery:bootstrap}`
   events within 100ms; assert exactly one `resetToLiveTail` runs and
   the foreground does not flash the skeleton more than once.
5. **`useStreamingText` strict-prefix fuzz**: 1,000 random prefix-extending
   sequences; assert `displayText` is monotonically non-shrinking and
   ends equal to `target`.
6. **`messageListKeys` over the real lifecycle**: generate the full
   `[optimistic-user, live:tool, live:assistant, assistant-final]`
   sequence and assert the assigned keys are all distinct and stable.
7. **`activeRunRegistry` two-writer race**: simulate `publish` from
   ChatView and from runWatcher interleaved; assert the last
   observable snapshot matches the higher-`updatedAt` write **for each
   field independently** (or, after Stage 1, that only one writer
   exists).
8. **Patch cursor monotonicity under reconnect**: drop the WS, deliver
   3 patches via `/api/patches` backfill, reopen WS at the advanced
   cursor; assert no patch is applied twice and none is missed.

---

## 6. Executive summary

The chat subsystem appears tangled because it *is* tangled: a v2
architecture (`chat-engine-v2/store`) sits behind a v1-shaped consumer
(the 3,041-LOC `ChatView/index.tsx`), and a parallel v1.5 attempt
(`hooks/useChatMessages.ts`, 3,555 LOC of dead code) was never deleted.
On top of that, three independent code paths each open their own
WebSocket and each call `applyChatPatch` on the same wire frames, so
the same patch mutates three separate stores with three slightly
different post-processing rules. The reported flicker, jumping,
streaming-stutter, lagging-tool, and multi-session bugs are mostly
emergent properties of this multi-writer state. The fix is not a
greenfield rewrite — the `chat-engine-v2` store is already the right
shape — but a disciplined consolidation: delete the dead variants
(≈5,000 LOC of zero-risk deletions, Stage 0), make the store the sole
patch applier (Stage 1), collapse to one WebSocket (Stage 2), then
single-source ordering, window math, and the streaming-text
prefix invariant (Stages 3-5). Stage 6 then decomposes the mega
component now that the underlying state shape is stable. Each stage is
independently shippable and verifiable.

## 7. Top 5 highest-leverage fixes (ranked)

1. **Stage 0 — Delete dead variants and add characterization tests.** Removes
   ≈5,000 LOC including the 3,555-LOC `useChatMessages.ts`, three parallel
   ChatView attempts, and `chatStableIds`/`viewportWindow`/`pageCache`/
   `timelineStore`/`messageSlice`/`bootstrapPreview`. Pure deletion + tests;
   massive cognitive-load win at zero behavior risk; unblocks every later
   stage.
2. **Stage 1 — One `applyChatPatch` call site.** Move all patch application
   into `chat-engine-v2/store.ts`; make `runWatcher` lifecycle-only; make
   `ChatView` a store subscriber. Single root cause of "two-source divergence"
   flicker, duplicated tool stacks, and registry-vs-reconcile stomps.
3. **Stage 2 — One WebSocket.** Eliminate the per-ChatView SSE and the
   runWatcher SSE; route everything through the global store's stream
   (which is already ref-counted). Triples network savings, eliminates
   triple-replay storms on reconnect, eliminates the three-way race on
   `bootstrap-recovery` events.
4. **Stage 5 — Streaming text prefix invariant.** Enforce at the store level
   that live assistant text is monotonically prefix-extending during a run;
   make `useStreamingText` setters symmetric. Directly fixes "streaming
   animation breaks" without touching layout.
5. **Stage 3 — Single ordering and row-identity rule, enforced by assertions.**
   Move `orderChatMessages`/`dedupeChatMessages` into the store reducer; convert
   `messageListKeys`' defensive dedupe into a dev-time assertion. Eliminates
   the "key reuse → React remount → blink" class of bugs at the source
   instead of patching them downstream.
