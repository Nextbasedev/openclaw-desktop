# Chat Tab Switch Performance

## Problem
When switching between chat tabs, the chat area is blank for 1-3+ seconds before messages appear. Three root causes identified from production logs.

## Current Flow

```
User clicks chat tab
  → Frontend: unmount old ChatView, mount new ChatView
  → Frontend: check warm cache (fast if available)
  → Frontend: fetch /api/chat/bootstrap?sessionKey=...
    → Middleware: Gateway chat.history (80-930ms)
    → Middleware: archived-history.persist (first visit: imports 80 files, 2577 messages → 3243ms)
    → Middleware: messages.persist + tools.inferred
    → Middleware: respond with bootstrap payload
  → Frontend: apply bootstrap, subscribe to patch stream
  → Frontend: WebSocket /api/stream/ws?afterCursor=0
    → Middleware: replay ALL patches from cursor 0 (248+ patches)
  → Frontend: render messages
```

Meanwhile, the frontend also fires redundant parallel requests:
- 3× `sessions.list` (600-2500ms each, serialized through Gateway)
- 3× `models.list`
- 2-3× `/api/bootstrap`
- 2-3× `/api/chats`

## Root Cause 1: First-visit archive import blocks bootstrap

**File:** `apps/middleware/src/features/chat/routes.ts` → bootstrap handler
**Trace:** `bootstrap.archived-history.persist` → imports all archived transcript files on first bootstrap

```
First visit:  importedFiles:80, upserted:2577, totalDurationMs:3243
Second visit: importedFiles:0,  upserted:0,    totalDurationMs:793
```

The archive import is synchronous and blocks the bootstrap response.

## Root Cause 2: Patch stream always replays from cursor 0

**File:** `packages/ui/lib/chat-engine-v2/store.ts:1254`
```ts
unsubscribeStream = openPatchStreamV2(globalCursor, handleFrame)
```

`globalCursor` starts at 0 when the engine initializes. The `ensureGlobalChatEngine()` function computes `globalCursor = Math.max(globalCursor, state.cursor)` across all states, but on fresh page load or tab re-create, there are no states → cursor is 0 → full replay.

**File:** `packages/ui/lib/chat-engine-v2/client.ts:157`
```ts
url.searchParams.set("afterCursor", String(connectionCursor))
```

The WebSocket connects with `afterCursor=0`, middleware replays everything.

## Root Cause 3: Redundant parallel API requests

**File:** `packages/ui/hooks/useChatMessages.ts` and `packages/ui/lib/startupBootstrap.ts`

Multiple components mount simultaneously on tab switch:
- Sidebar calls `/api/chats` + `/api/bootstrap`
- ChatView calls `/api/chat/bootstrap`
- Multiple model selectors each call `models.list`

Each `/api/chats` and `/api/bootstrap` call triggers `syncGatewaySessions()` which calls `sessions.list` (600-2500ms).

## Proposed Fix

### Fix 1: Eager archive import after Telegram import (Priority: High)
**File:** `apps/middleware/src/features/compat/routes.ts` → `importTelegramSessions()`

After copying transcript messages, trigger a lightweight archive-import-and-persist for each imported session immediately. This moves the 3s cost from first-tab-switch to import time (where the user expects waiting).

**Alternative:** Background worker that pre-imports archives for all known sessions after middleware startup.

### Fix 2: Persist and restore patch stream cursor (Priority: High)
**File:** `packages/ui/lib/chat-engine-v2/store.ts`

Save `globalCursor` to localStorage on every patch. On `ensureGlobalChatEngine()`, read it back. This way tab switches/page reloads resume from the last known cursor instead of 0.

```ts
// In handlePatch:
globalCursor = Math.max(globalCursor, frame.patch.cursor)
localStorage.setItem("openclaw:patchCursor", String(globalCursor))

// In ensureGlobalChatEngine:
const savedCursor = Number(localStorage.getItem("openclaw:patchCursor") || "0")
globalCursor = Math.max(globalCursor, savedCursor)
```

### Fix 3: Deduplicate and cache Gateway sessions.list (Priority: Medium)
**File:** `apps/middleware/src/features/compat/routes.ts` → `syncGatewaySessions()`

Add a short TTL cache (e.g., 5s) to `syncGatewaySessions()` so concurrent calls to `/api/chats`, `/api/bootstrap`, etc. share the same Gateway response instead of each making their own 600-2500ms call.

### Fix 4: Deduplicate frontend requests (Priority: Low)
**File:** `packages/ui/hooks/useChatMessages.ts`, `packages/ui/lib/ipc.ts`

Use React Query deduplication or a request-level cache to prevent duplicate `models.list`, `bootstrap`, and `chats` calls when multiple components mount simultaneously.

## Files to Change

### Fix 1
- `apps/middleware/src/features/compat/routes.ts` — trigger archive persist after import

### Fix 2
- `packages/ui/lib/chat-engine-v2/store.ts` — persist/restore globalCursor

### Fix 3
- `apps/middleware/src/features/compat/routes.ts` — cache syncGatewaySessions result

### Fix 4
- `packages/ui/lib/ipc.ts` or individual hooks — request dedup

## Risks

- **Fix 1:** Import time increases. Acceptable since user is already waiting during import.
- **Fix 2:** Stale cursor could skip patches if middleware was restarted and cursor reset. Need a cursor-validation handshake or fallback to 0 if replay returns unexpected gap.
- **Fix 3:** 5s stale data is acceptable for sidebar. Could cause brief inconsistency if a session is created during the cache window.
- **Fix 4:** React Query already handles some dedup. May be partially solved already.

## Testing

- Typecheck: `pnpm --filter @openclaw/desktop-middleware typecheck` + `pnpm --filter ui typecheck`
- Tests: `pnpm --filter @openclaw/desktop-middleware test -- --run`
- Manual: Switch between migrated Telegram chats, verify first switch is fast, no blank screen
- Manual: Refresh page, verify patch stream doesn't replay from 0
