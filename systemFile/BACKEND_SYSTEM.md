# OCPlatform Desktop — Backend System (v6-krish)

> Complete, micro-level reference for the **backend** of the OCPlatform Desktop
> codebase on branch `v6-krish`. Covers the Fastify middleware
> (`apps/middleware`), the SQLite v2 schema, the chat projection pipeline,
> Gateway client, compat layer, skills service, send queue, patch bus, and
> diagnostics.
>
> Repo: `Nextbasedev/openclaw-desktop` · Branch: `v6-krish` · Workspace path:
> `/root/.openclaw/workspace/openclaw-desktop`

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Frontend (UI / Tauri)                            │
└─────────────────────────────────────────────────────────────────────────┘
                       │ HTTP   │ WebSocket /api/patches
                       ▼        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              apps/middleware  (Fastify 5, Node 22, TypeScript ESM)     │
│                                                                         │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
│  │ system/health  │  │ chat (v2)        │  │ compat (legacy v1)   │    │
│  │ /api/system/*  │  │ /api/chat/*      │  │ /api/chats, /api/    │    │
│  │ /health        │  │ /api/v1/chat/*   │  │ projects, /workspace │    │
│  └────────────────┘  └──────────────────┘  │ /terminal /git, …    │    │
│  ┌────────────────┐  ┌──────────────────┐  └──────────────────────┘    │
│  │ gateway routes │  │ patches (WS bus) │  ┌──────────────────────┐    │
│  │ /api/gateway/* │  │ /api/patches     │  │ skills, diagnostics  │    │
│  └────────────────┘  └──────────────────┘  └──────────────────────┘    │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Core services (singletons on AppContext)                         │  │
│  │  • GatewayClient   (ws, Ed25519 signed v3 auth)                   │  │
│  │  • MessageRepository / RunRepository  (SQLite v2_*)               │  │
│  │  • ChatLiveIngest  (1197 LOC — projector + dedupe + recovery)     │  │
│  │  • PatchBus        (WS broadcast of v2_projection_events)         │  │
│  │  • SessionSendQueue (per-session FIFO)                            │  │
│  │  • GatewayEventProjector  (gateway → projection events)           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                       │ WebSocket (Ed25519 signed)
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  OCPlatform Gateway (remote control plane)               │
└─────────────────────────────────────────────────────────────────────────┘
```

- Runtime: Node ≥ 22, ESM. `apps/middleware/package.json` declares
  `"type": "module"` and ESM `tsx` for dev.
- HTTP: Fastify 5 (`fastify` 5.6.2), with `@fastify/cors`,
  `@fastify/sensible`, `@fastify/websocket`.
- DB: `better-sqlite3` 11.x, WAL journal, foreign keys ON.
- Validation: `zod` for env, ad-hoc parsing inside route handlers.
- WS: native `ws` package for gateway client and PTY streams.

---

## 2. Workspace Layout (`apps/middleware`)

```
apps/middleware
├── src/
│   ├── index.ts                    # Boot, listen, gateway auto-connect
│   ├── app.ts                      # Fastify factory, plugin registration
│   ├── config/
│   │   └── env.ts                  # Zod env loader, MiddlewareConfig
│   ├── db/
│   │   ├── connection.ts           # openDatabase(), WAL, FK, migrate
│   │   ├── migrate.ts              # SQL schema + versioned migrations
│   │   └── json.ts                 # toJson/fromJson safe helpers
│   ├── features/
│   │   ├── chat/
│   │   │   ├── routes.ts                  # 2012 LOC — chat HTTP routes
│   │   │   ├── live.ts                    # 1197 LOC — live ingest
│   │   │   ├── projection.ts              # 175  — projection pipeline
│   │   │   ├── gateway-event-projector.ts # 226  — gateway → events
│   │   │   ├── repo.messages.ts           # 907  — messages repo
│   │   │   ├── repo.runs.ts               # 414  — runs/tools repo
│   │   │   ├── message-normalizer.ts      # 252  — text normalization
│   │   │   ├── message-semantics.ts       # 17   — role helpers
│   │   │   ├── send-queue.ts              # 26   — per-session FIFO
│   │   │   ├── attachments.ts             # 86   — attachment helpers
│   │   │   ├── subagent-correlation.ts    # 98
│   │   │   ├── subagent-session.ts        # 96
│   │   │   └── types.ts                   # 32
│   │   ├── compat/
│   │   │   └── routes.ts                  # 4854 LOC — v1 compatibility surface
│   │   ├── gateway/
│   │   │   ├── client.ts                  # Ed25519 signed v3 WS client
│   │   │   └── routes.ts                  # /api/gateway/{status,reconnect}
│   │   ├── system/routes.ts               # /health, /api/system/info
│   │   ├── diagnostics/routes.ts          # /api/diagnostics, /api/logs
│   │   ├── skills/
│   │   │   ├── routes.ts                  # /api/skills/{discover,installed,install}
│   │   │   └── service.ts                 # ClawHub + local discovery
│   │   └── patches.ts                     # PatchBus, /api/patches WS
│   └── lib/
│       ├── errors.ts                      # Fastify error handler
│       └── logger.ts                      # Structured logs + ring buffer
├── tests/                                 # Vitest suites
├── scripts/                               # Maintenance scripts
├── dist/                                  # Built JS
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

---

## 3. Boot Sequence (`src/index.ts`)

```text
loadEnv()                       → MiddlewareConfig
createApp(config)               → Fastify instance + AppContext
app.listen({host, port})        → HTTP listening
startGatewayAutoConnect(ctx)    → infinite reconnect with exp backoff
app.onClose                     → close gateway + db, stop autoconnect
```

`startGatewayAutoConnect()`:

- Attempt counter increments each try.
- Backoff: `min(60_000, 1_000 * 2^min(max(0, attempt-1), 6))` → caps at 60s.
- Logs `gateway.autoconnect.start/ready/fail` with attempt + nextRetryMs.
- Timer is `unref()`-ed so it doesn't keep process alive on its own.

---

## 4. Fastify App (`src/app.ts`)

### 4.1 Body limit and JSON parsing

```ts
MIDDLEWARE_BODY_LIMIT_BYTES = 25 * 1024 * 1024  // 25 MB
```

JSON parser is replaced with a string-first parser that tolerates empty
bodies (returns `{}` instead of erroring), and yields the original error
for malformed JSON.

### 4.2 AppContext

Singletons threaded through every route module:

```ts
type AppContext = {
  config: MiddlewareConfig
  gateway: GatewayClient
  db: MiddlewareDatabase
  messages: MessageRepository
  runs: RunRepository
  chatLive: ChatLiveIngest
  sendQueue: SessionSendQueue
  patchBus: PatchBus
  compat?: { touchChatActivity(...) }
  startedAtMs: number
}
```

The context is attached to the Fastify instance as `app.v2Context` so
`index.ts` can read it post-construction.

### 4.3 Plugins

- `@fastify/cors` — wildcard origin, allows
  `Authorization, Content-Type, Cache-Control, X-Requested-With`, all REST
  methods. (No credentials.)
- `@fastify/sensible` — extra HTTP errors, `httpErrors.*`.
- `@fastify/websocket` — used by `/api/patches` and PTY streams.

### 4.4 Logging hooks

- `onRequest` → `request.start` (requestId, method, path, ip).
- `onResponse` → `request.end` (statusCode, statusText, durationMs).
- `onError` → `request.fail` with `errorMeta(error)`.
- All logs are routed through `createLogger(scope)` → ring buffer
  (`getRecentLogLines`) used by `/api/logs`.

### 4.5 Startup cleanup

After repos are constructed, `runs.finalizeStaleActivity()` is invoked.
Any in-flight runs/tools/detached-tools from a previous unclean shutdown
are finalized with a warning log (`chat-cleanup → startup.stale-activity-finalized`).

### 4.6 Route registration order

```ts
registerErrorHandler(app)
await registerSystemRoutes(app, context)        // /health, /api/system/info
await registerCompatRoutes(app, context)        // bulk v1 surface (~80 routes)
await registerSkillRoutes(app, context)         // skills
await registerGatewayRoutes(app, context)       // gateway status/reconnect
await registerDiagnosticsRoutes(app, context)   // diagnostics + logs
await registerChatRoutes(app, context)          // chat v2
await registerPatchRoutes(app, context)         // /api/patches WS
```

### 4.7 Shutdown

`app.addHook("onClose", …)` closes the gateway WS and the SQLite handle.

---

## 5. Configuration (`src/config/env.ts`)

Loaded with Zod. Env priority:

| Env var                       | Maps to                       |
| ----------------------------- | ----------------------------- |
| `MIDDLEWARE_HOST` / `HOST`    | `host` (default `127.0.0.1`)  |
| `MIDDLEWARE_PORT` / `PORT`    | `port` (default `8787`)       |
| `MIDDLEWARE_DB`               | SQLite path (default under `~/.openclaw/...`) |
| `OPENCLAW_GATEWAY_URL`        | Gateway WS URL                |
| `OPENCLAW_GATEWAY_TOKEN`      | Gateway bearer/signing token  |
| `MIDDLEWARE_TOKEN`            | Local auth token (pairing)    |
| `MIDDLEWARE_PAIRING_CODE`     | Pairing code shown in UI      |
| `NODE_ENV`                    | `nodeEnv` string              |

The pairing code is auto-generated (cryptographic) if not supplied. The
default database path resolves to a per-user directory under the OS home
(`os.homedir()` + `.openclaw` workspace).

---

## 6. Database (`src/db`)

### 6.1 Connection

`openDatabase(config)`:

1. `fs.mkdirSync(dirname(databasePath), { recursive: true })`.
2. `new Database(databasePath)`.
3. `journal_mode = WAL`.
4. `foreign_keys = ON`.
5. `busy_timeout = 5000`.
6. `migrateDatabase(db)`.

### 6.2 Schema (`db/migrate.ts`)

`SCHEMA_VERSION = 2`. All v2 tables prefixed `v2_`.

| Table                  | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `v2_meta`              | KV (schema version, runtime flags)                             |
| `v2_sessions`          | Per-session JSON blob + session_id + updated_at_ms             |
| `v2_chat_segments`     | Logical chat segments per session, base_seq, active flag       |
| `v2_messages`          | `(session_key, openclaw_seq)` PK, `data_json`, role, message_id |
| `v2_archive_imports`   | Tracks file-system archive ingestion (mtime + size)            |
| `v2_runs`              | Run lifecycle, status, errors, idempotency / gateway IDs       |
| `v2_tool_calls`        | Tool invocations + phase/status/args/result meta               |
| `v2_projection_events` | Cursor-numbered patch stream for `/api/patches`                |
| `v2_gateway_offsets`   | Last consumed openclaw_seq per session                         |
| `v2_compat_state`      | KV for compat layer state                                      |

Indexes (selected):

- `idx_v2_chat_segments_session_key (session_key, segment_index)`
- `idx_v2_chat_segments_active (session_key, is_active) WHERE is_active=1`
- `idx_v2_messages_session_seq (session_key, openclaw_seq)`
- `idx_v2_messages_session_message_id (session_key, message_id) WHERE message_id IS NOT NULL`
- `idx_v2_runs_session_key`, `idx_v2_runs_client_message_id`,
  `idx_v2_runs_idempotency_key`, `idx_v2_runs_gateway_run_id` (all
  partial on non-null)
- `idx_v2_tool_calls_session_key`, `idx_v2_tool_calls_run_id` (partial)
- `idx_v2_projection_events_cursor`

`addColumnIfMissing(db, table, column, def)` — used inside migrations to
soft-add columns for live deployments without a hard schema rev.

### 6.3 JSON helpers (`db/json.ts`)

- `toJson(value)` — `JSON.stringify` with safe fallback.
- `fromJson<T>(raw)` — `JSON.parse` with try/catch; returns `null` on
  malformed payloads (used for resilience against corrupted rows).

---

## 7. Chat Subsystem (`features/chat`)

### 7.1 Types (`types.ts`)

- `OCPlatformMessage` — raw message format from gateway / archives.
- `ProjectedMessage` — internal canonical form persisted in
  `v2_messages.data_json`.
- `ProjectionEvent` — cursor-bound patch payload pushed to
  `v2_projection_events` and the WS bus.

### 7.2 Message normalizer (`message-normalizer.ts`)

- `textFromMessage(message)` — extracts user-facing text from arbitrary
  shapes (`content`, `text`, array of `{type, text}` parts, tool result
  wrappers).
- `normalizeMessageText(text)` — collapses whitespace, strips zero-widths.
- `isInternalSubagentCompletionMessage(message)` — filters
  "subagent_done" synthetic messages from primary UI.

### 7.3 Message semantics (`message-semantics.ts`)

Tiny module with role helpers (`isUserRole`, `isAssistantRole`,
`isSystemRole`, etc.) used by repos and projector.

### 7.4 Subagent correlation / session

- `subagent-correlation.ts` — correlates parent run with spawned
  subagent runs by metadata (`__openclaw.subagentParentId`).
- `subagent-session.ts` — `extractSubagentSessionKey()` and lifecycle
  helpers for nested subagent timelines.

### 7.5 Attachments (`attachments.ts`)

Helpers to persist attachment metadata in message JSON and to render
preview info (filename, mime, size, kind).

### 7.6 Send queue (`send-queue.ts`)

`SessionSendQueue` — per-session FIFO using a `tails: Map<sessionKey, Promise>`:

- `run(sessionKey, task)` chains onto the previous tail with
  `previous.catch(() => undefined).then(() => current)`.
- After execution releases and removes itself if the current is still the
  tail.
- `pendingSessions()` — debug count.

Guarantees order of `/api/chat/send` operations per session even under
concurrent client retries.

### 7.7 Repositories

#### `RunRepository` (`repo.runs.ts`, 414 LOC)

CRUD over `v2_runs` and `v2_tool_calls`:

- `createRun({sessionKey, clientMessageId, idempotencyKey, startedAtMs})`.
- `findActiveRunBySession(sessionKey)`.
- `findRunByClientMessageId / Idempotency / GatewayRunId`.
- `finishRun(runId, {status, statusLabel, errorJson, finishedAtMs})`.
- `upsertToolCall(...)`, `finishToolCall(...)`.
- `finalizeStaleActivity()` — at boot, finalizes any non-terminal runs
  and tool calls left from a crash and emits a summary
  `{runsFinalized, toolsFinalized, detachedToolsFinalized}`.

#### `MessageRepository` (`repo.messages.ts`, 907 LOC)

Owns `v2_messages` and `v2_chat_segments`. Selected behaviors:

- `getActiveSegment(sessionKey)` — returns the active segment row.
- `getSegmentForTranscript({sessionKey, sessionId, sessionFile, active})`
  — used to attach archived transcripts as inactive segments.
- Optimistic vs authoritative dedupe via `isOptimisticConflict()` —
  collapses a stored optimistic user message when an authoritative one
  arrives with matching text or matching message_id, preventing duplicate
  rows.
- `runIdentityOf(data)` — pulls run id out of either
  `__openclaw.runId`, `runId`, or `gatewayRunId`.
- `isStrippedReplayCandidate(message)` — marks user/assistant rows with
  text but no runId as eligible to be replaced if a richer replay
  arrives.
- `diagnostics()` — returns counts and last cursor for `/api/diagnostics`.

### 7.8 Live ingest (`live.ts`, 1197 LOC)

`ChatLiveIngest` is the heart of real-time chat:

- Subscribes to the `GatewayClient` event stream.
- Per-session offset tracked in `v2_gateway_offsets` (`last_openclaw_seq`).
- Cold-bootstrap dedupe: when a session is first observed, archived
  history is imported (via `v2_archive_imports`) and merged with live
  events without producing duplicates.
- Non-blocking archive backfill — archived transcripts are read in
  chunks and inserted alongside live messages.
- Active-run tool snapshot scoping — when a run starts, the projector
  scopes tool snapshots to its run id so historical tool rows don't
  flicker.
- Replay-prune confirmed-user preservation — when the server replays
  history, optimistic user messages already confirmed by message_id are
  not pruned.
- Backend epoch reset — when the gateway resets sequence numbers, the
  ingest emits a `__resetEpoch` projection event so clients drop stale
  cursors.
- Backpressure — batches writes, flushes on size or time threshold.
- Exposes `diagnostics()` (per-session pending counts, last cursor,
  last error).

### 7.9 Gateway event projector (`gateway-event-projector.ts`, 226 LOC)

Maps gateway event types to projection events:

| Gateway event             | Projection event          |
| ------------------------- | ------------------------- |
| `message.created/updated` | `message.upsert`          |
| `message.deleted`         | `message.delete`          |
| `tool.call.start/update`  | `tool.upsert`             |
| `tool.call.finish`        | `tool.finish`             |
| `run.start`               | `run.start`               |
| `run.finish`              | `run.finish`              |
| `status`                  | `status`                  |
| `subagent.*`              | `subagent.upsert/finish`  |
| `history.coverage`        | `historyCoverage`         |
| `truncate`                | `truncate`                |
| `__resetEpoch`            | `__resetEpoch`            |

### 7.10 Projection (`projection.ts`, 175 LOC)

- Persists each projection event to `v2_projection_events` and obtains a
  monotonic `cursor` (autoincrement PK).
- Hands the result to `PatchBus.broadcast(...)` for WS fanout.
- Increments per-session `cursor` and `lastSeq` metrics for
  `/api/diagnostics`.

### 7.11 Routes (`features/chat/routes.ts`, 2012 LOC)

Public HTTP surface for chat:

| Method | Path                              | Purpose                                                    |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| POST   | `/api/exec/approval/resolve`      | Resolve an approval prompt (exec tool gating)              |
| POST   | `/api/chat/message`               | Frontend send (canonical v2)                               |
| POST   | `/api/v1/chat/message`            | Compat alias                                               |
| GET    | `/api/chat/session-context`       | Token usage / system context                               |
| POST   | `/api/chat/send`                  | Lower-level send (queued)                                  |
| POST   | `/api/chat/abort`                 | Abort active run                                           |
| GET    | `/api/chat/bootstrap`             | Snapshot for client hydration                              |
| GET    | `/api/chat/messages`              | Pagination (before/after)                                  |
| GET    | `/api/chat/tool-result`           | Fetch full tool result by id                               |
| GET    | `/api/chat/search`                | Per-session search                                         |

All write paths route through `context.sendQueue.run(sessionKey, …)` to
serialize per-session sends.

---

## 8. Patches (`features/patches.ts`)

### 8.1 `PatchBus`

- Tracks connected WS clients keyed by random id.
- `addClient({id, socket, connectedAtMs, lastSentCursor})` — registers
  and binds `close`/`error` to drop the client.
- `broadcast(patch)` — JSON-stringifies once and sends to every OPEN
  client; failing sockets are dropped and closed.
- `diagnostics()` — returns `clients` count and per-client
  `(id, connectedAtMs, lastSentCursor)`.

### 8.2 Resume

`listPatchesAfter(context, afterCursor, limit=1000)`:

```sql
SELECT cursor, session_key, event_type, payload_json, created_at_ms
FROM v2_projection_events
WHERE cursor > @afterCursor
ORDER BY cursor ASC
LIMIT @limit
```

Limit is clamped to `1..5000`. Used when a reconnecting client provides
`?afterCursor=N`.

### 8.3 Route

- `GET /api/patches` (WS) — accepts `afterCursor` query, replays history,
  then registers a live `PatchClient`. Frame format:
  ```json
  { "type": "patch", "patch": { "cursor": 123, "type": "message.upsert",
    "sessionKey": "…", "payload": { … }, "createdAtMs": 1700000000 } }
  ```

---

## 9. Gateway Client (`features/gateway/client.ts`)

Implements protocol **v3** with Ed25519 signed auth:

- `ED25519_SPKI_PREFIX = "302a300506032b6570032100"` (24 bytes).
- `PROTOCOL_VERSION = 3`.
- `DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.admin"]`.
- Client identity:
  ```
  { id: "gateway-client", displayName: "OCPlatform Desktop Middleware",
    version: "0.1.0", platform: "desktop", mode: "backend" }
  ```

Auth flow:

1. Read PEM key material (private Ed25519 + matching public key) from a
   per-user keystore path (created on first run; lazy generation).
2. `derivePublicKeyRaw(pem)` — strips the SPKI prefix to yield 32-byte
   public key.
3. Build payload:
   ```
   v3.<deviceId>.<scopes.join(',')>.<signedAt>.<token>.<nonce>
   ```
4. Sign with `crypto.sign(null, payload, privateKey)` → base64url.
5. WS connect with `Authorization: Ed25519 <publicKey>.<signature>`
   header (or equivalent first frame, per gateway protocol).

Request/response correlation:

- `PendingRequest = { resolve, reject, timer }` map keyed by request id.
- Each `req` frame gets a timeout; on response (`{type: "res", id, ok,
  payload, error}`) the matching promise resolves/rejects and the timer
  is cleared.
- Events (`{type: "event", event, payload}`) are dispatched to listeners
  registered via `gateway.on(event, cb)`; `ChatLiveIngest` is the
  primary consumer.

Status (`gateway.status()`):
```ts
{ connected: boolean, pendingRequests: number, listenerCount: number,
  url: safeUrl, lastError?: errorMeta }
```

Reconnect:
- `connect()` is idempotent; while a connect is in flight, repeated calls
  await the same promise.
- `reconnect()` closes the socket and triggers `connect()`.
- `close()` cancels in-flight requests with a "shutdown" error.

### Gateway routes (`features/gateway/routes.ts`)

- `GET /api/gateway/status` → `{ ok, gateway }`.
- `POST /api/gateway/reconnect` → forces reconnect, returns new status.

---

## 10. Compat Surface (`features/compat/routes.ts`, 4854 LOC)

Legacy v1 endpoints kept for parity with the older OCPlatform server. The
frontend still consumes most of these. Categorized:

### 10.1 Identity & bootstrap

- `GET /api/version`
- `GET /api/bootstrap` — initial spaces, projects, chats payload.

### 10.2 Spaces / projects / chats / topics / sessions

- Spaces: CRUD, archive, switch, rename, delete.
- Projects: CRUD, archive.
- Chats: CRUD, archive, rename, delete (all + per-id),
  `POST /api/chats/:chatId/session` (attach/refresh session).
- Topics: CRUD, archive.
- Sessions: GET list, POST create.

### 10.3 Repos & Git

- `GET /api/repos/recent` — scans workspace root up to depth 4 / 50 dirs.
- `POST /api/repos/scan` — manual rescan.
- `POST /api/repos/select` — choose repo (no-op echo for now).
- Per-project (`/api/projects/:projectId/git/`):
  `status`, `diff`, `branches`, `checkout`.
- Per-path (`/api/repos/git/`): `status`, `diff`, `branches`, `checkout`.

### 10.4 Workspace FS

Per project and global, mirrored routes:

- `GET /workspace/capabilities`, `tree`, `stat`, `file`, `download`.
- `PUT /workspace/file` — write file.
- `DELETE /workspace/file` — delete.
- `POST /workspace/mkdir`, `move`.
- `GET /api/folders/tree`.

All FS access is sandboxed to the OCPlatform workspace root resolved by
`openclawWorkspaceRoot()`.

### 10.5 Streaming forwarders

- `GET /api/stream/cron` — SSE forwarder of cron events.
- `GET /api/stream/chat/:sessionKey` — SSE forwarder of chat patches
  filtered to one session (compat with old EventSource UIs).

### 10.6 Commands & migration

- `POST /api/commands/:command` — generic command bridge.
- `GET /api/migration/telegram/scan`, `POST .../import`.
- `GET /api/migration/discord/scan`, `POST .../import`.
- `POST /api/migration/v1-sqlite/import` — imports legacy v1 SQLite.

### 10.7 Middleware self-update

- `GET /api/middleware/update/status`
- `GET /api/middleware/update/branches`
- `POST /api/middleware/update`

### 10.8 Terminal (PTY)

- `POST /api/terminal/spawn`
- `POST /api/projects/:projectId/terminal/spawn`
- `POST /api/terminal/:ptyId/{write,resize,kill}`
- `GET  /api/terminal/:ptyId/stream` (SSE)
- `GET  /api/terminal/:ptyId/ws` (WebSocket) — used by `XTerminal.tsx`.

Backed by `node-pty` 1.1.0.

### 10.9 Pairing

- `POST /pairing/claim` — exchange pairing code for a `MIDDLEWARE_TOKEN`.
- `GET  /pairing/local` — report local pairing info (code, hostnames).

---

## 11. Skills (`features/skills`)

### 11.1 Service (`service.ts`)

- `skillsDiscover({query, limit, sort, includeLocal, includeClawHub})` —
  merges results from local installed skills and remote ClawHub catalog.
- `skillsInstalledLocal({...})` — enumerates `.skill` directories
  installed under the user/workspace skills paths.
- `installSkill(ctx, {source?, slug?, version?, localPath?, scope?,
  force?})` — installs from registry slug, direct URL, or local path; can
  scope to `user` or `workspace`.

### 11.2 Routes (`routes.ts`)

- `GET  /api/skills/discover`
- `GET  /api/skills/installed`
- `POST /api/skills/install`

Query parsing converts string booleans (`"true"` / `"false"`) into real
booleans before forwarding to the service.

---

## 12. System & Diagnostics

### 12.1 System routes (`features/system/routes.ts`)

- `GET /health`:
  ```json
  {
    "ok": true,
    "service": "openclaw-middleware",
    "version": "0.1.0",
    "build": "chat-image-fallback-collapse",
    "host": "...", "port": 8787,
    "uptimeMs": ...,
    "gateway": { "connected": true, ... },
    "openclaw": { "gatewayUrl": "...", "connected": true },
    "pairing": { "enabled": true }
  }
  ```
  The `openclaw.connected` alias exists for the legacy Connect page so
  old clients don't falsely report "OCPlatform is not running".
- `GET /api/system/info` — extended info (databasePath, gatewayUrl,
  uptimeMs).

### 12.2 Diagnostics routes (`features/diagnostics/routes.ts`)

- `GET /api/diagnostics`:
  ```json
  {
    "ok": true,
    "uptimeMs": ...,
    "gateway": { ... },
    "projection": { "enabled": true, ...messages.diagnostics() },
    "liveIngest": chatLive.diagnostics(),
    "patchBus":  patchBus.diagnostics()
  }
  ```
- `GET /api/logs?limit=N` — returns the in-memory ring buffer (default
  1000 lines), one record per line, JSON. Source label is
  `middleware-memory-buffer`.

---

## 13. Logging & Errors

### 13.1 Logger (`lib/logger.ts`)

- `createLogger(scope)` → `{info, warn, error, debug}`.
- Each entry: `{ts, scope, level, msg, ...meta}` JSON-serialized.
- A bounded ring buffer keeps the most recent N records;
  `getRecentLogLines(limit)` returns them for `/api/logs`.
- `errorMeta(err)` — extracts `name`, `message`, `code`, `stack` (when
  not in production) into a safe object.
- `safePathFromUrl(url)` / `safeUrlForLog(url)` — strip credentials and
  large query payloads before logging.

### 13.2 Error handling (`lib/errors.ts`)

- `registerErrorHandler(app)` installs a Fastify error handler that:
  - Preserves Fastify-validated error codes.
  - Coerces unknown errors to `500`.
  - Returns a uniform body `{ ok: false, error: { code, message } }`.

---

## 14. WebSocket Surfaces (summary)

| Path                                 | Protocol            | Purpose                                |
| ------------------------------------ | ------------------- | -------------------------------------- |
| `/api/patches`                       | WS (JSON frames)    | Live projection patch stream           |
| `/api/terminal/:ptyId/ws`            | WS (binary/text)    | PTY I/O bridge                         |
| `/api/stream/chat/:sessionKey`       | SSE                 | Chat patch stream (compat)             |
| `/api/stream/cron`                   | SSE                 | Cron events                            |
| `/api/terminal/:ptyId/stream`        | SSE                 | PTY stream (compat)                    |
| Gateway connection                   | WS outbound (Ed25519)| Control-plane to OCPlatform Gateway     |

---

## 15. Concurrency & Ordering Guarantees

- **Per-session send ordering**: `SessionSendQueue` serializes
  `/api/chat/send` and `/api/chat/message` per `sessionKey`. A single
  failed send doesn't poison the queue (`previous.catch(()=>undefined)`).
- **Per-session offset**: `v2_gateway_offsets.last_openclaw_seq` ensures
  ingest doesn't reprocess old gateway events.
- **Monotonic patch cursor**: `v2_projection_events.cursor` AUTOINCREMENT
  guarantees global ordering for the WS replay log.
- **Optimistic vs authoritative dedupe**: handled in
  `MessageRepository.isOptimisticConflict` + `runIdentityOf` to avoid
  duplicate rows when an optimistic message is committed before the
  authoritative copy arrives via the gateway.
- **Crash recovery**: `finalizeStaleActivity()` on boot cleans hanging
  runs/tools; `__resetEpoch` patch tells clients to reset cursors when
  the gateway resets sequence numbers.

---

## 16. Testing

- Vitest, configured per package (`apps/middleware/package.json → test`).
- Suites in `apps/middleware/tests/` cover: chat live ingest, send
  queueing, projection ordering, archived backfill, bootstrap
  performance, dedupe, repo behaviors.
- Run:
  ```bash
  pnpm --filter @openclaw/desktop-middleware typecheck
  pnpm --filter @openclaw/desktop-middleware test
  pnpm --filter @openclaw/desktop-middleware build
  ```

---

## 17. Dependencies

`apps/middleware/package.json` runtime deps:

```
@fastify/cors ^11.2.0
@fastify/sensible ^6.0.3
@fastify/websocket ^11.2.0
avvio ^9.2.0
better-sqlite3 ^11.9.1
fastify ^5.6.2
node-pty ^1.1.0
ws ^8.20.0
zod ^3.25.76
```

Dev:

```
@types/better-sqlite3 ^7.6.13
@types/node ^25.5.0
@types/ws ^8.18.1
tsx ^4.20.3
typescript ^5.9.3
vitest ^4.0.15
```

---

## 18. Network Defaults & URLs

| What                      | Default                                              |
| ------------------------- | ---------------------------------------------------- |
| HTTP host                 | `127.0.0.1`                                          |
| HTTP port                 | `8787`                                               |
| Frontend bootstrap URL    | `http://127.0.0.1:8787` (overridable via localStorage) |
| WS patches URL            | same origin → `/api/patches`                         |
| Gateway URL               | from `OPENCLAW_GATEWAY_URL`                          |
| DB                        | `~/.openclaw/.../middleware.sqlite` (resolved via env) |

When the UI runs in a non-loopback browser, it rewrites `127.0.0.1` →
`window.location.hostname:8787` so LAN/tailnet previews work without
extra config.

---

## 19. Endpoint Cheat Sheet (canonical v2)

```
GET    /health
GET    /api/system/info
GET    /api/bootstrap
GET    /api/version

GET    /api/chat/bootstrap?sessionKey=&includeMessages=
POST   /api/chat/message              # send (frontend canonical)
POST   /api/v1/chat/message           # alias
POST   /api/chat/send                 # send (lower level)
POST   /api/chat/abort
GET    /api/chat/messages?sessionKey=&before=&after=&limit=
GET    /api/chat/tool-result?sessionKey=&toolCallId=
GET    /api/chat/search?sessionKey=&q=
GET    /api/chat/session-context?sessionKey=
POST   /api/exec/approval/resolve

WS     /api/patches?afterCursor=

GET    /api/gateway/status
POST   /api/gateway/reconnect

GET    /api/diagnostics
GET    /api/logs?limit=

GET    /api/skills/discover
GET    /api/skills/installed
POST   /api/skills/install
```

Plus the ~80-route compat surface in `features/compat/routes.ts` covering
spaces/projects/chats/topics/sessions/workspace/git/terminal/pairing/
migration/middleware-update — listed in §10.

---

## 20. Recent History (branch `v6-krish`)

Backend-relevant moves carried in / continuing from `v5-dixit`:

- Non-blocking archived-history import / backfill.
- Cold-bootstrap dedupe (`live.ts`).
- Archived tool-call projection / backfill (`gateway-event-projector.ts`,
  `repo.runs.ts`).
- Active-run tool snapshot scoping (`projection.ts`).
- Replay-prune confirmed-user preservation (`repo.messages.ts`).
- `__resetEpoch` projection event to recover UI from stale cursors.
- Frontend-side `v6-krish` work is summarized in `FRONTEND_SYSTEM.md`
  §13.

Verification preferred for changes here:

```bash
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter ui typecheck
pnpm --filter ui build
```
