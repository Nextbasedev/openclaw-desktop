# Group 03 — Subagent Turn Model

## Status

**Partially complete — UI scope fix implemented on `fix/group-03-subagent-turn-model`.**

What is fixed:
- The floating composer `SubagentBar` no longer renders session-global `spawnedSubagents`.
- It uses current/latest user-turn scope derived from rendered message `sessions_spawn` tool calls.
- Activity remains whole-session scoped, so historical subagents are still available for audit/debugging.
- Regression tests cover old completed linked subagents not inflating the bottom bar and live current-turn spawns being included.

Remaining edge case to watch:
- If a future focused/new-window repro shows current-turn reconstruction mismatch because bootstrap history lacks enough message/tool ordering, add explicit anchor fields (`triggerUserMessageId`, `parentAssistantMessageId`, `turnId`) to `SpawnedSubagent` and populate them in live + bootstrap paths.

## Connected issues

- Floating subagent bar shows 8 while inline reply shows 4.
- Main window can be correct while focused/new window is wrong.
- Historical linked subagents remain in session-global `spawnedSubagents`.
- Activity and Chat render subagents using different anchoring logic.

## Files to touch first

- `packages/ui/components/ChatView/types.ts`
  - `SpawnedSubagent`
- `packages/ui/components/ChatView/index.tsx`
  - `SubagentBar` data source
  - `subagentsByTriggerUserId`
  - `getSubagentsForMessage`
- `packages/ui/components/ChatView/SubagentBar.tsx`
- `packages/ui/components/ChatView/SubagentCard.tsx`
- `packages/ui/lib/chat-engine-v2/store.ts`
  - `dedupeSpawnedSubagents`
  - `resetDetachedActivityForNewTurn`
  - `applyCanonicalToolFromPatch`
  - `applyActivityFromPatch`
- `packages/ui/hooks/useChatMessages.ts`
  - `subagentFromCanonicalTool`
  - canonical bootstrap spawns
- `packages/ui/hooks/useAgentActivity.ts`
- `packages/ui/components/inspector/activity-types.ts`
- Backend projection/patch generation if anchors need server support:
  - `apps/middleware/src/features/chat/live.ts`
  - `apps/middleware/src/features/chat/routes.ts`
  - `apps/middleware/src/features/compat/routes.ts`

## Data model decision

Add explicit fields to `SpawnedSubagent`:

- `triggerUserMessageId?: string`
- `parentAssistantMessageId?: string`
- `parentToolCallId?: string`
- `turnId?: string`

## Touch order

1. Add render-scope diagnostics.
2. Extend `SpawnedSubagent` type with optional anchor fields.
3. Fill anchor fields from live `sessions_spawn` events where possible.
4. Fill anchor fields from bootstrap/history projection where possible.
5. Change bottom `SubagentBar` to show:
   - current/latest turn active subagents, not session-global historical subagents
6. Keep historical completed subagents rendered only near their owning message/turn or inside Activity session tree.
7. Adjust `resetDetachedActivityForNewTurn` so linked completed subagents do not remain in floating current activity just because they have `sessionKey`.
8. Add tests:
   - old completed linked subagents do not inflate bottom bar
   - focused window reconstructs same current-turn count as main window

## Expected invariant

- Inline card count = current turn subagents.
- Floating bar count = current/latest active turn subagents.
- Activity tab count = whole session/activity tree.

These scopes must not be mixed.
