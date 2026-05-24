# Group 01 — Instrumentation / Diagnostics First

## Goal

Before changing behavior, add logs that expose source transitions, cursor gaps, count mismatches, stale drops, and cross-window state leakage.

## Touch first

- `packages/ui/lib/clientLogs.ts`
- `packages/ui/lib/chatTimelineDiagnostics.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/hooks/useAgentActivity.ts`

## Metrics/logs to add

### Focused/new window

- `focused.bootstrap.applied`
  - `windowId`
  - `sessionKey`
  - `bootstrapCursor`
  - `streamCursor`
  - `messageCount`
  - `spawnedSubagentCount`
  - `historyCoverage`
  - `source`: warm-cache / bootstrap / patch

### Patch cursor safety

- `patch_stream.cursor_relation`
  - `sessionKey`
  - `globalCursor`
  - `bootstrapCursor`
  - `localStateEmpty`
  - warn if `globalCursor > bootstrapCursor && localStateEmpty`

### Subagent rendering scope

- `subagents.render.scope`
  - `sessionKey`
  - `globalCount`
  - `currentTurnCount`
  - `anchoredCount`
  - `activeCount`
  - `latestUserMessageId`

### Duplicate user message candidates

- `chat.duplicate_user_candidate`
  - `messageId`
  - `gatewayIndex`
  - `createdAt`
  - `textHash`
  - `isOptimistic`
  - `source`

### Activity tab

- `activity.open`
  - `sessionKey`
  - `usedGlobalCache`
  - `historyRequestCount`
  - `subagentHistoryCount`
  - `firstPaintMs`

### Inspector state

- `inspector.session_mismatch`
  - `tab`
  - `effectiveSessionKey`
  - `activeSessionKey`
  - `projectId`
  - `windowId`

## Why first

Without these logs, fixes can hide the issue instead of correcting it. For example, making Activity render immediately before fixing bootstrap/cursors may just render wrong state faster.
