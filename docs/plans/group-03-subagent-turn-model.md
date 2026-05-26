# Group 03 — Subagent Turn Model Plan

## Problem

The floating subagent bar is currently session-global, while inline subagent cards are message/turn-derived. This mixes two different scopes:

- **Floating bar should be current/latest turn scoped** — only subagents spawned by the active/latest user turn should count.
- **Activity tab can remain whole-session scoped** — it should continue showing all historical tools/subagents for debugging and audit context.

Current code path that causes the mismatch:

- `SpawnedSubagent` has only global-ish identity fields (`id`, `sessionKey`, `toolCallId`) and no explicit turn/message anchor (`packages/ui/components/ChatView/types.ts:122-129`).
- `ChatView` already reconstructs message/turn anchoring by scanning rendered messages and matching `sessions_spawn` tool calls (`packages/ui/components/ChatView/index.tsx:1246-1313`).
- But the bottom floating bar ignores that scoped reconstruction and renders the full `spawnedSubagents` array (`packages/ui/components/ChatView/index.tsx:1816-1819`).
- Store state keeps linked historical spawns when a new turn starts if they still have a `sessionKey` (`packages/ui/lib/chat-engine-v2/store.ts:1056-1064`), which is fine for session/activity history but wrong as the floating-bar source.

Observed/expected bug shape:

- Old turn spawned 4 subagents.
- Current turn spawned 4 subagents.
- Inline current reply correctly shows 4.
- Floating bar can show 8 because it receives the session-global list.

## Current Flow

1. Middleware/Gateway tool events produce `sessions_spawn` tool calls.
2. UI/global chat store tracks spawn activity in `state.spawnedSubagents`.
   - Live message-derived spawn creation happens in `applyActivityFromPatch` (`packages/ui/lib/chat-engine-v2/store.ts:826-882`).
   - Canonical/bootstrap spawn reconstruction happens through `subagentFromCanonicalTool` (`packages/ui/hooks/useChatMessages.ts:476-486`).
3. `ChatView` builds `spawnsByToolCallId` from the whole session-global spawn list (`packages/ui/components/ChatView/index.tsx:1246-1252`).
4. `getSubagentsForMessage()` matches each assistant message's `sessions_spawn` tool calls to spawned subagents (`packages/ui/components/ChatView/index.tsx:1254-1267`).
5. `subagentsByTriggerUserId` groups matched subagents under the nearest preceding user message (`packages/ui/components/ChatView/index.tsx:1269-1313`).
6. Inline cards use this message/turn-derived scope.
7. The floating `SubagentBar` still uses raw `spawnedSubagents`, so it includes historical session subagents (`packages/ui/components/ChatView/index.tsx:1816-1819`).
8. Activity tab receives session-level activity separately and should keep that behavior.

## Proposed Fix

### 1. Treat scope as a UI contract first

Use existing rendered-message reconstruction to compute a current-turn subagent list in `ChatView`:

- Find `latestUserMessageId` from rendered messages.
- Use `subagentsByTriggerUserId.get(latestUserMessageId)` as the primary current-turn bar source.
- While a run is active and the latest user row has pending live `sessions_spawn` tools, include those live/pending current-turn spawns too.
- If a spawn cannot yet be anchored but is actively spawning/linking/working in the current run, temporarily show it only while active, then move it inline once the assistant/tool message arrives.

### 2. Feed the floating bar scoped data

Replace:

```tsx
<SubagentBar subagents={spawnedSubagents} ... />
```

with a derived `currentTurnSubagents`:

```tsx
const currentTurnSubagents = ... // latest user turn only
<SubagentBar subagents={currentTurnSubagents} ... />
```

The floating bar should not read the session-global `spawnedSubagents` directly.

### 3. Keep Activity whole-session scoped

Do **not** change `useAgentActivity`, `chatActivityStore`, or inspector Activity rendering unless diagnostics prove they are corrupting ChatView state. Activity remains the session-wide view.

### 4. Add explicit anchors only if needed

Existing reconstruction may be enough for ChatView. If focused/new windows still disagree with main window after the scoped bar fix, extend `SpawnedSubagent` with optional anchors:

- `triggerUserMessageId?: string`
- `parentAssistantMessageId?: string`
- `parentToolCallId?: string`
- `turnId?: string`

Then populate those fields in:

- live `applyActivityFromPatch`
- canonical/bootstrap `subagentFromCanonicalTool`
- any backend projection route if the client cannot infer anchors reliably from history

Do this only after confirming the UI-only scoped bar still has reconstruction gaps.

## Files to Change

- `packages/ui/components/ChatView/index.tsx`
  - Add `currentTurnSubagents` derived from `subagentsByTriggerUserId`, `latestUserMessageId`, and active live spawns.
  - Render `SubagentBar` from `currentTurnSubagents`, not `spawnedSubagents`.
  - Keep existing diagnostics but add `floatingBarCount` / `currentTurnBarCount` to make regressions obvious.

- `packages/ui/components/ChatView/SubagentBar.tsx`
  - Likely no functional changes needed; it should remain a pure display component receiving already-scoped data.
  - Optional: rename prop docs/comment to clarify `subagents` must already be current-turn scoped.

- `packages/ui/components/ChatView/types.ts` *(optional, only if UI-only inference is insufficient)*
  - Add optional anchor fields to `SpawnedSubagent`.

- `packages/ui/lib/chat-engine-v2/store.ts` *(optional, only if anchors are added)*
  - Populate/preserve anchor fields in `applyActivityFromPatch`, `applyCanonicalToolFromPatch`, and dedupe/merge paths.
  - Do not delete session-global completed linked spawns just to fix the floating bar; that would break Activity/history semantics.

- `packages/ui/hooks/useChatMessages.ts` *(optional, only if anchors are added)*
  - Populate anchor fields during canonical/bootstrap spawn reconstruction.

- `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts` or a ChatView-focused test file
  - Add regression tests for current-turn bar count vs session-global activity count.

## Risks

- **Focused/new window mismatch:** If history/bootstrap lacks enough tool/message ordering to reconstruct turn ownership, the main window and focused window may compute different current-turn scopes. Mitigation: add explicit anchors after first UI-only pass if needed.
- **Unanchored live spawn flicker:** A live spawn may exist before its assistant/tool row is visible. Mitigation: allow active unanchored spawns into the bar only while active and only for the current active run.
- **Accidentally hiding useful history:** Do not filter `spawnedSubagents` globally in the store just to fix the bar. Activity/history should remain whole-session.
- **Duplicate display:** A subagent can appear both inline and in the floating bar for the current turn. That is acceptable while active/current, but old completed subagents must not remain in the bar after a new user turn.

## Testing

### Automated

- `pnpm --filter ui typecheck`
- Add/run focused tests for:
  - Old completed linked subagents do not inflate the bottom `SubagentBar` after a new user turn.
  - Current/latest turn subagents still render in the bar.
  - Activity/session state still contains all historical subagents.
  - Focused/new window bootstrap reconstructs the same current-turn count as the main window if enough message history exists.

Suggested command after tests exist:

```bash
pnpm --filter ui exec vitest run lib/chat-engine-v2/__tests__/store.test.ts
```

### Manual/live

1. Start from `v3` on branch `fix/group-03-subagent-turn-model`.
2. Use a session that spawns subagents in multiple turns.
3. Confirm old turn completed subagents remain visible in Activity.
4. Send a new message that spawns fewer subagents.
5. Confirm:
   - inline current reply count equals the current turn count
   - floating bar count equals the current turn count
   - Activity still shows whole-session history
6. Open the same chat in focused/new window and confirm the floating bar count matches the main window.

## Stop Point

This document is the feature-plan output. Do not implement in this step; use `feature-build` for code changes.
