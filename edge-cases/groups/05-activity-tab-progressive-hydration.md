# Group 05 — Activity Tab Progressive Hydration

## Connected issues

- Activity tab loading for 3-4 seconds despite chat showing activity.
- Subagent history waterfall.
- Live patches + history backfill race.

## Files to touch first

- `packages/ui/components/inspector/ActivityTab.tsx`
- `packages/ui/hooks/useAgentActivity.ts`
- `packages/ui/components/inspector/activity-types.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/client.ts`
- `apps/middleware/src/features/compat/routes.ts`

## Must happen after

- `02-chat-state-focused-window.md`
- `03-subagent-turn-model.md`

Activity should not be made faster until the state it renders is correctly scoped and reconstructable.

## Touch order

1. Add Activity open/first-paint diagnostics.
2. On open, synchronously project from `getGlobalChatSession(sessionKey)`.
3. Render this immediately with a “syncing details” state instead of full skeleton.
4. Start main history fetch in background.
5. Fetch subagent histories lazily/background with concurrency cap.
6. Use request sequence guards so older history cannot overwrite newer live state.
7. Dedupe `middleware_chat_history` requests per sessionKey.
8. Add tests for:
   - live global state paints without waiting for history
   - child history waterfall does not block parent UI

## Expected invariant

Activity first paint should be based on already-known live/global state. Detailed history can hydrate later.
