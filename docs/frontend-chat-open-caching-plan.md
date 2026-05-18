# Frontend Chat Reload Caching Plan

## Final production direction

We should implement a **frontend-first stale-while-revalidate warm chat cache** for fast chat open and fast app reload, while keeping **Middleware V2 / backend projection as the canonical source of truth**.

The goal is Telegram-like perceived smoothness:

- app shell opens immediately
- sidebar appears quickly
- recently opened chats paint instantly after reload
- long chats do not freeze the UI
- tool-call/running-agent state is recovered from backend, not trusted from stale frontend cache
- backend bootstrap and patch stream always reconcile the UI

This can be implemented first without Middleware V2 contract changes.

---

## Core principle

Frontend cache is for **fast paint only**.

Middleware V2 remains the source of truth for:

- canonical messages
- run status
- active tool calls
- cursor / projection position
- final completion/error/abort state
- long-running task recovery

So the frontend may show cached data immediately, but it must always call:

```txt
GET /api/chat/bootstrap?sessionKey=...
```

and apply the backend result when it returns.

---

## What we learned from Telegram Desktop style architecture

Telegram Desktop uses a local data model that can render quickly while requesting missing/canonical history in slices. The useful pattern for us is not “persist everything”; it is:

- keep local chat/session model for immediate UI
- represent history as windows/slices, not one huge always-rendered array
- open around the latest/unread region first
- request missing older history only when needed
- preserve scroll state
- preload a small area around visible content
- reconcile with server/backend updates

For OpenClaw Desktop, the equivalent is:

- hot in-memory session store
- React Query bootstrap cache
- persisted warm recent-message window
- Middleware V2 bootstrap reconciliation
- V2 patch stream continuation
- virtualized/windowed rendering

---

## Required user experience

### When user clicks a chat

1. Center chat shell opens immediately.
2. If hot memory cache exists, render it instantly.
3. Else if React Query cache exists, render it instantly.
4. Else if persisted warm cache exists, render it instantly.
5. Start Middleware V2 bootstrap in the background.
6. Apply canonical backend snapshot when it returns.
7. Continue live updates from `/api/stream/ws` or `/api/patches`.

### When user reloads the whole application

Recently opened chats should still feel fast:

- sidebar/startup metadata can load from short local cache
- selected/recent chat can paint from persisted warm cache
- backend bootstrap refreshes in background
- stale status is corrected after backend response

### When app was closed during a tool call

If a cached chat says a run/tool was active:

1. Show cached messages instantly.
2. Do **not** trust cached `tool_running` as final truth.
3. Show an internal/status label like `Reconnecting…` or `Checking latest run state…`.
4. Call backend bootstrap immediately.
5. Backend result wins:
   - completed → show final messages/tool result
   - failed → show error state
   - aborted/disconnected → show canonical stopped state
   - still running → resume live status from patch stream

Frontend local cache must not be responsible for long-running task recovery.

---

## Fresh vs stale cache policy

Do not use a simple short TTL that makes the app blank after expiry.

Use two windows:

```ts
const WARM_CHAT_FRESH_MS = 2 * 60 * 1000       // 2 minutes
const WARM_CHAT_DISPLAYABLE_MS = 24 * 60 * 60 * 1000 // 24 hours
```

Meaning:

- cache younger than `freshMs` is fresh and can be shown normally
- cache older than `freshMs` but younger than `displayableMs` can still be shown for fast paint, but is considered stale
- stale cache must trigger immediate backend bootstrap
- cache older than `displayableMs` should not be used

This keeps reload fast even after 1–2 hours while preserving correctness.

---

## What to persist locally

Create a dedicated frontend warm cache for recent chat-open data.

Suggested module:

```txt
packages/ui/lib/warmChatCache.ts
```

Persist per `sessionKey`:

```ts
type WarmChatCacheEntry = {
  sessionKey: string
  messages: ChatMessage[] // recent window only
  cursor?: number
  runStatus?: string | null
  statusLabel?: string | null
  activeRunSummary?: {
    runId?: string
    status?: string
    startedAt?: string | number | null
  } | null
  pendingToolSummary?: Array<{
    id: string
    name?: string
    status?: string
  }>
  messageCount?: number
  cachedAt: number
  lastAccessedAt: number
}
```

Store only:

- recent message window
- cursor
- status summary
- lightweight active run summary
- lightweight pending tool summary
- timestamps for freshness and LRU

Do **not** store:

- full long transcripts
- large attachments
- full tool output history for every chat
- terminal/process logs
- backend runtime truth
- secrets or large raw payloads

---

## Cache bounds

Production-safe defaults:

```ts
const WARM_CHAT_MAX_CHATS = 30
const WARM_CHAT_MAX_MESSAGES = 80
const WARM_CHAT_MAX_APPROX_BYTES_PER_CHAT = 500 * 1024
const WARM_CHAT_WRITE_DEBOUNCE_MS = 1000
```

Rules:

- Only recently opened chats are cached.
- If user has 100 chats, do not cache all 100.
- Keep at most 30 warm chat entries initially.
- Keep only the latest 80 messages per cached chat.
- Evict least-recently-used chats first.
- Trim messages further if approximate payload size is too large.

For 6–7 active chats, this is comfortably safe.

For 100 total chats, only the most recent 30 are warm cached.

---

## Open order in `useChatMessages`

Update the initial render path in:

```txt
packages/ui/hooks/useChatMessages.ts
```

Preferred order:

1. `initialMessages` if provided
2. global V2 chat session store
3. React Query bootstrap cache
4. persisted warm chat cache
5. empty shell + backend bootstrap

Important behavior:

- warm cache should reduce loading blank states
- stale warm cache should still render quickly but show reconnect/checking state if needed
- backend bootstrap always runs
- canonical messages replace/reconcile cached messages

---

## Persist timing

Persist warm cache after:

1. successful backend bootstrap
2. meaningful live V2 session updates
3. status/tool state changes worth preserving

Do not persist on every tiny patch synchronously.

Use debounce/throttle:

- debounce writes around `1000ms`
- clear pending timers on unmount
- avoid blocking render path

---

## Reconciliation rules

Backend wins always.

When bootstrap returns:

- parse canonical messages
- dedupe with optimistic messages where needed
- apply canonical cursor
- apply canonical run/tool status
- seed/update global chat session
- update React Query bootstrap cache
- update warm chat cache with bounded recent window

If warm cache disagrees with backend:

- backend snapshot replaces stale cached fields
- cached-only running state is not treated as final

---

## Long chat strategy

Do not hydrate/render huge chats on first open.

Keep:

- latest window first
- older history loaded on demand
- scroll stability
- virtualization via current center chat view

Frontend warm cache improves fast paint, but long-term huge-chat performance may still require Middleware V2 windowed history endpoints.

---

## Middleware V2 changes

### Phase 1: not required

This warm cache implementation can be frontend-only because Middleware V2 already provides:

- `/api/chat/bootstrap?sessionKey=...`
- canonical messages
- cursor
- run status
- status label
- active run
- tool calls
- WebSocket patch stream via `/api/stream/ws`
- patch replay via `/api/patches`

So phase 1 should not change middleware contracts.

### Phase 2: optional future improvements

If very large chats still feel slow because bootstrap returns too much history, then add Middleware V2 support for windowed history:

```txt
GET /api/chat/bootstrap?sessionKey=X&limit=80
GET /api/chat/messages?sessionKey=X&beforeSeq=123&limit=80
```

Optional future behavior:

- return latest SQLite projection window immediately
- refresh gateway history in background
- expose older-message pagination
- make active run recovery explicit

But this is not required for the first frontend warm-cache implementation.

---

## Implementation plan

### Step 1 — Add warm chat cache module

Create:

```txt
packages/ui/lib/warmChatCache.ts
```

Responsibilities:

- `getWarmChatCache(sessionKey)`
- `setWarmChatCache(sessionKey, entry)`
- `touchWarmChatCache(sessionKey)`
- `deleteWarmChatCache(sessionKey)`
- `pruneWarmChatCache()`
- stale/fresh classification
- LRU index management
- message count and approximate-size trimming

Use existing:

```txt
packages/ui/lib/persistentCache.ts
```

Do not create a new storage backend unless necessary.

### Step 2 — Read warm cache before bootstrap

In `useChatMessages.ts`:

- check global session and React Query first
- if absent, asynchronously load warm cache
- render cached recent window if available
- mark stale active runs as reconnecting/checking
- keep backend bootstrap running regardless

### Step 3 — Persist after canonical bootstrap

After `fetchChatBootstrapV2` / `loadChatBootstrap` resolves and canonical messages are parsed:

- write last 80 messages
- write cursor
- write canonical status/statusLabel
- write activeRun/tool summaries
- update LRU index

### Step 4 — Persist useful live updates

When global chat session emits live updates:

- debounce warm cache writes
- write recent message slice only
- include lightweight tool/run status

### Step 5 — Keep architecture boundaries

Do not:

- make frontend source of truth
- bypass `/api/chat/bootstrap`
- store full transcripts
- change Middleware V2 contracts in phase 1
- alter message normalization semantics unnecessarily
- break existing global V2 chat engine

### Step 6 — Verification

Minimum checks before PR:

- TypeScript/typecheck for UI package if available
- focused lint/build command if available
- manual code inspection for no full transcript persistence
- verify only bounded recent windows are persisted
- verify backend bootstrap still runs on every mount/open
- verify stale cached active run shows reconnect/checking until canonical bootstrap resolves

---

## Success criteria

The change is successful when:

- opening a recently used chat feels instant
- reloading the app and reopening recent chats feels fast
- 6–7 recently used chats remain smooth after reload
- 100 total chats does not mean caching all 100 chats
- long chats do not freeze the UI
- stale 1–2 hour cache can paint quickly but backend corrects it
- tool-call state after app close/reopen is recovered from Middleware V2, not trusted from frontend cache
- no Middleware V2 API change is required for phase 1

---

## Final recommendation

Implement phase 1 as:

- hot memory cache first
- React Query cache second
- persisted warm recent-message window third
- stale-while-revalidate behavior
- backend bootstrap always canonical
- bounded LRU cache
- debounced writes
- virtualization/windowing preserved

This gives us the best balance of speed, correctness, and architecture safety.
