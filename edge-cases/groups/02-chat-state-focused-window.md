# Group 02 — Canonical Chat State + Focused Window Bootstrap

## Connected issues

- Focused/new window shows different subagent counts than main window.
- Focused/new window can miss patches because it starts from a global patch cursor.
- Warm cache/bootstrap/patch replay can race.
- Stale active state can appear only in new windows.

## Files to touch first

- `packages/ui/components/AppPage.tsx`
  - `FocusedChatWindowPage`
- `packages/ui/hooks/useChatMessages.ts`
  - initial warm/global/bootstrap selection
  - bootstrap application
  - stream subscription
- `packages/ui/lib/chat-engine-v2/store.ts`
  - `restoreGlobalCursor`
  - `openPatchStreamV2` usage
  - `seedGlobalChatSession`
  - `handlePatch`
- `packages/ui/lib/chat-engine-v2/client.ts`
  - `fetchChatBootstrapV2`
  - `openPatchStreamV2`
- `packages/ui/lib/warmChatCache.ts`
- `packages/ui/lib/chat-engine-v2/timelineStore.ts`
- Backend bootstrap route if needed:
  - `apps/middleware/src/features/chat/routes.ts`
  - `apps/middleware/src/features/compat/routes.ts`

## Touch order

1. Add diagnostics from `01-instrumentation.md`.
2. Log focused window bootstrap cursor vs stream cursor.
3. Ensure focused window starts patch replay from a session-safe cursor:
   - ideal: per-session cursor
   - acceptable: `min(globalCursor, bootstrap.cursor)` when local state is empty
4. Make bootstrap authoritative for active run/tools/subagents.
5. Gate warm-cache application so it cannot override fresh bootstrap/live state.
6. Add tests for focused window opening after subagents already spawned.

## Expected invariant

For the same `sessionKey`, after bootstrap settles:

- main window and focused window should agree on:
  - `messageCount`
  - `cursor`
  - current run status
  - active tool count
  - active/current-turn subagent count

## Do not do yet

Do not optimize Activity tab loading until focused-window reconstruction is reliable.
