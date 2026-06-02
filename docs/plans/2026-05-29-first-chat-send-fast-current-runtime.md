---
title: First chat send fast path on current desktop runtime
status: active
date: 2026-05-29
type: perf
origin: Telegram request in Desktop task B — plan first chat send without assuming a separate ChatV2 product path
---

# First chat send fast path on current desktop runtime

## Problem

First chat send must feel instant. On this branch the relevant path is not a separate product-level “ChatV2” design; the actual send path is:

- UI quick send in `packages/ui/components/AppPage.tsx`
- chat hook send in `packages/ui/hooks/useChatMessages.ts`
- frontend transport helper in `packages/ui/lib/chat-engine-v2/client.ts` that posts to `/api/chat/send`
- middleware route in `apps/middleware/src/features/chat/routes.ts`
- Gateway method `chat.send`

The current logs show the UI can spend time on unrelated startup/open work before or around first send: `/api/bootstrap`, duplicate `/api/spaces`, duplicate `/api/chats`, `/api/chat/bootstrap`, pins/models/voice settings, activity/subagent history, branch list, and logs. The plan is to make first send independent from those reads.

## Goals

- Composer usable immediately on app/chat open.
- First user message appears instantly on Enter.
- `/api/chat/send` starts within ~100ms after Enter once session key exists.
- New-chat first send should not wait for chat history/bootstrap, activity, branch list, logs, pins, or model refresh.
- Middleware `/api/chat/send` should acknowledge quickly after local optimistic persistence and enqueue Gateway work in background.

## Non-goals

- No protocol rewrite.
- No new chat runtime abstraction.
- No dependency on a hypothetical ChatV2 layer beyond existing helper names in this repo.
- No full redesign of chat history rendering.
- No loading every subagent transcript before the user asks for it.

## Current branch grounding

### UI paths

- `packages/ui/components/AppPage.tsx`
  - `handleQuickSend` creates chat/session, sets optimistic initial messages, then calls `sendChatV2(...)`.
  - `handleTopicQuickSend` creates topic session, sets initial optimistic state, then calls `sendChatV2(...)`.
  - This path can still be slowed by pre-send setup: session creation, draft model patching, route/cache updates, chat list refreshes, and post-send autonaming side effects.

- `packages/ui/hooks/useChatMessages.ts`
  - `handleSend` already does local optimistic message insertion before `sendChatV2(...)`.
  - Initial optimistic sessions skip bootstrap via `chat.bootstrap.skip-initial-optimistic`.
  - Existing first-send behavior is close, but still vulnerable to route activation/remount/bootstrap and unrelated panel requests.

- `packages/ui/lib/chat-engine-v2/client.ts`
  - `sendChatV2` is only a helper name; it posts to `/api/chat/send`.
  - Planning should describe the concrete route, not assume a separate runtime.

### Middleware paths

- `apps/middleware/src/features/chat/routes.ts`
  - `/api/chat/send` validates input, optionally creates session, optionally patches exec policy, subscribes live session, persists optimistic message/run/status locally, broadcasts optimistic patches, then enqueues Gateway `chat.send` in `SessionSendQueue`.
  - The route should return as soon as local optimistic state is durable and Gateway work is queued.
  - Heavy `chat.history limit=200` reconciliation belongs after Gateway send, never before user-visible ack.

## Key decisions

1. **First send beats hydration**
   - If a new/empty chat has an optimistic first message, skip `/api/chat/bootstrap` until after send ack or first patch.
   - Existing skip path in `useChatMessages.ts` should be preserved and expanded to route-open quick sends.

2. **Session creation is the only allowed pre-send blocker**
   - For brand-new chats, session key creation may be required.
   - Everything else should be before/after in background: model list, voice settings, pins, branch list, activity, chat list refresh, autonaming.

3. **Current transport is `/api/chat/send`**
   - Keep `sendChatV2` helper if it exists, but implementation plan must target `/api/chat/send` and `middleware_chat_send` compatibility, not a new protocol.

4. **Make UI send fire-and-confirm, not wait-and-render**
   - Render optimistic message before network.
   - Start send immediately.
   - Send promise should only control send button/error state, not composer/chat shell visibility.

5. **Lazy-load panels**
   - Activity, subagent full chat, Git branch list, logs, and branch metadata should not run on first open/send unless visible and requested.

## Implementation units

### U1 — Add first-send timing instrumentation

Files:

- `packages/ui/components/AppPage.tsx`
- `packages/ui/hooks/useChatMessages.ts`
- `apps/middleware/src/features/chat/routes.ts`

Add structured logs:

- `first_send.intent` when Enter/submit is accepted in UI.
- `first_send.optimistic_rendered` after initial message is in state.
- `first_send.transport_start` immediately before `/api/chat/send`.
- `first_send.middleware_received` at start of `/api/chat/send`.
- `first_send.middleware_ack` when route returns.
- `first_send.gateway_start` when queued Gateway `chat.send` starts.
- `first_send.first_patch_or_status` when first visible patch/status arrives.

Test scenarios:

- Existing chat send logs intent → optimistic → transport start.
- New chat quick send logs session creation duration separately from send duration.
- Middleware send logs ack before Gateway completion.

### U2 — Remove nonessential pre-send work from quick send

Files:

- `packages/ui/components/AppPage.tsx`
- `packages/ui/hooks/useChatMessages.ts`

Changes:

- In `handleQuickSend`, only do required session/chat creation before `sendChatV2`.
- Move `applyDraftModelToSession` behind the send when safe, or make it best-effort/non-blocking if default model is acceptable.
- Ensure chat list refresh and autonaming never block send.
- Ensure route/tab/cache updates happen synchronously enough to show optimistic message, but not with extra network fetches.

Test scenarios:

- New chat quick send calls `/api/chat/send` before autonaming starts.
- New chat quick send calls `/api/chat/send` before chat list refetch/refresh.
- If draft model patch fails, first send still proceeds with default model and surfaces a non-blocking warning only if needed.

### U3 — Strengthen bootstrap skip for optimistic first chats

Files:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/query.ts` if query key behavior needs adjustment

Changes:

- Treat `initialMessages.length > 0` as authoritative enough to render chat and skip immediate bootstrap.
- Do not trigger bootstrap recovery for that session until either first Gateway/patch event arrives or a short delayed reconciliation window opens.
- Keep patch stream subscription active, but do not let scoped recovery force immediate heavy bootstrap during first-send window.

Test scenarios:

- Initial optimistic chat does not call `/api/chat/bootstrap` before `/api/chat/send`.
- Initial optimistic chat still receives later patches and reconciles final assistant response.
- If send fails, skipped bootstrap does not hide failure state.

### U4 — Request dedupe for startup/open reads

Files:

- `packages/ui/lib/requestDedupe.ts`
- `packages/ui/components/AppPage.tsx`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/hooks/useAgentActivity.ts`

Changes:

- Dedupe in-flight reads for:
  - `spaces`
  - `chats:<spaceId>`
  - `chat-bootstrap:<sessionKey>`
  - `activity-history:<sessionKey>`
  - `pins`
  - `models`
- StrictMode/remount should share promises and not duplicate network calls.

Test scenarios:

- Two route activation effects for same chat create one `/api/chats` request.
- Two Activity mounts create one `middleware_chat_history` request.
- Two bootstrap triggers for same session reuse one fetch unless explicitly invalidated.

### U5 — Middleware `/api/chat/send` ack audit

Files:

- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/tests/send.test.ts`

Changes:

- Verify route returns after local optimistic message/status patch and enqueue, not after Gateway `chat.send` or `chat.history`.
- If `ensureSessionSubscribed` is slow, make it bounded or non-blocking for first send once local optimistic patches are persisted.
- Ensure `sessions.create` is only performed when truly missing; no history load before send.

Test scenarios:

- `/api/chat/send` returns accepted while Gateway `chat.send` promise is still pending.
- `/api/chat/send` broadcasts optimistic user/status before Gateway resolves.
- No `chat.history` Gateway call before route ack.
- Existing `apps/middleware/tests/send.test.ts` “accepts send before Gateway chat.send finishes” remains passing and is expanded to assert no pre-ack history call.

### U6 — Lazy-load heavy side panels

Files:

- `packages/ui/components/inspector/InspectorView.tsx`
- `packages/ui/components/inspector/ActivityTab.tsx`
- `packages/ui/hooks/useAgentActivity.ts`
- `packages/ui/components/ChatView/SubagentFullChat.tsx`
- `packages/ui/hooks/useSubagentMessages.ts`
- `packages/ui/components/terminal/XTerminal.tsx` only if terminal mounts early

Changes:

- Activity history loads only when Activity tab is visible.
- Subagent transcript loads only when a specific subagent is opened.
- Git branch list loads only when Git tab is visible.
- Logs load only when Logs panel is visible.

Test scenarios:

- Open app to chat route: no Activity `middleware_chat_history` unless Activity visible.
- Open app to chat route: no subagent `/api/chat/bootstrap` calls unless subagent selected.
- Git branch list does not fire on chat first paint.

## Validation plan

- Unit/route tests:
  - `apps/middleware/tests/send.test.ts`
  - focused UI tests if existing harness covers `useChatMessages`
- Manual timing run:
  - cold app open to new chat
  - type message, press Enter
  - collect logs for timing events
- Required success thresholds:
  - optimistic message render: immediate / same frame
  - `/api/chat/send` starts within ~100ms after Enter once session key exists
  - `/api/chat/send` ack returns without waiting for Gateway final answer/history
  - no duplicate `/api/chat/bootstrap` before first send on optimistic new chat
  - no Activity/subagent transcript fanout during first send

## Risks

- Moving draft model patch after send could use wrong model for first message. If model choice must be strict, keep model patch pre-send but measure it separately and cache/pre-apply draft model earlier.
- Skipping bootstrap too aggressively can miss old history for existing chats. Limit skip to initial optimistic/new-chat sessions.
- Non-blocking `ensureSessionSubscribed` may delay patch delivery if websocket is not ready. UI must rely on optimistic local state and fallback reconcile.

## Recommended execution order

1. Add timing logs first.
2. Remove nonessential pre-send work in `AppPage.tsx` quick send.
3. Strengthen optimistic bootstrap skip in `useChatMessages.ts`.
4. Add request dedupe for duplicate startup reads.
5. Audit `/api/chat/send` ack path and tests.
6. Lazy-load side-panel reads.

## Expected outcome

The first chat send should feel instant because only session key creation and the `/api/chat/send` POST remain in the critical path. Everything else becomes cached, deduped, delayed, or visibility-triggered.
