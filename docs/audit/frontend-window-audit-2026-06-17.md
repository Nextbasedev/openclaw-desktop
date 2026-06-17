# Frontend Window State Audit — 2026-06-17
**Status:** complete
**Auditor:** Agent B (retry)
**Branch:** v6-1-krish (read-only) @ `5a17316f` HEAD
**Repo root:** `/root/.openclaw/workspace/openclaw-desktop`
**Scope:** chat window / pagination / live-patch logic in `packages/ui`

---

## Summary

The fixed-160 buffer invariant is **broken in five independent places**. Ranked by user-visible severity:

| # | Bug | Severity | Root cause |
|---|---|---|---|
| 1 | `shouldDropPatchAsEvicted` compares the **global patch cursor** to a **per-message gatewayIndex** — two different number spaces. When `hasNewer=true`, every live patch is dropped (cursor is always larger). | **Critical** | wrong field passed at call site |
| 2 | Newer-page fetch lets the buffer **grow unbounded** while user scrolls down through multiple full pages. The eventual single-shot eviction at live-tail is exactly the jolt the deferral was supposed to prevent. | High | revert `c6c01183` |
| 3 | `hasOlder` is inferred from `returnedCount >= requestedLimit`, ignoring the server-provided `hasOlder` flag that already exists on `BootstrapPayloadV2`. Off-by-one wasted fetch on exact-fit sessions; also wrong when the gateway responds with extras. | Medium | wrong source |
| 4 | `applyToolPatch` synthetic row `live:${runId}:tools` may carry `gatewayIndex = undefined` if its run's user message is outside the loaded window — `appendedNewestSeq` then falls back to a **stale** value, freezing the gate going forward. | Medium | synthetic row escapes seq invariant |
| 5 | `dedupeChatMessages` is run **three times per patch** (twice in `applyChatPatch` / `applyToolPatch`, once in `renderedMessages`). Idempotent in theory, but it can silently shrink a 160-row payload such that the row that produced `newestLoadedSeq` is no longer the visual tail. | Low (potential / unconfirmed) | redundant pipeline |

Plus several invariants the conversation/MEMORY described as broken that are actually **already correct** — see "Already-correct".

---

## Confirmed bugs

### BUG-1 — `shouldDropPatchAsEvicted` compares cursor (global event ordinal) to seq (per-session message index)

**Severity:** Critical.

**Evidence:**
- Call site: `packages/ui/components/ChatView/index.tsx:1024-1030`
  ```ts
  shouldDropPatchAsEvicted({
    patchSessionCursor: frame.patch.cursor,
    newestLoadedSeq: windowStateRef.current.newestLoadedSeq,
    hasNewer: windowStateRef.current.hasNewer,
  })
  ```
- Function: `packages/ui/components/ChatView/messageWindow.ts:241-251`
  ```ts
  return input.patchSessionCursor > input.newestLoadedSeq
  ```
- Number-space mismatch:
  - `frame.patch.cursor` is the **global projection event cursor** — see `packages/ui/lib/chat-engine-v2/store.ts:1957` comment: *"The websocket cursor is global across all sessions."* Persisted via `persistGlobalCursor()` in `localStorage` keyed `patchCursorStorageKey()` (one value for the whole app).
  - `newestLoadedSeq` is `ChatMessage.gatewayIndex`, populated from `payload.messageSeq` or `payload.gatewayIndex` in `applyChatPatch` (applyPatches.ts:52-60). This is the **per-session message ordinal** (1, 2, 3, ... within one chat).
- The two spaces have no relationship. After ~minutes of any session activity (across the entire app, including unrelated sessions), the global cursor will dwarf any per-session message seq (e.g. global cursor 25,400 vs per-session newestLoadedSeq 42).

**Consequence:**
1. User scrolls up; older-page fetch evicts from end → `hasNewer` flips to `true` (applyOlderPage:163, `applyLiveAppend` also flips it indirectly).
2. From this moment forward, **every** incoming live patch satisfies `frame.patch.cursor > newestLoadedSeq`, so `shouldDropPatchAsEvicted` returns true → patch is silently dropped from view.
3. This includes patches that target messages **already in the loaded window** (e.g. a tool result for a tool the user is currently looking at). The intent was to drop patches whose *target message* is above the buffer, but the gate is on the patch event cursor, not the target message seq.
4. `cursorRef.current` still advances (index.tsx:1014), so the SSE stream stays alive; the visual state just freezes until the user either scrolls down to live tail (newer fetch reaches `hasNewer=false`) or hits send (`if (windowStateRef.current.hasNewer) await resetToLiveTail()` at index.tsx:1286).

**Reproduction (failing test):**
```ts
// __tests__/applyPatches.shouldDropPatchAsEvicted-numberspace.test.ts
test("tool result for in-window message must apply even when global cursor >> seq", () => {
  // Session has 50 messages. newestLoadedSeq = 50, hasNewer = true (user scrolled up).
  // A tool patch arrives for tool that lives on message #30 (in buffer).
  // Global patch cursor is 12_345 (because other sessions have run for hours).
  const drop = shouldDropPatchAsEvicted({
    patchSessionCursor: 12_345,
    newestLoadedSeq: 50,
    hasNewer: true,
  })
  expect(drop).toBe(false) // current code returns true → patch dropped
})
```

**Fix sketch (smallest blast radius):**
- Extract `patchMessageSeq(frame)` (already exists in `applyPatches.ts:51-62`) and pass *that* value at the call site instead of `frame.patch.cursor`. For patches that have no message seq (e.g. raw status patches), default to "do not drop" (apply).
- Re-validate the existing unit tests — they exercise the function but assume cursor and seq are comparable. Rename `patchSessionCursor` → `patchTargetSeq`, update test fixtures to reflect that.

---

### BUG-2 — Newer-page fetch lets the buffer grow unbounded past `MAX_LOADED`

**Severity:** High.

**Evidence:**
- Code: `packages/ui/components/ChatView/index.tsx:2046-2072` (newer fetch resolve)
  ```ts
  const responseCount = response.messageCount ?? response.messages.length
  const reachedLiveTail = responseCount < OLDER_PAGE
  setState((current) => {
    const combined = [...current.messages, ...newerMessages]
    const evictedFromStart = reachedLiveTail
      ? computeEvictedAfterAppend(current.messages.length, newerMessages.length, MAX_LOADED)
      : 0  // deliberately 0 mid-scroll
    …
  })
  ```
- Origin: revert `c6c01183` (Mon Jun 15 10:30), confirmed in MEMORY.md and verified via `git show c6c01183`.
- Documentation contradiction:
  - `messageWindow.ts:14`: *"Maximum number of messages we hold in the active data window."* → invariant claim.
  - `messageWindow.ts:88` (`computeEvictedAfterAppend`): *"…so the buffer stays at most `maxLoaded`."* → invariant claim.
  - `index.tsx:2046-2054`: comment explains it deliberately violates the cap during scroll-down.
  - Two contradictory promises in tree.

**Consequence:**
- User scrolling down through 5 full pages of newer history holds **160 + 5 × 100 = 660 rows** in memory before any eviction happens.
- When they finally reach the live tail (`responseCount < OLDER_PAGE`), `computeEvictedAfterAppend(660, lastPageCount, 160)` evicts ~500+ rows in a single setState. The anchor-restoration in `useLayoutEffect` at `index.tsx:2415-2433` saves the visual scroll position only if the anchor row survives the eviction; otherwise scrollTop is left as-is, producing exactly the "scroll-down jolt" the deferral was supposed to avoid.
- Worse — if the user navigates away (session switch) before reaching the tail, the inflated buffer is dropped, **but** `activeRunRegistry.publish` (index.tsx:976-984) snapshots `state.messages` on every change, so the registry now stores a 660-row snapshot until the next mount. Multiple background sessions inflate similarly.
- A live patch during mid-scroll can still trigger the live-append eviction path (index.tsx:1139): `orderedMessages.length > MAX_LOADED` is true, `canEvictFromStartOnLiveAppend` is true (`hasOlder` was flipped to true by the first newer fetch's eviction-from-end implication, but actually `hasOlder` stays true because we never reach back to the very top), so it evicts immediately on a single live patch. **That eviction is the same jolt** — just moved to whichever live patch happens to fire first.

**Reproduction (failing test):**
```ts
// integration test
test("scrolling down through 3 full newer pages keeps buffer <= MAX_LOADED", async () => {
  // 1. Open session at messageSeq 100 with 160 msgs loaded.
  // 2. Scroll up → older fetch evicts 100 from end. hasNewer=true.
  // 3. Scroll down → newer fetch returns 100 (full page). repeat 3 times.
  // 4. Expect state.messages.length <= MAX_LOADED.
  expect(state.messages.length).toBeLessThanOrEqual(MAX_LOADED) // currently fails: 460
})
```

**Fix sketch (smallest blast radius):**
- Restore eviction-from-start on every newer fetch (the reverted commit `f75e1876`).
- Re-introduce the scroll anchor capture/restore that already exists for the older path (`captureFirstVisibleRowAnchor` at index.tsx:1925; `pendingScrollAnchorRef` consumer at index.tsx:2414). The newer path **already** calls `captureFirstVisibleRowAnchor()` at index.tsx:1995. So infrastructure is in place — the revert just stopped using it.
- Optional follow-up: instead of immediate eviction, run it on next idle (`requestIdleCallback`) so the user's RAF scroll isn't competing.

---

### BUG-3 — `hasOlder` derived from `returnedCount >= requestedLimit` instead of server flag

**Severity:** Medium.

**Evidence:**
- Frontend code:
  - `messageWindow.ts:139` (`applyInitialPage`): `hasOlder: input.returnedCount >= requestedLimit`
  - `messageWindow.ts:163` (`applyOlderPage`): `hasOlder: prevState.hasOlder || evictedFromEnd > 0`
  - Initial use: `index.tsx:912` (`returnedCount: history.messageCount ?? history.messages.length`)
- Server already exposes `hasOlder?: boolean` on `BootstrapPayloadV2` — `packages/ui/lib/chat-engine-v2/types.ts:50`. The store applies it at `store.ts:1640` for `historyCoverage`, but the per-session `windowState` ignores it.

**Consequence:**
- **Off-by-one false-positive:** Session has exactly 160 messages → `returnedCount === requestedLimit` → `hasOlder = true`. First near-top scroll triggers an older fetch that returns 0 → applyOlderPage:163 flips `hasOlder = false` via "0 >= 100 ? false". Cost: one wasted round-trip + one wasted scroll-anchor capture. Self-healing.
- **Worse failure mode** — if `normalizeHistory` ever returns fewer rows than the raw `history.messages.length` (e.g. dedupe at parse time, attachment-only echoes filtered, or a malformed payload skipped), then `returnedCount` and the actual buffer length diverge. The window state's `oldestLoadedSeq` is taken from the *parsed* `firstMessage.gatewayIndex`, but `hasOlder` is taken from the *raw* count. The user can end up with `hasOlder=true` even though their loaded buffer represents the absolute top of the chat.
- Resetting to live tail (`resetToLiveTail` at index.tsx:2125) has the same logic at index.tsx:2173 — same caveat.

**Reproduction (failing test):**
```ts
test("hasOlder follows server flag when supplied", () => {
  const state = applyInitialPage({
    returnedCount: 160,
    oldestSeq: 1,  // server says this IS the top
    newestSeq: 160,
    requestedLimit: 160,
    hasOlder: false, // server flag — currently ignored
  } as any)
  expect(state.hasOlder).toBe(false)
})
```

**Fix sketch:**
- Plumb the bootstrap `hasOlder` field through `fetchChatMessagesV2` → into the bootstrap-effect / `resetToLiveTail` paths. Pass to `applyInitialPage`; have it prefer the server value when present, fall back to the length heuristic for backwards compat.

---

### BUG-4 — `applyToolPatch` synthetic `live:${runId}:tools` row may carry `gatewayIndex = undefined`, poisoning `newestLoadedSeq`

**Severity:** Medium.

**Evidence:**
- `packages/ui/lib/chat-engine-v2/applyPatches.ts:315-330` (`applyToolPatch`):
  ```ts
  const gatewayIndex = inferToolAssistantSeqFromRun(state, inline.runId)
  // …
  messages.push({
    messageId: inline.runId ? `live:${inline.runId}:tools` : `live:${inline.tool.id}:tools`,
    role: "assistant",
    text: "",
    createdAt,
    runId: inline.runId ?? undefined,
    gatewayIndex,
    toolCalls: [inline.tool],
  })
  ```
- `inferToolAssistantSeqFromRun` (applyPatches.ts:280-285) returns `undefined` when there is **no user message in `state.messages` with a matching `runId`**.
- ChatView's window mutation (index.tsx:1153-1163):
  ```ts
  const newNewest = finalMessages[finalMessages.length - 1]
  const appendedNewestSeq =
    newNewest && typeof newNewest.gatewayIndex === "number"
      ? newNewest.gatewayIndex
      : null
  setWindowState((s) => applyLiveAppend({ …, appendedNewestSeq, … }))
  ```
- `applyLiveAppend` (messageWindow.ts:190): `newestLoadedSeq: input.appendedNewestSeq ?? prevState.newestLoadedSeq`.

**Consequence:**
- When the synthesized tool row lands at the tail with no `gatewayIndex`, `appendedNewestSeq = null`, and the window's `newestLoadedSeq` is **not updated**. Subsequent gating (the already-broken `shouldDropPatchAsEvicted`) plus `fetchNewerPage`'s `afterSeq: windowState.newestLoadedSeq` (index.tsx:2014) keep referencing the stale seq.
- Common trigger: the user is scrolled up. Older eviction means the triggering user message is **not** in `state.messages`. A new tool patch lands → synthetic tool row appended with `gatewayIndex=undefined` → `orderChatMessages` (orderChatMessages.ts:15-20) sorts it by *array index* among other no-seq rows, dropping it at the array tail.
- If that row is then evicted (`canEvictFromStartOnLiveAppend` true → `evictedFromStart = orderedMessages.length - MAX_LOADED`), the evict-from-START is harmless; but the tail still holds a row whose seq is undefined.
- This silently disables the window invariant for the next live-tail check.

**Reproduction (failing test):**
```ts
test("live tool patch with no matching user does not stamp newestLoadedSeq=null", () => {
  // start: state.messages all canonical, newestLoadedSeq=42
  // user message for runId R was evicted (not in state.messages)
  // applyToolPatch synthesizes live:R:tools with gatewayIndex=undefined
  // ChatView's applyLiveAppend caller passes appendedNewestSeq=null
  // windowState.newestLoadedSeq stays at 42 — but the row's "real" seq is >42
  // fetchNewerPage uses afterSeq=42 → re-fetches messages we already streamed
  expect(windowState.newestLoadedSeq).toBeGreaterThan(42)
})
```

**Fix sketch:**
- Stamp `gatewayIndex` from a non-state source. Options:
  - Use `frame.patch.cursor` as a fallback (still not seq, but monotonic — at least keeps gate logic in *some* sane comparison space).
  - Carry `messageSeq` from the patch payload through `applyToolPatch` (the payload usually has it on the parent message, but tool patches don't carry it directly today).
  - Drop the synthetic row entirely once a canonical assistant message arrives — already happens via dedupe (`isLiveAssistantEcho` etc.), so just don't update `newestLoadedSeq` from no-seq tails. Have ChatView's append handler skip the window-state mutation when `newNewest.gatewayIndex` is undefined.

---

### BUG-5 — `dedupeChatMessages` is run three times per patch; can shrink the tail row that produced `newestLoadedSeq`

**Severity:** Low / latent. Suspected but not fully reproduced in isolation.

**Evidence:**
- `applyChatPatch` (applyPatches.ts:725 area, final return): `messages: dedupeChatMessages(mergeToolOnlyAssistantMessages(baseMessages, animated, frame))`.
- `applyToolPatch` (applyPatches.ts:312): `messages: dedupeChatMessages(messages)`.
- ChatView render memo (index.tsx:1543): `renderedMessages = useMemo(() => orderChatMessages(dedupeChatMessages(state.messages)), [state.messages])`.
- So a single live patch round-trips through dedupe **twice** (once inside applyPatches, once on render). Stored `state.messages` is post-dedupe. `windowState.newestLoadedSeq` is computed from the **post-dedupe** state.messages tail at index.tsx:1147,1183,1216.

**Consequence (latent):**
- In normal operation dedupe is idempotent — running it again on already-deduped input is a no-op.
- However `collapseRepeatedBlocks` (chatMessageDedupe.ts:264-294) and `collapseRepeatedRoleBlocks` (chatMessageDedupe.ts:297-327) **mutate** the array based on pattern matching across the whole window. If the canonical "shape" of the window changes between the in-reducer dedupe and the render-time dedupe (e.g. a sibling patch arrives between them in a React batched-update), the render-time dedupe could decide a tail row is a repeated block and drop it. That row is what produced `newestLoadedSeq`.
- Counter: state.messages mutation is always a single setState callback; render dedupe runs on the same input. Double-dedupe should be idempotent here. But the third dedupe pass in `mergeToolOnlyAssistantMessages` (applyPatches.ts:339-366) operates on a *partial* set (`baseMessages` excludes `idsToReplace`) — if a future patch arrives whose `idsToReplace` includes the row that produced `newestLoadedSeq`, the window state is now stale until the next live-append updates it.

**Reproduction (failing test) — needs runtime confirmation:**
```ts
test("dedupe never removes the row whose seq is windowState.newestLoadedSeq", () => {
  // construct a buffer where the tail message would be detected as part of a
  // repeated assistant block. Verify dedupe preserves it OR windowState is also
  // mutated to match.
})
```

**Fix sketch:**
- Either:
  - Compute `newestLoadedSeq` from the highest-seq row in the buffer (not the array tail). Robust to dedupe/order changes.
  - Or collapse the dedupe pipeline: `applyChatPatch` already dedupes; the render-time pass is redundant — drop it. Risk: any direct mutator of state.messages bypassing applyChatPatch would lose dedupe. Audit shows ChatView does this in handleEdit/handleDelete (index.tsx:1382-1411); those would need explicit dedupe calls.

---

## Already-correct (don't fix what isn't broken)

- **MEMORY claim:** *"single sliding window enforced at store level."* — `trimSessionMessageWindow` (store.ts:2189) exists but is **never called** by ChatView. ChatView uses its **own** local `state.messages` array. The store-level trim is dead code outside tests. Not a bug per se, just a documentation lie. (`grep -n trimSessionMessageWindow packages/ui --include='*.tsx' --include='*.ts' | grep -v __tests__` returns nothing.)
- **Warm cache races:** `getWarmChatCache` is **not** consumed by ChatView (only the store consumes/sets it). Warm cache cannot set `windowState`. Worry deleted.
- **Send while `hasNewer=true`:** `handleSend` correctly awaits `resetToLiveTail()` first (index.tsx:1284-1287). This is the right call. Verified.
- **Optimistic bootstrap:** correctly sets `hasOlder=false / hasNewer=false` via `applyInitialPage({returnedCount: 0, …})` (index.tsx:697-705). Anti-skeleton path is solid.
- **Registry hydration reconcile:** background fetch swaps in only if `freshCursor > reattachCursor || freshMessages.length > seededMessages.length` (index.tsx:809-818). No flicker on equal-state.
- **Older-page eviction:** `computeEvictedAfterPrepend(...)` is unconditional and correct (messageWindow.ts:77-83 + index.tsx:1882-1897). Buffer stays at MAX_LOADED on older fetches. **MEMORY claim that older-side was broken is wrong** — older side is the *only* side that respects the cap correctly.
- **`canEvictFromStartOnLiveAppend(hasOlder)`** gate is correct (messageWindow.ts:213-215). If hasOlder=false, evicting from start would destroy unrecoverable history (re-fetch would have no anchor). Code uses the `hasOlder=false` branch (index.tsx:1183-1208) to let the buffer temporarily exceed MAX_LOADED but logs a `warn` — explicit acknowledged trade-off.
- **`bootstrapRecoveryGuard.decideBootstrapRecovery`** layered (active-run / in-flight reset / recent-bootstrap suppression / debounce) is sensible and survives the audit. See bootstrapRecoveryGuard.ts:85-…
- **React keys:** `messageRowKey` is messageId-derived; `messageListKeys` deduplicates collisions with `#1`, `#2` suffixes (messageRowKey.ts:67-80). The long-conversation duplication bug fix from `8900220b` holds.

---

## Unconfirmed suspicions

1. **`activeRunRegistry.publish` snapshots `state.messages` on every change** (index.tsx:976-984). If BUG-2 inflates `state.messages` to 660 rows, the registry snapshot grows accordingly. When the user remounts that session via the sidebar, `hydrateFromRegistry` (index.tsx:721-754) seeds *all* 660 rows + the seq math runs on the inflated buffer. Worth checking heap profile in a long session.
2. **`patchMessageSeq` falls back to `__openclaw.seq` on the message object** (applyPatches.ts:51-62). If middleware emits messages with no `__openclaw.seq` for live deltas (gateway echo race), `inferAssistantSeqFromRun` synthesizes one as `matchingUser.gatewayIndex + 1`. With multiple parallel runs on the same user message (forks, retries), this can produce duplicate-key collisions on `gatewayIndex`. Not seen in tests, but plausible.
3. **`resetToLiveTail` reset path** (index.tsx:2125) wipes `state.messages = []` *before* the fetch resolves. During the 100–500ms fetch window, the UI renders `<ChatLoadingSkeleton />` (index.tsx:2538). If a fast-typing user hits send during this window, `handleSend` reads `state.messages.length > 0` as false → optimistic bubble inserted into an empty array → ok actually fine. But the concurrent `resetToLiveTail` setState could overwrite the optimistic bubble. The send-in-flight guard (`beginSendIfIdle`) may not protect against an *external* setState clobbering. Needs trace-level repro.
4. **Time-based refractory (`REFRACTORY_MS=250`)** is global to direction-locked older/newer. If the user fires older→newer→older in 200ms (extreme fast scroll), the refractory only gates *same-direction* repeats. Cross-direction alternation is unrestricted. Probably fine because each fetch resolves before the opposite direction's trigger threshold is geometrically reachable, but adversarial scroll could in theory still alternate.

---

## Code map

```
SSE patch frame ─┐
                  │
ChatView mount    │   openPatchStreamV2(streamCursor, frame => …)
  ├─ optimistic   │     │
  │  bootstrap    │     ▼
  ├─ registry     │   shouldDropPatchAsEvicted(cursor, newestLoadedSeq, hasNewer)
  │  hydrate      │     │ BUG-1: cursor vs seq number-space mismatch
  └─ cold fetch   │     ▼
       │          │   applyChatPatch(state, frame)
       ▼          │     ├─ applyToolPatch → synthesize live:${runId}:tools
       │          │     │  BUG-4: gatewayIndex may be undefined
       │          │     ├─ inferAssistantSeqFromRun → seq stamp
       │          │     ├─ mergeToolOnlyAssistantMessages
       │          │     └─ dedupeChatMessages (round 1 of 3)
       ▼          │
  setWindowState(applyInitialPage)             ──┐
       │          │                              │ BUG-3: hasOlder = returned >= limit
       │          ▼                              │      (server flag ignored)
       │      orderChatMessages(patched)         │
       │          │                              │
       │          ├─ if appendedAtTail &&        │
       │          │  length > MAX_LOADED:        │
       │          │   ├─ canEvictFromStart?       │
       │          │   │   ├─ yes → slice + setWindowState(applyLiveAppend)
       │          │   │   └─ no  → keep over-cap + warn
       │          │   └─ else: just stamp newestLoadedSeq
       │          ▼
       └──── state.messages ⇒ renderedMessages =
                 orderChatMessages(dedupeChatMessages(state.messages))  (round 2 of 2/3)

Scroll near top:                       Scroll near bottom:
  handleScroll → evaluateOlderTrigger   handleScroll → evaluateNewerTrigger
    │                                     │
    ├─ refractory (REFRACTORY_MS=250)     ├─ refractory
    ├─ measureRowsAboveViewport <= 60     ├─ measureRowsBelowViewport <= 60
    ├─ shouldFetchOlder                   ├─ shouldFetchNewer
    └─ fetchOlderPage (beforeSeq)         └─ fetchNewerPage (afterSeq)
       ├─ captureFirstVisibleRowAnchor      ├─ captureFirstVisibleRowAnchor
       ├─ fetch beforeSeq, limit=100         ├─ fetch afterSeq,  limit=100
       ├─ prepend olderMessages              ├─ append newerMessages
       ├─ computeEvictedAfterPrepend         ├─ if responseCount < OLDER_PAGE:
       │  → always evict from end            │      reachedLiveTail=true → evict
       └─ applyOlderPage                     │   else: NO EVICTION  BUG-2
                                              └─ applyNewerPage

Bootstrap recovery:
  window event "openclaw:chat-bootstrap-recovery"
    → decideBootstrapRecovery (guard layered)
    → if apply: resetToLiveTail()
       → setWindowState(INITIAL_WINDOW_STATE)
       → fetchChatMessagesV2 (live tail)
       → applyInitialPage
```

---

## Adversarial scenarios

| # | Scenario | Predicted behavior | Citation | Verdict |
|---|---|---|---|---|
| 1 | Open session with cache=50 → live fetch returns 160 | Cache (warm) is NOT consumed by ChatView. Live fetch wins, applyInitialPage with returnedCount=160 sets hasOlder=true. | `getWarmChatCache` search: no consumer in ChatView. index.tsx:898-910 | **PASS (no race)** |
| 2 | Older fetch returns 10 visible rows (90 hidden filtered) → hasOlder flip | `applyOlderPage` `hasOlder: returnedCount >= 100`. If returnedCount=10 → hasOlder=false. **Correct.** | messageWindow.ts:163, index.tsx:1903-1915 | PASS |
| 3 | At true top: older fetch returns 0 | empty-resolve branch resets isLoadingOlder, hasOlder stays whatever it was via `applyOlderPage(returnedCount=0)` → `0 >= 100 ? false`. Stable. | index.tsx:1858-1880 | PASS |
| 4 | Scrolled away from tail, 50 live patches arrive | hasNewer=true (after older eviction). `shouldDropPatchAsEvicted` returns true for all 50 (BUG-1). Visual state freezes. cursorRef keeps advancing. | index.tsx:1024-1042, messageWindow.ts:241-251 | **FAIL — BUG-1** |
| 5 | At bottom (hasNewer=false), 1 live patch pushes orderedMessages.length to 161 | `canEvictFromStartOnLiveAppend` = `hasOlder===true`. If user reached the top once (hasOlder=false) AND has 160 in buffer → 161 stays (no evict, warn logged). If hasOlder=true → evict 1, applyLiveAppend stamps seqs. | index.tsx:1139-1232 | PASS (correct) |
| 6 | App reload mid-stream → bootstrap-recovery fires before cold-bootstrap fetch settles | `decideBootstrapRecovery` checks `isLoading=true` → returns `skipped-in-flight-reset`. The cold-bootstrap fetch will complete and stamp `lastBootstrapCompletedAtRef`. Subsequent recovery suppressed by `recent-bootstrap` guard. | bootstrapRecoveryGuard.ts, index.tsx:2334-2358 | PASS |
| 7 | Send while hasNewer=true → does the reset happen? | `if (windowStateRef.current.hasNewer) await resetToLiveTail()` at index.tsx:1286. Correct. | index.tsx:1286-1287 | PASS |
| 8 | Tool patch arrives 5s after run terminal → animateText cleared? | Safety effect (index.tsx:1700-1730) clears `animateText` whenever `!isGenerating && message.animateText===true`. Tool patch after terminal status keeps isGenerating=false, so animateText would be cleared by this effect on the next render. | index.tsx:1700-1730 | PASS |
| 9 | Two rapid sends: first confirmed second optimistic | `beginSendIfIdle` blocks second within the same `handleSend` invocation (index.tsx:1267); queue path enqueues for later drain via `useEffect` watching isGenerating. Queue drain awaits idle. | index.tsx:1244-1266, 1646-1661 | PASS |
| 10 | SSE reconnect: globalCursor restored from localStorage is > server latestCursor (epoch reset) | hello-frame branch resets globalCursor to serverCursor (store.ts:1909-1916). No replay loop. | store.ts:1907-1922 | PASS |
| 11 | 1000-msg session, never scrolled past initial | INITIAL_PAGE=160 → buffer is 160. No older fetch unless near top. `hasOlder` correctly true (returned>=160). Memory bounded. | messageWindow.ts:17, index.tsx:912 | PASS |
| 12 | Sub-agent spawns 5 nested levels | Each sub-agent has its own ChatView and own window state. Top-level still bounded at 160 per session. Sub-agent overlay is `SubagentFullChat` (index.tsx:2548). Not within the same window. | index.tsx:2548-2566 | PASS |
| 13 | User scrolls down through 5 full newer pages | After each: `responseCount=100, reachedLiveTail=false, evictedFromStart=0` → buffer grows 160 → 260 → 360 → 460 → 560. Sixth page might hit tail. | index.tsx:2046-2072 | **FAIL — BUG-2** |
| 14 | Synthetic `live:${runId}:tools` row at tail; user message for runId not in buffer | `gatewayIndex=undefined` → `applyLiveAppend.appendedNewestSeq=null` → newestLoadedSeq unchanged. Subsequent newer fetch uses stale afterSeq. | applyPatches.ts:280-330, index.tsx:1148-1163 | **FAIL — BUG-4** |
| 15 | Exact-fit session: returned = 160 = INITIAL_PAGE | hasOlder = true (160 >= 160). First near-top scroll → older fetch → 0 returned → applyOlderPage flips hasOlder=false. Wasted fetch but recoverable. | messageWindow.ts:139, index.tsx:1858-1880 | **PARTIAL — BUG-3** |
| 16 | normalizeHistory drops 10 rows (attachment-only echoes) — raw 160, parsed 150 | `returnedCount = history.messageCount ?? history.messages.length = 160` → hasOlder=true. Buffer holds 150 rows. Cap respected, but hasOlder is wrong if 160 was the true top. | index.tsx:912-914 | **FAIL — BUG-3 stronger variant** |

---

## Recommendations (ordered, smallest blast radius first)

1. **(15 min) BUG-1 quick fix.** Change call site at `index.tsx:1024-1028` to pass `patchMessageSeq(frame) ?? Number.NEGATIVE_INFINITY` (or rename the field to `patchTargetSeq` and import the helper from applyPatches.ts). Update the messageWindow.test.ts to reflect the new semantics. Net change: ~30 LOC. Highest-impact bug fixed.

2. **(30 min) BUG-2 revert-the-revert.** Re-apply `f75e1876` so newer fetches always evict from start. The captureFirstVisibleRowAnchor+useLayoutEffect machinery is already in place — it just needs to be re-engaged. Net change: ~20 LOC (the diff of `c6c01183`). Quiescent eviction is already what the rest of the system assumes.

3. **(45 min) BUG-3 plumb the server flag.** Extend `applyInitialPage` to accept an optional `hasOlder?: boolean`. When the bootstrap payload supplies it, use it; otherwise fall back to the count heuristic. Touch points: `fetchChatMessagesV2` response shape, applyInitialPage signature, 3 call sites in index.tsx (cold bootstrap, registry hydrate, resetToLiveTail).

4. **(1 hr) BUG-4 stamp synthetic rows or skip stamp on no-seq tails.** Cheapest patch: in the live-append handler at index.tsx:1148-1163 and 1183-1195, **only** call `applyLiveAppend` with a non-null `appendedNewestSeq`. If `newNewest.gatewayIndex` is undefined, skip the window-state mutation entirely (still call setState for the message array, just don't lie about the window seq). Add a defensive log so we notice if it happens unexpectedly.

5. **(2 hr) BUG-5 collapse the dedupe pipeline.** Drop the render-time `dedupeChatMessages` call at index.tsx:1543. Verify with the existing dedupe tests + a new test asserting `state.messages` is already deduped. Add explicit dedupe to handleEdit/handleDelete if needed (likely not, since they mutate in place).

6. **(later) Audit `trimSessionMessageWindow`.** Either wire it up or delete it. Currently dead code paying for test maintenance. Pick one.

7. **(later) Memory invariant test.** Add an integration test that exercises BUG-2's scenario end-to-end and asserts `state.messages.length <= MAX_LOADED` at every step. Catches the next revert.

---

## Investigation journal (raw)

### Constants (single source of truth)
`packages/ui/components/ChatView/messageWindow.ts:14-40`
- `MAX_LOADED = 160`
- `INITIAL_PAGE = 160`
- `OLDER_PAGE = 100` (also used as newer page size — see `index.tsx:1849,2014`)
- `TOP_TRIGGER = 60`, `BOTTOM_TRIGGER = 60`
- `REFRACTORY_MS = 250` (time-based, replaces scrollTop refractory)

### Key file:line references quoted in this audit
- shouldDropPatchAsEvicted gate site: `packages/ui/components/ChatView/index.tsx:1024-1042`
- newer fetch deferred eviction: `packages/ui/components/ChatView/index.tsx:2046-2072`
- live-append eviction (good path): `packages/ui/components/ChatView/index.tsx:1139-1232`
- hasOlder length heuristic: `packages/ui/components/ChatView/messageWindow.ts:139,163`
- server hasOlder flag (unused): `packages/ui/lib/chat-engine-v2/types.ts:50`
- patch cursor is global: `packages/ui/lib/chat-engine-v2/store.ts:1957`
- patchMessageSeq helper (already exists): `packages/ui/lib/chat-engine-v2/applyPatches.ts:51-62`
- synthetic tool row: `packages/ui/lib/chat-engine-v2/applyPatches.ts:312-330`
- inferToolAssistantSeqFromRun: `packages/ui/lib/chat-engine-v2/applyPatches.ts:280-285`
- resetToLiveTail: `packages/ui/components/ChatView/index.tsx:2125-2222`
- handleSend's reset-on-send: `packages/ui/components/ChatView/index.tsx:1286-1287`
- bootstrapRecoveryGuard usage: `packages/ui/components/ChatView/index.tsx:2323-2370`
- trimSessionMessageWindow (dead code in product): `packages/ui/lib/chat-engine-v2/store.ts:2189`
- renderedMessages double-dedupe: `packages/ui/components/ChatView/index.tsx:1543`
- registry publish snapshot: `packages/ui/components/ChatView/index.tsx:976-988`
- queue drain effect: `packages/ui/components/ChatView/index.tsx:1646-1661`

### Notes on what was NOT checked at line-precision (transparent)
- Did **not** read all 2818 lines of index.tsx; focused on lines surrounding window state, send, fetch, patch, and recovery. Reactions/pin/replyTo/SubagentBar/derivation logic skipped.
- Did **not** run `pnpm --filter ui typecheck` (audit is read-only and the BUGs above are structural; not type-level).
- Did **not** trace the gateway/middleware code that emits messageSeq vs patch cursor — relied on type definitions and the explicit code comment in store.ts:1957. If those are wrong, BUG-1 collapses to a non-bug.
- `chatHistoryParser.ts` (1076 lines) was not read; the audit treats `parseChatHistory` as a black box that returns ordered ChatMessage[]. `normalizeHistory` was inferred from call sites.
