# Chat Switch Latency Plan

## Problem

Clicking a chat from the sidebar can feel delayed: the click/selection appears to respond after ~0.5-1s, and chat content can take another ~1-2s. From the supplied log, this is real latency, not just perception:

- Empty Telegram Direct bootstrap is fast (`~48ms`), but heavy migrated Telegram bootstraps take `~700ms`, `~1.2s`, `~1.5s`, `~2.0s`, and up to `~2.7s`.
- Multiple `/api/chat/bootstrap` requests are launched while switching quickly, so Gateway `pendingRequests` climbs and some requests wait behind others.
- Side requests (`middleware_models_list`, `middleware_branch_list`, `middleware_pins_list`, voice settings) run near the same time and add UI/network pressure.
- Prior PR #60 decouples `middleware_branch_list` from blocking chat bootstrap, but it does not address all switch latency.

## Current Flow

### Sidebar click / active chat selection

`packages/ui/components/AppPage.tsx`:

- `handleChatSelect()` starts at `AppPage.tsx:1183`.
- It clears composer/topic state and sets `activeTab` immediately.
- It applies cached/resolved chat selection immediately only if either:
  - `resolvedChatCacheRef.current` has the chat id, or
  - the sidebar chat already has a real `sessionKey`.
- If the selected chat lacks a session key and is not in `resolvedChatCacheRef`, it waits for `ensureChatSession(chat, { activeSpaceId })` before applying selection.
- `ensureChatSession()` in `packages/ui/lib/sessionNavigation.ts:63` returns immediately when `chat.sessionKey` exists, but otherwise creates/attaches a standalone session through middleware.

### Route-based chat open

`AppPage.tsx:788` route chat handling:

- Sets a temporary `activeChat` (`Opening chat...`) and clears session key.
- Loads cached chats, then fetches chats from middleware, sometimes all-space chats.
- Calls `ensureChatSession()` before setting the final active session.

### Chat data bootstrap

`packages/ui/hooks/useChatMessages.ts`:

- Initial state uses global session cache or cached bootstrap only when there are messages (`initialGlobalSession?.messages?.length`, `warmBootstrapMessages(...)`). Known-empty sessions do not currently count as warm loaded state.
- Without warm messages, `loading` starts true and a visible timeout fires at 6s.
- Fresh bootstrap fetches `/api/chat/bootstrap`, parses history, seeds global chat state and cursor, then sets `loading=false`.
- Prior fix PR #60 removes branch metadata from blocking bootstrap, but `/api/chat/bootstrap` itself can still take 0.7-2.7s for heavy migrated chats.

## Root Causes

1. **Selection can wait for session resolution.** If a chat record lacks `sessionKey`, `handleChatSelect()` may not visually switch to the chat until after `ensureChatSession()` completes. This makes the click feel delayed.
2. **Known-empty state is not treated as warm loaded state.** Existing global/bootstrap state with `messageCount:0` is valid, but the hook uses message presence as the main warm criterion, so empty chats still show loading until fresh bootstrap completes.
3. **Heavy chat bootstrap remains blocking for content.** `/api/chat/bootstrap` re-checks Gateway history, archive imports, tool inference, possible resequencing, and message read before returning.
4. **Stale/parallel bootstraps create pressure.** Rapid switching starts multiple bootstrap requests; old requests may continue even after the user switches away. UI correctly ignores stale results, but middleware/Gateway work still happens.
5. **Side requests add perceived slowness.** Models/pins/branches/voice settings requests run around chat switching. PR #60 removes branch metadata from the chat bootstrap promise, but other side requests still occur.

## Proposed Fix

Implement as a performance pass, not a workaround.

### Phase 1 — Make selection visually immediate

- In `handleChatSelect()`, apply a provisional selection immediately for every clicked chat:
  - set `activeChat(chat)`
  - set `activeSessionKey(chat.sessionKey ?? null)`
  - push route immediately
  - add/update tab with available chat name
- Continue resolving `ensureChatSession()` asynchronously.
- When resolution finishes and request id still matches, update `activeSessionKey`, title, tab/session data.
- Avoid clearing the visible chat area unnecessarily if selecting a known chat while session resolution is pending.

### Phase 2 — Treat known-empty sessions as loaded warm state

- Extend warm/global/bootstrap checks in `useChatMessages()` so a cached/global session with `messageCount:0`, cursor/status, or explicit known-empty metadata is considered usable warm state.
- For known-empty state, initialize `loading=false`, `historyLoadVersion=1`, status from cache/global session, and messages `[]`.
- Still fetch fresh bootstrap in background to keep authoritative projection current.

### Phase 3 — Prevent stale bootstrap pressure

- Add request-level cancellation or active-request coalescing for chat bootstrap where practical:
  - UI should not start duplicate fresh bootstrap for the same session while one is in flight.
  - Results for non-current sessions should remain ignored.
  - Consider adding `AbortSignal` support to `fetchChatBootstrapV2` if the middleware fetch wrapper supports it.
- If full abort is not supported, add tighter dedupe/caching around `queryKeys.chatBootstrap(sessionKey)` and avoid invalidating dedupe on every mount unless necessary.

### Phase 4 — Keep side data outside critical path

- Keep PR #60 behavior: branch metadata async, not blocking chat render.
- Audit models/pins/voice settings triggers so they do not fire on every chat switch unless the UI panel requiring them is visible or stale.
- Prefer caching with TTL for these sidebar/header requests.

## Files to Change

- `packages/ui/components/AppPage.tsx`
  - Make `handleChatSelect()` and route chat handling apply visible selection immediately.
  - Ensure async session resolution updates only the latest route/request.
  - Preserve per-window tab/session data behavior.

- `packages/ui/hooks/useChatMessages.ts`
  - Treat known-empty global/bootstrap state as loaded.
  - Avoid showing 6s loading timeout for a known-empty chat.
  - Preserve patch cursor seeding before stream open.
  - Review `invalidateDedupe(chat-bootstrap)` behavior so it does not force unnecessary duplicate fetches on rapid switches.

- `packages/ui/lib/chat-engine-v2/store.ts` / related cache types if needed
  - Add explicit known-empty/session cursor metadata if current store shape cannot represent it without messages.

- `packages/ui/lib/chatBootstrap.ts` or API helpers if applicable
  - Add abort/coalescing support only if available without large refactor.

## Risks

- Showing provisional chat before session resolution could create a temporary state with `activeChat` but no `activeSessionKey`. Existing code already has some route paths with this state (`Opening chat...`), but components must handle it safely.
- Treating empty cached state as loaded must not suppress a real fresh bootstrap forever. It should only improve initial render; fresh bootstrap still runs.
- Patch stream cursor seeding must remain correct. Do not open replay from cursor 0 when warm/global/bootstrap cursor exists.
- Scroll constraints still apply: initial chat open scrolls to bottom only when messages exist; empty chat should not trigger weird scroll behavior.
- Do not block or alter tool/thinking/status lifecycle; this is switch/render performance.

## Testing

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Add focused tests if existing utilities allow:
  - `handleChatSelect` applies provisional selection before async `ensureChatSession` resolves.
  - Known-empty cached/bootstrap state initializes with `loading=false` and no messages.
  - Rapid chat switch ignores stale bootstrap result and keeps latest active chat.
- Manual/perf verification with logs:
  - Click `Telegram direct` empty chat: `active-chat.change` should log immediately, composer visible before fresh bootstrap finishes.
  - Empty chat should no longer wait 6s timeout.
  - Heavy chat with warm/global state should show cached content immediately while fresh bootstrap finishes.
  - Rapid switching should not visibly revert to stale chat when old bootstrap completes.
