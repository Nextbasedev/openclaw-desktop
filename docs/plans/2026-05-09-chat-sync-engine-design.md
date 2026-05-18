# Chat Sync Engine Design

**Goal:** Replace fragile full-array frontend chat caching with a cursor/revision-based chat sync model that stays correct under fast session switching, multiple tabs, streams, reconnects, and large histories.

**Branch:** `ui/new-feat`

---

## Why We Need This

The current model has too many race-prone paths:

- `useChatMessages` owns parsing, streaming, optimistic sends, cache writes, local sync, status, tools, subagents, and reconciliation.
- `chatSessionStore` broadcasts full `ChatMessage[]` arrays.
- `localFirstSync` broadcasts full cached message arrays without cursor/source-tab/version guards.
- `persistentCache` writes message arrays to `localStorage` and IndexedDB.
- `chatStream` keeps old EventSource connections alive for 60s.
- Middleware SQLite mostly stores one `kv_state` JSON blob, not a normalized chat read model.

This creates stale overwrites and duplicated/wrong message blocks when switching tabs/sessions quickly.

---

## Target Architecture

```txt
OpenClaw Gateway / transcript
        ↓
Desktop Middleware Chat Engine
  - normalize gateway events/history
  - store event_log + normalized read model in SQLite
  - emit cursor-based patches
        ↓
Frontend Chat Engine
  - one normalized state store
  - apply patches only if cursor/revision is newer
  - IndexedDB startup snapshot only
  - react-virtuoso timeline
```

---

## Principles

1. **No full-array overwrite across tabs.** Use patch/upsert semantics.
2. **Every update has ordering metadata.** At minimum: `cursor`, `revision`, `sourceTabId`, `sessionKey`.
3. **Middleware owns normalization.** Frontend should not reconstruct canonical history from raw gateway/tool events forever.
4. **Frontend cache is a snapshot, not source of truth.** SQLite/gateway history wins.
5. **Large tool results are lazy.** Timeline shows preview; full payload loads on expand.
6. **Migration must be staged.** Keep current APIs until new engine is verified.

---

## Phase 0 — Stabilize Current UI While Building New Model

These are immediate safety fixes and compatibility layers.

### P0.1 Tab identity

Create:

```txt
packages/ui/lib/tabIdentity.ts
```

Expose:

```ts
export function getTabId(): string
```

Backed by `sessionStorage`, not `localStorage`.

### P0.2 Revisioned chat session store

Modify:

```txt
packages/ui/lib/chatSessionStore.ts
```

Add:

```ts
type ChatSessionRevision = {
  sessionKey: string
  revision: number
  updatedAt: number
  sourceTabId: string
}
```

Current full-array publish can remain temporarily, but subscribers must reject older revisions.

### P0.3 Revisioned local sync

Modify:

```txt
packages/ui/lib/localFirstSync.ts
```

Add to `LocalMessageState`:

```ts
revision: number
sourceTabId: string
cursor?: number
```

Reject stale broadcast messages before `emitSet`.

### P0.4 Remove message arrays from localStorage hot path

Modify:

```txt
packages/ui/lib/persistentCache.ts
```

Rule:

- `localStorage`: tiny metadata only
- IndexedDB: message snapshots
- memory: hot path

### P0.5 Reduce stream grace

Modify:

```txt
packages/ui/lib/chatStream.ts
```

Change `CHAT_STREAM_CLOSE_GRACE_MS` from `60_000` to `3_000` while the new middleware stream model is being built.

### P0.6 Generation guards

Modify:

```txt
packages/ui/hooks/useChatMessages.ts
```

Every async bootstrap/reconcile/history callback captures a generation and session key. Late callbacks must no-op if not current.

---

## Phase 1 — Middleware Read Model

Add new files:

```txt
apps/middleware/src/db/chat-schema.ts
apps/middleware/src/db/chat-repo.ts
apps/middleware/src/sync/chat-normalizer.ts
apps/middleware/src/sync/event-log.ts
apps/middleware/src/sync/patch-bus.ts
```

Keep existing `kv_state` for app shell data, but add normalized chat tables.

### Tables

```sql
CREATE TABLE IF NOT EXISTS chat_event_log (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  event_type TEXT NOT NULL,
  session_key TEXT NOT NULL,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  session_key TEXT PRIMARY KEY,
  canonical_key TEXT,
  requested_key TEXT,
  status TEXT,
  title TEXT,
  preview TEXT,
  last_cursor INTEGER DEFAULT 0,
  last_message_at INTEGER,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL,
  text TEXT,
  created_at INTEGER NOT NULL,
  status TEXT,
  parent_message_id TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
ON chat_messages(session_key, created_at);

CREATE TABLE IF NOT EXISTS chat_tool_calls (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  message_id TEXT,
  name TEXT,
  status TEXT,
  args_preview TEXT,
  result_preview TEXT,
  has_full_result INTEGER DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS chat_tool_payloads (
  tool_call_id TEXT PRIMARY KEY,
  args_json TEXT,
  result_json TEXT,
  error_json TEXT,
  updated_at INTEGER NOT NULL
);
```

---

## Phase 2 — Patch Protocol

Add middleware endpoints:

```txt
GET  /api/chat/bootstrap?sessionKey=...
GET  /api/chat/events?afterCursor=...
GET  /api/chat/messages?sessionKey=...&before=...&limit=...
GET  /api/chat/tools/:toolCallId
GET  /api/stream/chat-patches
```

Patch envelope:

```ts
type PatchEnvelope = {
  cursor: number
  serverTime: number
  patches: ClientPatch[]
}
```

Patch types:

```ts
type ClientPatch =
  | { type: "session.upsert"; session: SessionPreview }
  | { type: "message.upsert"; sessionKey: string; message: MessageRecord }
  | { type: "message.batch"; sessionKey: string; messages: MessageRecord[] }
  | { type: "message.patch"; sessionKey: string; messageId: string; patch: Partial<MessageRecord> }
  | { type: "tool.upsert"; sessionKey: string; toolCall: ToolCallRecord }
  | { type: "status.update"; sessionKey: string; status: string }
```

Frontend apply rule:

```ts
if (incoming.cursor <= currentCursor) return
applyPatches(incoming.patches)
currentCursor = incoming.cursor
```

---

## Phase 3 — Frontend Chat Engine

Add:

```txt
packages/ui/lib/chat-engine/types.ts
packages/ui/lib/chat-engine/store.ts
packages/ui/lib/chat-engine/applyPatches.ts
packages/ui/lib/chat-engine/snapshot.ts
packages/ui/lib/chat-engine/streamClient.ts
packages/ui/hooks/useChatEngine.ts
```

Normalized state:

```ts
type ChatEngineState = {
  lastCursor: number
  activeSessionKey: string | null
  sessionsByKey: Record<string, SessionPreview>
  messageIdsBySession: Record<string, string[]>
  messagesById: Record<string, MessageRecord>
  toolCallsById: Record<string, ToolCallRecord>
}
```

`ChatView` gets message IDs and records from selectors, not a mutable full array from many sources.

---

## Phase 4 — Migration Plan

1. Ship P0 guards on current model.
2. Add middleware read-model tables and write-through ingestion from `chat.history` and stream events.
3. Add read-only `/api/chat/bootstrap` and compare output against old `middleware_chat_history` in tests.
4. Add frontend chat-engine behind feature flag:

```txt
NEXT_PUBLIC_CHAT_ENGINE_V2=1
```

5. Run both paths in shadow mode and log diffs.
6. Switch UI to V2 for chat display.
7. Remove old full-array local sync path.

---

## Verification Scenarios

- Same session open in 3 tabs; send quickly from A then B.
- Three different sessions streaming; switch every 1-3 seconds.
- Slow history response from S1 after switching to S2 must not mutate S2.
- Reconnect while streaming must not duplicate assistant/user messages.
- 10k message history opens with last 50-100 messages only.
- Large tool result renders preview only.

---

## Recommendation

Implement in this order:

1. P0 guards immediately.
2. Middleware read model in parallel with old path.
3. Patch stream + frontend engine behind feature flag.
4. Switch default after shadow comparison passes.

Do **not** try to rewrite everything in one PR. The safe unit is 4-6 small PRs with tests at each boundary.
