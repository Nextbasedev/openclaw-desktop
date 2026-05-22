# Fix Empty Bootstrap Replay History Pollution

## Problem

Opening two windows or switching chats quickly can make one chat briefly or persistently show empty/different history. The failure is caused by the UI treating global patch replay `chat.bootstrap` frames as equivalent to a full `/api/chat/bootstrap` history load.

From the supplied production log:

- The UI opens `youtube to text`, then the global chat engine connects with `afterCursor:938`.
- The patch stream replays `chat.bootstrap` patches for several unrelated sessions (`df601fcb`, `82028e20`, `676115a8`, `720c290e`, etc.). Several have `messageCount:0`.
- Rapid navigation then mounts `skills`, `Update`, and `openAi or Anthropic Blog` while their full `/api/chat/bootstrap` requests are still in flight.
- Later full bootstraps return real history (`rawMessageCount:160`, parsed `messageCount:74` for one chat), proving the earlier empty global state was not authoritative full history.

The current code has three contributing points:

1. `packages/ui/lib/chat-engine-v2/applyPatches.ts:240-242` advances a session cursor for any patch with no message, including `chat.bootstrap`, without marking whether that frame contained full history.
2. `packages/ui/lib/chat-engine-v2/store.ts:1139-1230` applies replayed patches into the global session store for all sessions, including background sessions created by patch replay.
3. `packages/ui/hooks/useChatMessages.ts:503-505` and `1288-1304` treat an empty global session with any numeric cursor as a known-loaded empty chat. That is valid only for a full bootstrap/source-of-truth load, not for a skeletal replay frame.

This conflicts with `docs/constraints/chat-engine.md`: replayed `chat.bootstrap` patches are not the source of truth for the active chat when a fresher `/api/chat/bootstrap` cursor is needed.

## Current Flow

### Middleware bootstrap

`apps/middleware/src/features/chat/routes.ts:1016-1134` handles `GET /api/chat/bootstrap`:

1. Fetches Gateway `chat.history`.
2. Normalizes and persists projected messages.
3. Reads projected messages from SQLite.
4. Appends a projection event:
   - `eventType: "chat.bootstrap"`
   - payload currently includes `{ sessionKey, messageCount, lastSeq }` only.
5. Returns `buildChatBootstrapSnapshot(...)` with the actual messages, cursor, status, tools, and projection metadata.

The projection event is intentionally lightweight. It does not carry the full message array.

### Global patch replay

`packages/ui/lib/chat-engine-v2/store.ts:1280-1291` opens a global patch stream using the persisted cursor. Replay can include old `chat.bootstrap` events for many sessions.

For each patch:

1. `handlePatch()` creates/updates global `SessionState` by `sessionKey`.
2. `applyChatPatch()` receives the frame.
3. If the patch has no message, `applyChatPatch()` returns the same messages with an advanced cursor (`applyPatches.ts:240-242`).
4. `notify()` broadcasts that global session state.

For a replayed bootstrap event with no message, this means: `messages=[]`, `cursor=<replayed cursor>`, `status` potentially updated from payload/defaults. No code distinguishes this from a real full-history empty bootstrap.

### Chat mount / warm state

`packages/ui/hooks/useChatMessages.ts` checks global state before fetching fresh bootstrap:

- Initial state marks empty global sessions with a numeric cursor as `initialKnownEmpty` (`useChatMessages.ts:503-505`).
- On mount it sets `cachedGlobalKnownEmpty` when `messages.length === 0 && typeof cursor === "number"` (`useChatMessages.ts:1288`).
- It then uses that global state as loaded and sets `loading=false`, `messages=[]`, and advances `historyLoadVersion` (`useChatMessages.ts:1372-1405`).

That behavior is correct for a real empty chat loaded from full bootstrap. It is unsafe for skeletal replay-created sessions.

## Root Cause

The global chat store has only one notion of empty state: `messages.length === 0` with a cursor. It needs to distinguish two different states:

1. **Full-history empty** — `/api/chat/bootstrap` or another authoritative source loaded the session and confirmed it has zero messages.
2. **Skeletal replay empty** — the global stream replayed a lightweight `chat.bootstrap` event with `messageCount:0` but no messages. This is cursor/status metadata only, not proof that the chat history is empty.

The latency optimization made this sharper by treating numeric-cursor empty global state as loaded. The scalable fix is to encode source/coverage explicitly, not to hide loading or special-case individual chat names.

## Proposed Fix

Implement an explicit global session hydration/source model.

### 1. Add source/coverage metadata to `SessionState`

In `packages/ui/lib/chat-engine-v2/store.ts`, extend `SessionState` with something like:

```ts
type HistoryCoverage = "none" | "metadata" | "full"

type SessionState = {
  cursor: number
  messages: ChatMessage[]
  historyCoverage: HistoryCoverage
  messageCount: number | null
  hydratedFrom: "patch-replay" | "full-bootstrap" | "warm-cache" | "live-message" | null
  ...
}
```

Rules:

- Default new replay-created state: `historyCoverage: "none"`.
- Lightweight `chat.bootstrap` patch with no `payload.messages`: update cursor/status/messageCount only, set/keep `historyCoverage: "metadata"`, never `"full"`.
- Full `/api/chat/bootstrap` seeding via `seedGlobalChatSession()` sets `historyCoverage: "full"` and `messageCount` from canonical bootstrap response.
- Warm persisted cache with messages sets `historyCoverage` to a bounded preview state, or reuses a separate flag like `hasPreviewMessages`; it must not claim complete history unless it came from full bootstrap metadata.
- Live message patches can create useful preview state, but not full empty-history state.

### 2. Stop treating skeletal empty global state as known-loaded

In `packages/ui/hooks/useChatMessages.ts`:

- Replace `messages.length === 0 && typeof cursor === "number"` checks with a helper:

```ts
function isAuthoritativeKnownEmptyGlobal(state: SessionState | null | undefined) {
  return Boolean(
    state &&
    state.historyCoverage === "full" &&
    state.messages.length === 0 &&
    state.messageCount === 0 &&
    typeof state.cursor === "number"
  )
}
```

- Keep using global state with actual messages as warm preview.
- Only skip loading / mark `historyLoadVersion=1` for empty state when it is authoritative full-history empty.
- If global state is metadata-only empty, keep loading true or show normal skeleton until fresh `/api/chat/bootstrap` resolves.

This preserves the latency benefit for genuinely empty chats while preventing replay pollution.

### 3. Make `seedGlobalChatSession()` explicit about source

Change `seedGlobalChatSession()` to accept metadata:

```ts
seedGlobalChatSession({
  sessionKey,
  messages,
  cursor,
  status,
  statusLabel,
  pendingTools,
  spawnedSubagents,
  messageCount,
  historyCoverage: "full",
  source: "full-bootstrap",
  queryClient,
})
```

Existing callers must choose the right coverage:

- Fresh `/api/chat/bootstrap` path in `useChatMessages.ts:1609-1618`: `historyCoverage: "full"`, pass `canonicalMessageCount`.
- Warm cache path: if cache was written from full bootstrap and stores canonical `messageCount`, either `historyCoverage: "full"` or `"preview"` depending on cache schema. Prefer explicit `isFullBootstrapSnapshot` boolean in warm cache if uncertain.
- Patch/live paths: do not call with `"full"` unless full messages are present.

### 4. Preserve newer full state against older/skeletal replay

In `store.ts handlePatch()` / seed merge rules:

- A `metadata` replay patch must not downgrade a `full` state.
- A metadata patch with a higher cursor may update cursor/status/tool activity, but must not clear messages or mark empty loaded.
- A full bootstrap seed with lower cursor but more complete messages should be allowed to hydrate display if current state is metadata-only. Current `hasNewerCursor` logic (`store.ts:1312`) only protects newer states when `state.messages.length > 0`; extend it to consider `historyCoverage` so a higher-cursor metadata-only state does not block full bootstrap messages.

Key invariant: **cursor freshness and history completeness are separate dimensions**.

### 5. Avoid caching metadata-only empties as bootstrap data

`cacheBootstrap()` currently skips empty states (`store.ts:182-184`), which accidentally avoids persisting skeletal empties. Keep that protection unless/until the cache object can encode `historyCoverage` safely.

If caching empty full bootstraps is needed for latency, add explicit fields to `CachedChatBootstrapV2`:

```ts
historyCoverage?: "full" | "metadata"
messageCount?: number
source?: "middleware-projection"
```

Then only `isKnownEmptyBootstrap()` may return true when `historyCoverage === "full" && messageCount === 0` or when the data came directly from `/api/chat/bootstrap`, not from replay metadata.

### 6. Middleware event hardening (optional but clean)

In `apps/middleware/src/features/chat/routes.ts:1118-1122`, add explicit payload semantics to the lightweight event:

```ts
payload: {
  sessionKey,
  messageCount: projectedMessages.length,
  lastSeq: bootstrapLastSeq,
  historyCoverage: "metadata",
  fullMessagesIncluded: false,
}
```

Do **not** put full messages into patch replay. Keep the patch bus lightweight.

The UI should read this as metadata-only unless `fullMessagesIncluded === true`.

## Files to Change

- `packages/ui/lib/chat-engine-v2/types.ts`
  - Add typed coverage fields to patch payload/bootstrap/cache types.

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Extend `SessionState` with history coverage and message count metadata.
  - Teach `handlePatch()` that lightweight `chat.bootstrap` replay is metadata-only.
  - Update `seedGlobalChatSession()` to accept explicit coverage/source and preserve full state over metadata state.
  - Update logs to include `historyCoverage` and `messageCount` for debugging.

- `packages/ui/hooks/useChatMessages.ts`
  - Replace cursor-only known-empty checks with authoritative full-empty helper.
  - Pass canonical message count and coverage when seeding from full bootstrap.
  - Ensure metadata-only empty global state still fetches and waits for real bootstrap.

- `packages/ui/lib/chat-engine-v2/applyPatches.ts`
  - Keep cursor-advance behavior for no-message patches, but do not let it imply loaded history. If needed, return patch metadata or expose helper predicates used by store.

- `packages/ui/lib/warmChatCache.ts` / cache types if needed
  - Persist full-empty cache only with explicit full coverage metadata. Otherwise continue not caching empty warm snapshots.

- `apps/middleware/src/features/chat/routes.ts`
  - Optional: add `historyCoverage: "metadata"` / `fullMessagesIncluded:false` to `chat.bootstrap` projection event payload.

## Risks

- Over-constraining known-empty could bring back loading delay for truly empty chats unless full bootstrap/warm cache marks coverage correctly.
- Cursor handling must remain monotonic. Do not roll global cursor back just because full history arrives from a lower cursor.
- Do not clear live tool/subagent state when a full bootstrap arrives; existing protections around active tools and `hadNewerLiveState` must remain.
- Do not treat warm cache preview as full canonical history unless it contains explicit full-bootstrap metadata.
- Multi-window behavior remains per-window memory. This fix prevents each window from trusting skeletal replay as full history; it does not require sharing state across windows.

## Testing

### Unit tests

Add tests under `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`:

1. **Metadata-only bootstrap replay does not create authoritative empty state**
   - Apply `chat.bootstrap` patch with no message and `messageCount:0`.
   - Assert global state has `historyCoverage:"metadata"`, `messages:[]`, cursor advanced.
   - Assert helper for known-empty returns false.

2. **Full bootstrap seed overrides metadata-only empty even with lower/equal message cursor semantics**
   - Replay metadata empty at cursor 945.
   - Seed full bootstrap with messages and cursor 944/945 depending on realistic constraints.
   - Assert messages are retained/displayed and coverage becomes `full`.

3. **Full empty bootstrap is known-loaded**
   - Seed full bootstrap with `messages:[]`, `messageCount:0`.
   - Assert known-empty helper returns true and loading can be false.

4. **Metadata replay must not downgrade full state**
   - Seed full bootstrap with messages.
   - Apply later metadata-only `chat.bootstrap` with `messageCount:0`.
   - Assert messages remain and coverage remains `full` or at least display remains populated.

### Hook/component tests

If existing hook test utilities allow, cover `useChatMessages()`:

- Metadata-only empty global session starts in loading state and waits for `/api/chat/bootstrap`.
- Full empty global session starts with `loading:false`, `historyLoadVersion=1`, `messages=[]`.
- Global session with messages still paints immediately.

### Manual verification

Use frontend logs:

- Open two focused windows and switch rapidly between migrated chats.
- Confirm replayed `chat.bootstrap` frames log `historyCoverage:"metadata"`.
- Confirm empty metadata replay does not log `chat-view.render-state loading:false messageCount:0` for a chat whose real bootstrap later has messages.
- Confirm real full bootstrap logs `chat.bootstrap.applied` and then `historyCoverage:"full"`.
- Confirm no stale old bootstrap swaps active chat after route/window changes.

### Commands

- `pnpm --dir packages/ui exec vitest run lib/chat-engine-v2/__tests__/store.test.ts`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- `git diff --check`

## Out of Scope

- Do not hide skeletons with fake content.
- Do not special-case migrated Telegram session ids.
- Do not put full chat history into patch replay events.
- Do not change assistant/tool/thinking lifecycle semantics.
- Do not merge this with duplicate user echo cleanup.
