# Desktop Multi-Tab Chat Reliability + Load Test Plan

**Goal:** Make desktop chat tabs reliable under multiple open chats/panes, with proof from automated load tests before pushing.

**Architecture:** Move from view-owned chat state toward session-owned chat state. Each `sessionKey` should have one shared message store and one shared stream lifecycle in the renderer, while visible tabs/panes subscribe to that store. Background tabs should not multiply history fetches, EventSource streams, or subagent polling.

**Branch:** `ui/new-feat`

---

## Current Problem

Observed behavior:
- Response arrives in one tab but other tabs need refresh/reopen to show it.
- Opening a third tab slows network requests.

Current code notes:
- `packages/ui/hooks/useChatMessages.ts` owns message state per mounted `ChatView`.
- `packages/ui/lib/chatStream.ts` dedupes `EventSource` by `sessionKey`, but only at stream level; each mounted `useChatMessages` still has independent state, bootstrap, status, and polling.
- `packages/ui/components/AppPage.tsx` stores tab/session metadata in `editorGroups`, `tabDataRef`, and `resolvedChatCacheRef`; inactive tabs are mostly cached metadata, not live message subscribers.

Failure mode:
- UI tabs are not a reliable projection of a single session state.
- Network load scales with mounted views/subagent polling/history bootstraps instead of with unique active sessions.

---

## Success Criteria

1. If the same chat/session is visible in two panes/tabs, assistant responses appear in both without refresh.
2. If a chat is inactive and then selected, it shows the latest messages without manual refresh.
3. Opening 3-5 tabs does not create duplicate streams for the same `sessionKey`.
4. Opening 3-5 tabs does not multiply `middleware_chat_history` calls on every tab switch.
5. Message send latency and unrelated API latency remain acceptable under multi-tab load.
6. All tests and load tests pass before push.

Suggested thresholds for local load test:
- Same `sessionKey` mounted in 3 simulated views: exactly 1 active chat stream.
- 5 sessions opened: no more than 5 active chat streams.
- Tab switching 25 times: no more than 1 bootstrap/history call per stale/missing session unless forced.
- Event fan-out to 3 subscribers: all receive the same streamed assistant message within the same tick/test wait.

---

## Phase 1 — Add Load/Regression Test Harness First

### 1. Add chat stream fan-out tests

File: `packages/ui/lib/__tests__/chatStream.test.ts`

Add/verify tests for:
- Multiple subscribers to same `sessionKey` use one EventSource.
- Unsubscribing one view does not close stream while another subscriber exists.
- Events are delivered to all listeners.
- Streams close only after the last listener unsubscribes and close debounce expires.

Command:
```bash
pnpm --filter ui exec vitest run lib/__tests__/chatStream.test.ts
```

### 2. Add session store tests

Create file: `packages/ui/lib/__tests__/chatSessionStore.test.ts`

Test desired store behavior before implementation:
- `getSessionState(sessionKey)` returns one shared state object per session.
- `subscribe(sessionKey, listener)` fan-outs updates to all subscribers.
- `ensureBootstrap(sessionKey)` dedupes concurrent history/bootstrap calls.
- `applyStreamEvent(sessionKey, event)` updates shared messages once and notifies all subscribers.
- `release(sessionKey)` keeps warm state briefly, then cleans up if no subscribers.

Command:
```bash
pnpm --filter ui exec vitest run lib/__tests__/chatSessionStore.test.ts
```

Expected first run: failing tests until store is implemented.

### 3. Add lightweight load test script

Create file: `packages/ui/scripts/load-chat-tabs.mjs` or a vitest integration test under `packages/ui/lib/__tests__/chatSessionLoad.test.ts`.

Simulate:
- 1 session mounted by 3 subscribers.
- 5 unique sessions mounted once each.
- 25 tab switches with repeated subscribe/unsubscribe.
- Streaming 50 events into a session with 3 subscribers.

Measure:
- EventSource constructor count.
- `middleware_chat_history` / bootstrap count.
- Update delivery count per subscriber.
- Cleanup count.

Command:
```bash
pnpm --filter ui exec vitest run lib/__tests__/chatSessionLoad.test.ts
```

---

## Phase 2 — Implement Shared Session Store

### 4. Create shared chat session store

Create file: `packages/ui/lib/chatSessionStore.ts`

Responsibilities:
- Keep `Map<sessionKey, ChatSessionRecord>`.
- Store messages, status, errors, loading, lastBootstrapAt, subscribers, cleanup timer.
- Deduplicate bootstrap with an in-flight promise.
- Own stream subscription via `subscribeChatStream(sessionKey, ...)` once per session.
- Fan out immutable snapshots to React subscribers.
- Provide methods:
  - `subscribeChatSession(sessionKey, listener)`
  - `getChatSessionSnapshot(sessionKey)`
  - `ensureChatSessionBootstrap(sessionKey, initialMessages?)`
  - `applyChatSessionEvent(sessionKey, event)`
  - `sendChatSessionMessage(sessionKey, text, attachments?)` if useful later

Keep this small first. Do not move every `useChatMessages` feature in one giant rewrite unless needed.

### 5. Refactor `useChatMessages` to use the store

File: `packages/ui/hooks/useChatMessages.ts`

Approach:
- Keep public API stable for `ChatView`.
- Replace local duplicated message/bootstrap/stream ownership with shared store subscription.
- Preserve optimistic send behavior, stop/regenerate/edit/fork behavior.
- Move only clearly shared state first: messages, loading, status, error, stream event handling.
- Leave complex UI-only state local: selected feedback, local preview, composer-only flags, scroll triggers.

Risk control:
- Keep commits small.
- After each moved responsibility, run focused tests.

### 6. Make inactive tab activation refresh from store

File: `packages/ui/components/AppPage.tsx`

On tab select:
- Use cached `sessionKey` immediately.
- Ask store to ensure bootstrap if stale/missing.
- Do not create another independent message owner.

---

## Phase 3 — Backpressure and Cleanup

### 7. Add stale-session cleanup policy

In `chatSessionStore.ts`:
- Keep inactive session state warm for a short TTL, e.g. 2-5 minutes.
- Close stream if no subscribers and session is not generating.
- Keep completed messages cached longer than active streams.

### 8. Limit background polling

Audit `useChatMessages.ts` subagent polling and any periodic history calls:
- Poll only for visible/live sessions or centralize poll per session.
- Do not start duplicate subagent polling for the same `sessionKey`.
- Use one poll loop per session when needed.

---

## Phase 4 — Load Test Against Real Middleware

### 9. Local automated load run

Run unit/integration load tests:
```bash
pnpm --filter ui exec vitest run lib/__tests__/chatStream.test.ts lib/__tests__/chatSessionStore.test.ts lib/__tests__/chatSessionLoad.test.ts
pnpm --filter ui typecheck
pnpm --filter ui build
```

### 10. Real middleware smoke/load test

Start middleware locally if needed, then test:
- Open 1 chat, send message, confirm response.
- Open same chat in split pane, send/receive, both panes update.
- Open 3-5 tabs, send in one, switch tabs, no manual refresh needed.
- Watch browser Network tab:
  - same session should not show duplicate SSE streams.
  - requests should not grow unbounded after tab switches.

If possible, add temporary dev logging behind a flag:
- active session store count
- active stream count
- subscriber count per session
- bootstrap count per session

Remove noisy logs before push.

---

## Phase 5 — Review and Push Gate

Do not push until all pass:
```bash
pnpm --filter ui exec vitest run lib/__tests__/chatStream.test.ts lib/__tests__/chatSessionStore.test.ts lib/__tests__/chatSessionLoad.test.ts
pnpm --filter ui typecheck
pnpm --filter ui build
```

Manual verification must include:
- 2 panes same session update together.
- 3 tabs open without visible request slowdown.
- inactive tab shows latest messages when selected.
- no duplicate EventSource for same session.

Only then commit and push to `ui/new-feat`.

---

## Recommended Commit Sequence

1. `test: add chat tab reliability load coverage`
2. `feat: add shared chat session store`
3. `fix: render chat tabs from shared session state`
4. `fix: dedupe background polling for tabbed sessions`
5. `test: add real multi-tab regression coverage`

---

## Non-Goals for This Pass

- Redesigning the whole editor/tab UI.
- Changing backend streaming protocol.
- Adding new visual UI.
- Reworking spaces/projects again.
- Optimizing unrelated routes.
