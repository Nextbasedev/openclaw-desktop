# Reliable Subagent Lifecycle for Desktop B

## Problem

Desktop currently depends too much on `sessions_spawn` tool-result payloads and UI-side extraction to discover spawned subagent sessions. When the Gateway/tool result does not include a reliable `childSessionKey`, the UI can show a `sessions_spawn` card stuck in `spawning`/unlinked state even though the child subagent session exists and is emitting events.

Observed code paths:

- `apps/middleware/src/features/chat/live.ts:38-66` extracts only explicit `childSessionKey` from structured tool result data. It does not parse free-text subagent session keys.
- `apps/middleware/src/features/chat/live.ts:204-225` handles `session.message`, `sessions.changed`, `session.tool`, `chat*`, and `agent` Gateway events, but does not maintain a parent/child spawn correlation layer.
- `apps/middleware/src/features/chat/live.ts:509-515` subscribes to a child session only when `sessions_spawn` result metadata already contains a child key.
- `apps/middleware/src/features/chat/live.ts:862-883` persists and broadcasts every `sessions.changed` event as `session.upsert`, but does not use subagent-shaped sessions to link pending parent spawn calls.
- `packages/ui/lib/chat-engine-v2/store.ts:720-752` derives `spawnedSubagents` from `sessions_spawn` tool patches and extracts child key from tool/result/input payloads.
- `packages/ui/lib/chat-engine-v2/store.ts:863-877` creates a pending spawn from assistant message tool-call blocks, but only links immediately if the tool-call input already contains a subagent session key.
- Existing tests deliberately avoid UI guessing from child session shape alone: `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts:1639-1703`.

The root issue is not OpenClaw core. The missing piece is middleware-owned correlation between the parent `sessions_spawn` tool call and child subagent session events.

## Current Flow

1. User prompts the model normally.
2. Model calls `sessions_spawn`.
3. Gateway emits parent session tool/message events.
4. Middleware projects tool events into `chat.tool.*` patches.
5. UI sees a `sessions_spawn` tool and creates a `spawnedSubagents` entry.
6. If the tool result contains `childSessionKey`, UI links the child and can open/sync it.
7. If the tool result does not contain `childSessionKey`, the child may still be created and emit `sessions.changed`, `session.message`, or `session.tool` events, but the parent spawn remains unlinked.

Relevant constraints:

- Gateway event ordering is not guaranteed (`docs/constraints/gateway.md`).
- Patch bus is the single source of UI truth (`AGENTS.md`, invariant 7).
- UI should consume middleware projection/patches, not independently infer canonical lifecycle state.
- Session sync must preserve local/imported/desktop sessions (`docs/constraints/sessions.md`).
- Child subagent messages must remain isolated from parent chat history; only lifecycle/tool activity should be associated upward.

## Proposed Fix

Port the Nerve-style correlation idea into the desktop middleware/store without modifying OpenClaw core.

The middleware should own parent-child linking and emit canonical spawn lifecycle patches. The UI should stop relying on child-key guessing as the primary mechanism and instead consume normalized middleware lifecycle events.

### 1. Add middleware subagent correlation state

Add a small correlation helper under middleware, likely one of:

- `apps/middleware/src/features/chat/subagent-correlation.ts`
- or private state inside `ChatLiveIngest` if the implementation stays small

State:

- `spawnQueue`: pending `sessions_spawn` tool call IDs, ordered by first-seen time
- `spawnByToolCallId`: metadata for parent spawn, including `parentSessionKey`, `toolCallId`, optional label/task, timestamps, status
- `subagentToSpawn`: `childSessionKey -> toolCallId`
- `pendingSubagentKeys`: child session keys discovered before a matching spawn tool call exists

Use conservative matching:

- Link only when exactly one pending spawn is eligible for a discovered child session.
- If multiple parent spawns are possible, leave unresolved and log; do not guess.
- Expire unresolved pending links after a short TTL, e.g. 2-5 minutes, and emit a non-fatal unresolved/failed lifecycle if useful.

### 2. Detect `sessions_spawn` starts/results in middleware

In `apps/middleware/src/features/chat/live.ts`, extend `handleSessionTool` around the current tool projection flow:

- When `tool.name === "sessions_spawn"` and phase is start/running, enqueue the `toolCallId` as a pending spawn for the parent `sessionKey`.
- Emit canonical `chat.subagent.spawn_started` patch on the parent session.
- When result/error arrives, try to extract child session key from:
  - `tool.resultMeta`
  - live result metadata/value
  - free text fields if present
- If a child key is found, link immediately.
- If result is terminal but no child key exists, keep pending correlation alive briefly because Gateway child events can arrive late/out of order.

Improve middleware extraction by mirroring UI robustness from `packages/ui/lib/subagentSession.ts:25-119`:

- Parse explicit `childSessionKey`.
- Parse `sessionKey` when it is subagent-shaped.
- Parse JSON strings.
- Parse free text for `agent:...:subagent:...` keys.

### 3. Watch child session discovery events

Use existing event handlers in `ChatLiveIngest`:

- `session.message`
- `sessions.changed`
- `session.tool`

When any event has a `sessionKey` containing `:subagent:` or a payload with a subagent child key:

1. Register/discover the child session key.
2. Try to link it to one eligible pending spawn.
3. If linked, subscribe to that child via `ensureSessionSubscribed(childSessionKey)`.
4. Emit canonical `chat.subagent.spawn_linked` patch on the parent session with:
   - `toolCallId`
   - `childSessionKey`
   - `parentSessionKey`
   - optional `sourceEvent`

Do not copy child messages into the parent. Parent only receives lifecycle/activity metadata.

### 4. Tag child tool/activity upward canonically

When a child session is linked and middleware receives `session.tool` or status events for that child:

- Continue broadcasting the normal child-session patch under the child `sessionKey`.
- Also emit a parent-session lifecycle/activity patch such as:
  - `chat.subagent.child_activity`
  - payload includes `toolCallId`, `childSessionKey`, `subagentOf: "spawn:<toolCallId>"`, and child status/tool summary.

This gives the parent UI enough normalized data to show subagent activity without merging child transcript rows into the parent message list.

### 5. Update UI store to consume canonical lifecycle patches

In `packages/ui/lib/chat-engine-v2/store.ts`:

- Add handling for `chat.subagent.spawn_started`.
- Add handling for `chat.subagent.spawn_linked`.
- Add handling for `chat.subagent.spawn_done` / `chat.subagent.spawn_failed` if emitted.
- Add handling for `chat.subagent.child_activity` to keep linked subagent status active.

Keep existing fallback extraction from `sessions_spawn` tool patches for legacy Gateway/middleware behavior, but treat canonical middleware patches as authoritative when present.

`packages/ui/lib/subagentLifecycle.ts:34-41` already defines lifecycle events matching this shape. Reuse/extend it instead of inventing a second UI reducer.

### 6. Keep OpenClaw core unchanged

Do not modify Gateway/OpenClaw `sessions_spawn` internals for this task.

Future upstream improvement can still make `sessions_spawn` always return `{ childSessionKey, runId, mode }`, but Desktop B should work with current Gateway behavior by correlating independent events in middleware.

## Files to Change

- `apps/middleware/src/features/chat/live.ts`
  - Add spawn tracking hooks in `handleSessionTool`.
  - Discover subagent keys in `handleSessionMessage`, `handleSessionsChanged`, and `handleSessionTool`.
  - Emit canonical parent-session subagent lifecycle patches.
  - Subscribe to linked child sessions.

- `apps/middleware/src/features/chat/subagent-correlation.ts` or equivalent
  - New helper for pending spawn queue, child discovery, safe linking, TTL cleanup, and payload construction.

- `apps/middleware/src/features/chat/subagent-session.ts` or shared helper
  - Robust extraction of subagent session keys from structured payloads, JSON strings, and free text.
  - Can be modeled after `packages/ui/lib/subagentSession.ts` but should live in middleware to avoid UI dependency.

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Consume canonical `chat.subagent.*` patches.
  - Prefer canonical `spawn_linked` over result-text parsing.
  - Preserve legacy fallback parsing for existing patch streams.

- `packages/ui/lib/subagentLifecycle.ts`
  - Reuse existing lifecycle event reducer or extend it for canonical middleware patch payloads.

- `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`
  - Add UI store tests for canonical lifecycle patches.
  - Keep existing tests that prevent unsafe child-shape-only auto-linking.

- `apps/middleware/tests/` or nearby chat live tests
  - Add middleware correlation tests if a Gateway event harness exists. If not, add unit tests around the new correlation helper.

## Risks

- Wrong parent-child linking if multiple subagents spawn concurrently. Mitigation: only auto-link when exactly one pending parent spawn is eligible; otherwise leave unresolved.
- Event ordering can be arbitrary. Mitigation: support both orders: spawn first then child, child first then spawn.
- Duplicate UI entries. Mitigation: dedupe by `toolCallId` and `childSessionKey`, matching existing `dedupeSpawnedSubagents` behavior.
- Parent transcript pollution. Mitigation: never insert child messages into parent `messages`; only send parent lifecycle/activity patches.
- Status downgrade from replay/backfill. Mitigation: preserve existing downgrade guards in `store.ts` and make canonical patches monotonic where possible.
- Patch schema drift. Mitigation: use explicit `chat.subagent.*` event names and stable payload fields.

## Testing

Run after implementation:

```bash
pnpm --filter @openclaw/middleware test
pnpm --filter @openclaw/ui test -- chat-engine-v2
pnpm typecheck
```

Manual verification:

1. Prompt the model to spawn one subagent.
2. Confirm parent shows `spawning` then `working` with an enabled child link even if the raw `sessions_spawn` result lacks `childSessionKey`.
3. Confirm child tool activity appears under the parent spawn lifecycle, not as parent transcript messages.
4. Spawn two subagents close together and confirm ambiguous child discovery does not mis-link.
5. Refresh/reopen the chat and confirm linked/completed subagents remain stable.
6. Confirm no OpenClaw/Gateway source files were changed.

## Stop Point

This is a planning document only. Implementation belongs to `feature-build`.
