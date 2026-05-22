# Chat Refresh Replay and Send Reconciliation Fix

## Problem

The desktop chat could show only tool cards, briefly reset messages after refresh, or attach the next answer/tool state to the wrong turn after sending a new message.

Evidence from production logs:

- `/api/chat/bootstrap` for the active session returned correct canonical data: `messageCount:160`, `cursor:399`, `source: middleware-projection`.
- On refresh, the frontend WebSocket opened with `afterCursor:0`, causing a replay of hundreds of global patches, most for unrelated sessions.
- Old replayed patches for the active session could arrive before canonical bootstrap subscription and reset the global chat state.
- During send, live `session.message` confirmed the optimistic user, but subsequent history reconciliation logged `currentUserRepresented:false` and skipped many current-run messages as stale.

## Current Flow

Refresh path:

1. `packages/ui/hooks/useChatMessages.ts` mounts chat.
2. It called `ensureGlobalChatEngine(queryClient)` before seeding warm/bootstrap cursor state.
3. `packages/ui/lib/chat-engine-v2/store.ts` restored `globalCursor`, but on fresh reload with no persisted cursor this opened `/api/stream/ws?afterCursor=0`.
4. Backlog replay delivered global patches for unrelated sessions and old active-session bootstrap/tool patches.
5. Later `/api/chat/bootstrap` loaded the correct active session state.

Send path:

1. `apps/middleware/src/features/chat/routes.ts` creates an optimistic user message and broadcasts `chat.message.upsert` + `chat.status`.
2. Gateway live event can confirm that optimistic user via `ChatLive.handleSessionMessage()`.
3. `chat.send` then loads `chat.history` and tries to find a text-matching Gateway user echo.
4. If history text does not match exactly or the current user was already confirmed by live event, reconciliation could mark `currentUserRepresented:false`.
5. Current-run assistant/tool messages were then skipped as stale, leaving the UI with old/orphan tool state.

## Proposed Fix

1. Seed global chat state with warm/bootstrap cursor before opening the global patch stream.
2. Preserve the current optimistic/live-confirmed user as the send boundary during post-send history reconciliation.
3. Add a repository lookup for an already-confirmed optimistic message by id.
4. Log whether the history user echo matched by text, so production debugging can distinguish exact Gateway history echo from live-confirmed fallback.

## Files Changed

- `packages/ui/hooks/useChatMessages.ts`
  - Moves `ensureGlobalChatEngine(queryClient)` until after warm/global/bootstrap cache has seeded cursor state.
  - Seeds `seedGlobalChatSession()` from warm cached bootstrap/local warm cache when a cursor is available.

- `apps/middleware/src/features/chat/routes.ts`
  - Uses `context.messages.findMessageById()` to detect a live-confirmed optimistic user when history does not include a text-matching echo.
  - Treats that live-confirmed user as the current send boundary for stale-history filtering.

- `apps/middleware/src/features/chat/repo.messages.ts`
  - Adds `findMessageById(sessionKey, messageId)` helper.

## Risks

- Cursor seeding must not hide truly newer live patches. This is mitigated by existing global state cursor monotonicity and bootstrap recovery.
- Live-confirmed fallback must not confirm an unrelated stale Gateway user. The fix only uses fallback when the existing optimistic message id is present and no longer marked optimistic.
- Gateway `chat.send` can return done before final assistant history appears; middleware still must not prematurely finalize unless history confirms completion.

## Testing

Executed on `dev-2-temp`:

- `pnpm --filter @openclaw/desktop-middleware typecheck` ✅
- `pnpm --filter ui typecheck` ✅
- `pnpm --filter @openclaw/desktop-middleware test` ✅ — 135 passed
- `pnpm --filter ui build` ✅

Manual testing checklist for testing server:

- Refresh heavy migrated Telegram chat: should not render only orphan tool cards.
- Send message after refresh: answer should stay under the new user message.
- Thinking should not disappear just because bootstrap/history reconciliation runs.
- WebSocket logs should show a non-zero `afterCursor` when warm/bootstrap cursor exists.
- Send logs should no longer show `currentUserRepresented:false` after a live-confirmed optimistic user.
