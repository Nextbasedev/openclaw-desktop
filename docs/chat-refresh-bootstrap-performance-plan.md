# Chat Refresh Bootstrap Performance Fix

## Problem
Refreshing Desktop with many restored chat tabs can leave the app empty or slow for seconds/minutes.

Two bugs were confirmed from production logs:

1. **Middleware bootstrap critical path is too heavy.** `GET /api/chat/bootstrap` calls Gateway `chat.history`, then imports archived transcript files, resequences thousands of messages, and waits for live subscription before returning. In production this caused bootstrap requests to take 11s–71s and made app startup calls abort after the frontend 8s timeout.
2. **Frontend treats empty patch replay as authoritative.** Patch stream replay sends `chat.bootstrap` events whose payload only has `messageCount`/cursor metadata, not message history. The global chat store creates an empty session for those patches. `useChatMessages()` then treats that empty global session as known-empty and renders `loading:false` with `messageCount:0` until real `/api/chat/bootstrap` returns.

## Current Flow

### Middleware

`apps/middleware/src/features/chat/routes.ts` `/api/chat/bootstrap` currently:

1. Calls `context.gateway.request("chat.history")`.
2. Normalizes current history messages.
3. Calls `persistArchivedHistorySegments()` synchronously.
4. If archive import changed, calls `context.messages.resequenceSessionMessages()` synchronously.
5. Upserts current messages and reads latest projected messages.
6. Awaits `context.chatLive.ensureSessionSubscribed(sessionKey)`.
7. Appends a `chat.bootstrap` projection event and returns snapshot.

The archive import/resequence and live subscribe steps are not required for the initial visible response, but currently block it.

### Frontend

`packages/ui/hooks/useChatMessages.ts` currently:

1. Reads `getGlobalChatSession(sessionKey)` before reading query/warm bootstrap cache.
2. Treats `globalSession.messages.length === 0 && cursor` as a known-empty loaded state.
3. In the effect, `cachedGlobalKnownEmpty` makes `useCachedGlobal` true and `knownEmptyState` true.
4. This suppresses loading and paints an empty chat even when the only source was a replayed metadata-only `chat.bootstrap` patch.

## Proposed Fix

### Middleware

- Keep Gateway `chat.history` and current message projection in bootstrap, because bootstrap remains the authoritative refresh path.
- Move archived transcript import + resequence out of the synchronous response path.
- Add a per-session in-flight guard so repeated bootstraps schedule at most one archive projection job per session.
- Make `ensureSessionSubscribed()` fire-and-forget from bootstrap so a slow `sessions.messages.subscribe` cannot block visible messages.
- Log background archive/import/resequence timing separately.

### Frontend

- Never treat a global chat session with zero messages as an authoritative known-empty state.
- Let known-empty fast path apply only to actual cached `/api/chat/bootstrap` query data.
- Allow query/warm bootstrap cache to be consulted even if a global session exists but has zero messages.
- Prefer warm/cache messages over empty global placeholders.

## Files to Change

- `apps/middleware/src/features/chat/routes.ts`
  - Add background archive projection scheduler with per-session in-flight map.
  - Use it in `/api/chat/bootstrap` instead of synchronous archive import/resequence.
  - Do not await live subscription in bootstrap.

- `packages/ui/hooks/useChatMessages.ts`
  - Remove global-empty known-empty behavior.
  - Read cached bootstrap when global state has no messages.

- `docs/constraints/chat-engine.md`
  - Add invariant that replayed metadata-only `chat.bootstrap` patches must not mark a chat as loaded-empty.

- `docs/constraints/middleware.md`
  - Add invariant that chat bootstrap must not synchronously import/resequence archives or wait on live subscription.

- `docs/lessons/2026-05-22-chat-refresh-bootstrap-performance.md`
  - Record the bug and fix.

## Risks

- Moving archive import async means old archived transcript segments may appear after the first bootstrap instead of before it. This is acceptable only if the background job emits a recovery/refresh signal when it changes visible history, so already-open chats refetch instead of remaining on the first snapshot.
- Fire-and-forget subscription means live events may attach slightly after bootstrap response. The UI separately opens the patch stream, and subscription should not block historical messages.
- Removing global-empty known-empty means truly empty chats may show loading until bootstrap returns. This is safer than showing non-empty chats as empty from placeholder patches.

## Testing

- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter @openclaw/desktop-middleware test -- --runInBand`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Focused tests if practical:
  - Middleware bootstrap should return without awaiting archive projection/subscription.
  - UI should not initialize loaded-empty from zero-message global state when no real bootstrap cache exists.
