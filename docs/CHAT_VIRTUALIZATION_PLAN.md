# Chat Virtualization Plan (v6-1-krish)

Author: orchestrator
Date: 2026-06-15

This is the plan that gets reviewed and signed off **before** anyone writes code. Do not start a sub-agent on this until Krish approves.

---

## 1. Approach choice: library vs custom

### Option A — Use a library (`@tanstack/react-virtual` or `react-virtuoso`)
- **Pro**: battle-tested DOM virtualization (only ~viewport rows mounted), measured row heights, automatic spacer math.
- **Pro**: stable scroll anchoring on prepend already solved by the library.
- **Con**: every existing imperative scroll behavior in `ChatView` (smooth-follow-bottom on stream, scroll-into-view on pin-jump, ResizeObserver auto-follow) must be rewritten in the library's API. High collateral risk for "0 changes to existing behavior."
- **Con**: Virtuoso owns the scroller; that means `scrollContainerRef.current.querySelector("[data-message-id]")` (pin-jump, search highlight, reply-jump) stops working as-is. Every consumer of `scrollContainerRef` needs a new lookup path.
- **Con**: Two of the message-rendering invariants in this codebase are hard for a library to satisfy without surgery:
  1. **Mid-list patch mutation** — `applyChatPatch` may rewrite the runId of an existing assistant row anywhere in the array, change its `gatewayIndex`, or merge tool-only rows. Libraries assume `key` stability; ours mutates keys.
  2. **Variable-tall rows with deferred mount of children** (ThinkingBlock, ToolCallSteps with collapse/expand, MessageBubble's edit popover). Height changes after first paint mid-scroll; both libraries handle this but Virtuoso especially does best if children are stable, which ours aren't.
- **Migration cost**: medium-high. Touches every existing scroll/jump consumer.

### Option B — Custom window over the data layer (NOT the DOM)
This is the approach the codebase was already heading toward. The key insight: **we do not need DOM virtualization right now.** We need **data-window virtualization**: only keep N messages in `state.messages` at any moment. The DOM ends up small as a consequence (~160 rows), not because we mount a fraction of them.

- **Pro**: Zero change to the render path. `renderedMessages.map(...)` still mounts every loaded row. All existing imperative behavior (`scrollContainerRef.current.querySelector`, `scrollIntoView`, ResizeObserver auto-follow, smooth-bottom follow, pin-jump flash) keeps working unchanged.
- **Pro**: No library, no new dependency, no learning curve, no future migration pain.
- **Pro**: The exact policy you described — "keep total ≤ 160, prefetch when 60 remain at the top" — is a 30-line state machine. Trivial to test and reason about.
- **Pro**: `viewportWindow.ts` and `viewportWindow.test.ts` are already present in-repo if we later decide to add DOM virtualization on top. Door stays open.
- **Pro**: Backend already supports `beforeSeq + limit`. No middleware change required.
- **Con**: Jump-to-message for IDs **outside** the loaded window needs an extra fetch (load a window centered on that seq). Easy, but it's the one new code path.
- **Con**: We still ship 160 fully-mounted message DOM trees. For typical messages (~50 KB DOM each on long markdown/tool rows) that's manageable but not feather-light. Acceptable trade-off for "zero risk to existing behavior."

### Decision: **Option B (data-window virtualization)**

Reasons in priority order:
1. **Your top priority** is "0 changes to existing working behavior." Option B touches `state.messages` and the bootstrap fetch — nothing else. Option A touches every imperative scroll and jump consumer.
2. Backend API already shaped for it.
3. Math is small and unit-testable in isolation (just like the existing `viewportWindow.ts`).
4. Open path to layering Option A on top later if 160 DOM rows ever becomes the bottleneck — Option B does not block it.

---

## 2. The math (your exact requirements, made precise)

Let:
- `MAX_LOADED = 160`
- `INITIAL_PAGE = 160`
- `OLDER_PAGE = 100`
- `TOP_TRIGGER = 60` — when the *number of loaded messages from the current top down to the current scroll position* drops to ≤ 60, fetch older.

### Initial load
1. Fetch latest `INITIAL_PAGE` (160) messages: `fetchChatMessagesV2({ sessionKey, beforeSeq: Number.MAX_SAFE_INTEGER, limit: 160 })`.
2. Backend returns latest 160 in ASC seq order. `setState({ messages: those })`.
3. Record `oldestLoadedSeq = messages[0].gatewayIndex`.
4. Record `hasOlder = (messageCount === 160)` — if backend returned fewer than asked, we're at the start of the conversation.
5. Auto-scroll to bottom (current behavior).

### Older-page fetch trigger
- When user scrolls up, compute the **number of rows above the current viewport top**.
  - We have row offsets via DOM `getBoundingClientRect` for the first visible message vs the scroll container. Number of rows above = index of first message whose bottom ≥ `scrollTop`.
- If `hasOlder && !isLoadingOlder && rowsAboveViewport ≤ TOP_TRIGGER`, fetch older.
- Fetch: `fetchChatMessagesV2({ sessionKey, beforeSeq: oldestLoadedSeq, limit: OLDER_PAGE })`.
- On response (older 100 messages):
  - **Prepend** them to `state.messages`.
  - **Evict** from the end: if `messages.length > MAX_LOADED`, drop the newest `(messages.length - MAX_LOADED)` messages.
  - Update `oldestLoadedSeq`, `newestLoadedSeq`.
  - Set `hasOlder = (returnedCount === OLDER_PAGE)`.
  - Set `hasNewer = true` (we just evicted some from the top of the newest end → there are now newer ones not loaded).
  - **Anchor scroll** — the row that was at `scrollTop=X` before the prepend should still be at `scrollTop=X+prependHeightPx` after. We measure `scrollHeight` before/after in a `useLayoutEffect` and adjust `scrollTop` accordingly. (Exact mechanic the legacy snapshot already used; reuse the pattern.)

### Newer-page fetch trigger (symmetric — only matters once user has scrolled up and we evicted from the bottom)
- When `hasNewer && !isLoadingNewer && rowsBelowViewport ≤ TOP_TRIGGER`, fetch newer.
- Fetch: `fetchChatMessagesV2({ sessionKey, afterSeq: newestLoadedSeq, limit: OLDER_PAGE })`.
- Append + evict from the top similarly.
- Set `hasNewer = (returnedCount === OLDER_PAGE)`. When `hasNewer` becomes false, we're back at the live tail.

> Tip: the "newer" direction only ever activates after the user has scrolled up and we've evicted bottom rows. As long as the user is at or near the bottom, `hasNewer = false` and live patches just append normally.

### Total invariant: `messages.length ≤ MAX_LOADED` after any single fetch settles.
- Prepend: drop from end.
- Append: drop from start.
- Live patches that add a brand-new message (last message arrived in stream): treat like append; drop from start **only if** `hasOlder === false` is also true — otherwise we silently destroy history that the user is currently looking at. (See §4 for the rule.)

---

## 3. Live-stream interaction (the part most likely to break)

Live patches come through `openPatchStreamV2` and pass through `applyChatPatch(state, frame)`. They can:
- (a) **Mutate an existing message** (status change, text delta, tool merge, runId resolution).
- (b) **Append a brand-new message** (assistant.delta with a new runId, tool-only row with new runId, etc.).
- (c) **Remove a message** (rare — message removal patch).

### Rules so virtualization does not break live updates

**Rule 1 — Patches that match a loaded message: behave exactly as today.**
The check is by `messageId` / `runId` / `gatewayIndex` inside `applyChatPatch`. If the target message is inside the current window, the patch lands. No change.

**Rule 2 — Patches that target a message *outside* the window must be ignored gracefully.**
Today, if `applyChatPatch` can't find a target for an assistant.delta, it appends a phantom "live:<runId>:tools" row. With windowing, if the user scrolled way up and a server-side patch is for an old message we evicted, the phantom would land *at the bottom of the loaded slice*, which is visually wrong.
**Mitigation**: when applying a patch, before falling through to "create phantom row," check `if (patch.sessionCursor < newestLoadedSeq - epsilon) { skip phantom creation }`. The cursorRef advance still happens; the patch is just not visualized. When the user scrolls back to the live tail, we re-fetch newer messages and pick up the up-to-date version from the projection.

**Rule 3 — Appends always land at the live tail, and the live tail is always loaded when `hasNewer === false`.**
- If user is at the live tail (`hasNewer === false`, default state), normal append + (if length > MAX_LOADED) evict-from-start. **Eviction is safe only when `hasOlder === true` is recorded so we know we can re-fetch.**
- If user has scrolled up (`hasNewer === true`), incoming live patches are **buffered, not applied to `state.messages`**, with a small "N new messages — scroll to bottom" affordance. (Optional but strongly recommended; without it, the user's scroll position will be ripped to the bottom on every patch.)
- Actually — simpler design that still preserves behavior: when `hasNewer === true`, **drop incoming patches that are newer than `newestLoadedSeq`** (don't buffer, don't render). When user scrolls down and we re-fetch newer pages, we get the up-to-date state from the projection. The "N new messages" affordance is an improvement we can add as a separate task later.

**Rule 4 — User-sent messages always land in the loaded window.**
When user sends, we immediately push the optimistic user message to `state.messages` and the assistant placeholder will arrive via live patch right after. Before pushing, if the user has scrolled up (`hasNewer === true`), we first **reset to the live tail** by fetching latest 160 and clearing the window. This matches today's "smooth jump to bottom on send" behavior.

**Rule 5 — Bootstrap recovery / `chat-bootstrap-recovery` event.**
This event already exists (`replayPatchBacklog`'s `bootstrap-recovery`). On bootstrap recovery, **always re-fetch the latest 160 and reset `hasNewer = false`**. This is the same path as initial load.

### Edge cases I see and how each is handled
| Case | Handling |
|---|---|
| Session switch | Reset all window state; initial load runs (existing reset block in ChatView already clears `state.messages`; we add `setOldestLoadedSeq(null)` etc.). |
| Pin jump to a message outside the loaded window | We're using `data-message-id` inside the loaded slice; if the target is not loaded, fall back to a centered fetch: `beforeSeq = targetSeq + 80, limit = 160`. Replace the window with the result, then `scrollIntoView`. Out of scope for this task — flag as a follow-up. The pin button is in-memory only right now (Task 5) so pinned messages will always still be in the window unless we've scrolled away and evicted. |
| Reply chip pointing to an evicted message | Same as pin jump — out of scope, flag follow-up. |
| Tool patch arriving for an evicted assistant message | Skip per Rule 2. |
| Send-during-scroll-up | Reset to live tail per Rule 4 before pushing the optimistic user message. |
| Session with fewer than 160 total messages | Initial fetch returns < 160 → `hasOlder = false`. Older-page trigger never fires. Existing behavior unchanged. |
| Two older-page fetches racing (user scrolls fast) | A single `isLoadingOlder` boolean prevents concurrent fetches. A pending fetch holds further triggers. |
| Stream patch arrives mid older-page fetch | They commute — patches mutate by ID, prepend mutates by array splice. We just need to make sure the prepend uses a functional `setState((current) => ...)`. |
| User scrolls to top while we're already at the start (`hasOlder = false`) | Nothing happens. No spinner. |
| Browser refresh / hot reload | Same as bootstrap recovery — re-fetch latest 160. |

---

## 4. Concrete state machine

New state colocated inside `ChatView`:

```ts
const [windowState, setWindowState] = useState({
  oldestLoadedSeq: null as number | null,
  newestLoadedSeq: null as number | null,
  hasOlder: false,
  hasNewer: false,
  isLoadingOlder: false,
  isLoadingNewer: false,
})
```

Five mutations:
1. `applyInitialPage(messages)` — sets all five fields based on returned page.
2. `prependOlderPage(messages, evictedCount)` — updates `oldestLoadedSeq`, `hasOlder`, `hasNewer = true if evicted > 0`, `isLoadingOlder = false`.
3. `appendNewerPage(messages, evictedCount)` — symmetric.
4. `appendLiveMessage(message)` — only runs when `hasNewer === false`. Updates `newestLoadedSeq` and may trigger eviction from start (only if `hasOlder === true`).
5. `resetToLiveTail()` — clears, then triggers an initial fetch.

All `state.messages` mutations go through `setState((current) => { ... })` so live patches and window operations don't race.

---

## 5. Integration steps (sequenced, each shippable on its own)

Each step is ≤ ~150 LOC of diff and ships as its own commit. After every step we run the verification rule (typecheck, build, manual exercise of the chat screen on the audit harness, no console errors).

### Step 1 — Add `messageWindow.ts` (pure helpers, no React)
- `computeEvictedAfterPrepend(currentLength, prependedCount, maxLoaded)` → number evicted from end.
- `computeEvictedAfterAppend(currentLength, appendedCount, maxLoaded)` → number evicted from start.
- `shouldFetchOlder({ rowsAboveViewport, hasOlder, isLoadingOlder, threshold })` → boolean.
- `shouldFetchNewer({ rowsBelowViewport, hasNewer, isLoadingNewer, threshold })` → boolean.
- `centeredWindow(targetSeq, limit)` → `{ beforeSeq, limit }`.
- Unit tests for each (10–15 cases).
- No behavior change in ChatView yet.

### Step 2 — Switch initial bootstrap to limited fetch
- `fetchChatMessagesV2({ sessionKey, beforeSeq: Number.MAX_SAFE_INTEGER, limit: 160 })`.
- Backend already supports this exactly (`beforeSeq` branch).
- Initialize `windowState`: `oldestLoadedSeq = first.gatewayIndex`, `newestLoadedSeq = last.gatewayIndex`, `hasOlder = messageCount === 160`, `hasNewer = false`.
- **No other change**. Confirm send, stream, scroll, pin still work.
- This step alone gives 80% of the perf win for fresh long sessions.

### Step 3 — Add older-page autoload
- New `useEffect` on `scrollContainerRef`'s scroll position: compute `rowsAboveViewport` via DOM measurement (first `data-message-row` whose `getBoundingClientRect().bottom >= containerTop`).
- When trigger fires, set `isLoadingOlder = true`, call `fetchChatMessagesV2({ sessionKey, beforeSeq: oldestLoadedSeq, limit: 100 })`, prepend results, evict from end, update window state.
- **Anchor scroll** in `useLayoutEffect`: capture `scrollHeight` before prepend, compute `delta = newScrollHeight - oldScrollHeight`, set `scrollTop = oldScrollTop + delta`. Pattern lifted verbatim from legacy snapshot.
- Manual test: session with > 160 messages, scroll up to top trigger, page loads silently, scroll position holds, total stays ≤ 160.

### Step 4 — Add newer-page autoload + eviction-safe live append
- Symmetric scroll trigger.
- Live-patch guard: in the existing stream-handler `setState((current) => ...)`, if the resulting `current.messages.length > MAX_LOADED`, slice from the start by `(length - MAX_LOADED)`, **only if `windowState.hasOlder === true`**.
- Patch-skip rule for evicted messages (Rule 2).

### Step 5 — Send-time reset
- Inside `handleSend`, if `windowState.hasNewer === true`, call `resetToLiveTail()` before pushing the optimistic user message.

### Step 6 — Bootstrap-recovery handler
- Listen for `chat-bootstrap-recovery` event and re-run Step 2's path.

---

## 6. Testing plan

### Unit (Vitest, in `packages/ui/components/ChatView/__tests__/messageWindow.test.ts`)
- Eviction math: 160+100=260 → drop 100, total 160.
- Trigger math: rowsAbove=60 → trigger fires; rowsAbove=61 → no trigger.
- Concurrent-fetch guard: with `isLoadingOlder=true`, returns false even at rowsAbove=0.
- `hasOlder=false` short-circuits.
- `centeredWindow` math.

### Integration (manual, on the audit harness — see Section 7)
- Fresh session with 500 fixture messages:
  - Initial paint: 160 rows visible, scroll at bottom.
  - Scroll up slowly — older page loads at 60-from-top, transition is smooth, total length stays 160.
  - Scroll back down — newer page loads, total stays 160.
  - Repeat scroll up + down 5 times — no drift, no duplicate rows, no broken keys.
- Live stream:
  - With the user at the bottom, simulate 20 streamed assistant deltas — animations work, scroll follows, total stays ≤ 160 (older rows silently drop when length would exceed).
  - User sends a message → window resets to live tail if user was scrolled up.
  - User scrolls up so we evict bottom rows → new live patches do **not** mess up the loaded view.

### Console / network audit
- DevTools Console: 0 React warnings, 0 errors during scroll cycles.
- Network panel: each older trigger fires exactly one `/api/chat/messages?beforeSeq=...&limit=100` call.
- React Profiler: per-frame render time during scroll stays < 16ms.

---

## 7. Debugging plan / safety net

Each of these is a tripwire I want in place from Step 2 onward.

1. **`frontendLog("chat", "window.{event}", { ... })`** for every window mutation (initial, prepend, append, evict, reset, live-evict). Throttled to once per 200ms on stream events. Default level `debug`.
2. **Console assertion** (dev only): after every `setState` that touches `messages`, assert `messages.length <= MAX_LOADED && messages.length >= 0`. Log + bail out (keep old state) if violated.
3. **Visible debug pill** (gated by `?debugWindow=1` query param): show `loaded N / hasOlder=X / hasNewer=Y / loading=Z` in a corner. Removed before final.
4. **Fast disable switch**: a const `VIRTUALIZATION_ENABLED = true` at the top of `ChatView`. If set to `false`, all window logic is bypassed and the behavior is byte-for-byte the current implementation. Pre-merge insurance.
5. **Regression catch**: keep the existing `state.messages` shape untouched. The new state is a separate slice. If something goes wrong I can revert by deleting the autoload effect — `state.messages` still works as today.

---

## 8. Audit harness (so we actually verify, not assume)

Before Step 2 ships, add `packages/ui/app/audit-rebuilt-chat/page.tsx` that mounts the **real `ChatView`** with:
- A fixture provider that intercepts `fetchChatMessagesV2` to return paged fixture data (500 messages) with respect for `beforeSeq` / `afterSeq` / `limit`.
- A fake `openPatchStreamV2` that pumps synthetic patches on a timer.

Then we run Playwright Chromium against the static export of this page and capture:
- Screenshot at initial paint.
- Screenshot after 3 older-page autoloads (verify total 160 in the DOM).
- Console log dump (assert empty errors).

This unblocks the verification rule for every future chat task.

---

## 9. What I am explicitly NOT doing in this batch

- DOM virtualization (limited mounted rows). Doable later on top of this; not needed for the perf wins you described.
- Persisting pins to backend (separate task).
- Jump-to-message for evicted seqs (separate task; pin and reply both depend on it but neither blocks virtualization).
- Search highlight across evicted seqs (same).
- Replacing `OCPlatformVercelChat` (audit-long-chat page); it's an unrelated test harness.

---

## 10. What I need from you before I dispatch a single sub-agent

1. **Approval of Option B** (data-window virtualization, no library) — or push back with reasoning.
2. **Confirm the constants** — `MAX_LOADED=160`, `INITIAL_PAGE=160`, `OLDER_PAGE=100`, `TOP_TRIGGER=60`. If any of these should be different, tell me now.
3. **Confirm the live-during-scroll-up behavior** — pick one:
   - (a) Silently drop patches newer than `newestLoadedSeq` (simplest, recommended).
   - (b) Buffer them and show a "N new messages" affordance.
4. **Confirm "audit harness first" is acceptable as Step 0** — it adds one extra commit before any virtualization code lands, but it pays off forever.

Once I have these, I dispatch Step 1 sub-agent (pure helpers + tests) on Opus 4.7. Each subsequent step gets its own sub-agent with the full plan attached as context.
