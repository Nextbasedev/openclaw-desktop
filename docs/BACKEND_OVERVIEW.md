# Backend Overview

This guide is for agents working in `apps/middleware`, the local backend that connects the desktop UI to the remote OCPlatform Gateway. It explains the end-to-end architecture, the important modules, and the invariants that keep chat reliable.

## Mental Model

The backend is a Fastify 5 service that runs locally, usually on port `8787`. It owns local persistence, gateway connectivity, chat projection, patch broadcasting, compatibility routes, and skill proxying.

Main path:

```text
UI HTTP/WebSocket request
  -> Fastify route
  -> AppContext service/repository
  -> SQLite and/or remote Gateway WebSocket
  -> projection event
  -> PatchBus
  -> UI WebSocket subscribers
```

The backend is not just a proxy. It is the local source of projected chat truth for the UI.

## Entry Points

| File | Role |
| --- | --- |
| `apps/middleware/src/index.ts` | Loads env, creates app, starts HTTP server, auto-connects gateway. |
| `apps/middleware/src/app.ts` | Creates Fastify app, DB, gateway client, repositories, patch bus, and registers routes. |
| `apps/middleware/src/config/env.ts` | Host, port, database path, gateway config, identity paths. |
| `apps/middleware/src/db/migrate.ts` | SQLite schema and migrations. |
| `apps/middleware/src/features/patches.ts` | Patch bus and patch stream routes. |
| `apps/middleware/src/features/chat/routes.ts` | Core chat routes: send, abort, bootstrap, messages, search, tool result. |
| `apps/middleware/src/features/chat/live.ts` | Projects live gateway events into messages, runs, tools, and patches. |
| `apps/middleware/src/features/gateway/client.ts` | WebSocket v3 Gateway client with Ed25519 device auth. |

## App Context

`createApp()` builds one shared `AppContext`:

```text
config
gateway
db
messages
runs
chatLive
sendQueue
patchBus
startedAtMs
compat
```

Routes should use this context instead of creating their own clients or database handles.

## Key Directories

```text
apps/middleware/
  src/
    app.ts                  Fastify setup and route registration
    index.ts                Server startup and gateway auto-connect
    config/env.ts           Environment loading
    db/
      connection.ts         SQLite open/close
      migrate.ts            Schema version and migrations
      json.ts               JSON helpers
    features/
      chat/                 Core chat pipeline
      compat/               Legacy API compatibility layer
      gateway/              Remote Gateway WebSocket client and routes
      skills/               Skill discovery/install proxy
      system/               Health/info/pairing routes
      diagnostics/          Logs and debugging routes
      patches.ts            Patch bus and patch replay/stream
    lib/
      errors.ts             HttpError and error handler
      logger.ts             Structured logging and log buffer
  tests/                    Vitest suites
```

## Chat Send End-to-End Flow

1. UI calls `POST /api/chat/send`.
2. `features/chat/routes.ts` validates request input.
3. Attachments are normalized by `features/chat/attachments.ts`.
4. A run is created or updated through `RunRepository`.
5. An optimistic user message is projected through `MessageRepository`.
6. Patch bus broadcasts optimistic state to the UI.
7. `SessionSendQueue` serializes sends for the session.
8. `GatewayClient.request("chat.send", ...)` forwards to the remote Gateway.
9. Gateway response only confirms the request was accepted.
10. Gateway history/events later echo user and assistant messages.
11. `ChatLiveIngest` projects those events into canonical local messages, runs, tools, and patches.
12. UI receives patch frames from `WS /api/stream/ws`.

Important: do not broadcast final "done" only because `chat.send` returned. Completion waits for assistant history/projection.

## Bootstrap End-to-End Flow

1. UI calls `GET /api/chat/bootstrap?sessionKey=...`.
2. Backend finalizes stale bootstrap runs/tools.
3. Backend reads local messages, active run, and tool calls from SQLite.
4. It may prewarm or backfill archived history.
5. `buildChatBootstrapSnapshot()` creates the canonical response.
6. UI paints authoritative projected state and continues from patch cursor.

Bootstrap must not adopt old detached tool rows into a new active run. Tool lifecycle is run-scoped.

## Live Gateway Event Flow

Gateway events arrive through `GatewayClient`, then are handled by chat ingestion:

```text
Gateway WebSocket event
  -> ChatLiveIngest
  -> gateway-event-projector.ts
  -> MessageRepository / RunRepository
  -> canonicalPatchPayload()
  -> PatchBus.publish()
  -> /api/stream/ws clients
```

Important files:

- `features/chat/live.ts`
- `features/chat/gateway-event-projector.ts`
- `features/chat/message-normalizer.ts`
- `features/chat/projection.ts`
- `features/chat/repo.messages.ts`
- `features/chat/repo.runs.ts`

## Patch Bus

`features/patches.ts` provides:

- in-memory subscribers for live WebSocket clients
- HTTP replay via `GET /api/patches`
- WebSocket stream via `GET /api/stream/ws`
- patch client diagnostics via `GET /api/diagnostics/patch-clients`

Patch frames are also stored as projection events in SQLite so clients can replay missed updates.

All user-visible chat state should flow through projection events and patches.

## Database

SQLite is opened in `db/connection.ts` and migrated in `db/migrate.ts`. Current schema version is `2`.

Important tables:

| Table | Purpose |
| --- | --- |
| `v2_sessions` | Session metadata and state. |
| `v2_chat_segments` | Segmented chat history with `base_seq`. |
| `v2_messages` | Projected messages keyed by `(session_key, openclaw_seq)`. |
| `v2_runs` | Run lifecycle and gateway run mapping. |
| `v2_tool_calls` | Tool lifecycle, args, result metadata. |
| `v2_projection_events` | Patch replay log. |
| `v2_gateway_offsets` | Last projected gateway sequence per session. |
| `v2_compat_state` | Legacy route state. |

Message order is based on `openclaw_seq` within segments. Never switch to timestamp ordering.

## Route Groups

| Group | File | Purpose |
| --- | --- | --- |
| System | `features/system/routes.ts` | Health, info, pairing, startup checks. |
| Gateway | `features/gateway/routes.ts` | Gateway status and reconnect. |
| Chat | `features/chat/routes.ts` | Send, abort, bootstrap, messages, media, search, tool result. |
| Patches | `features/patches.ts` | Patch replay and WebSocket stream. |
| Skills | `features/skills/routes.ts` | Skill discovery, installed skills, install. |
| Compat | `features/compat/routes.ts` | Legacy v1 command/API compatibility. |
| Diagnostics | `features/diagnostics/routes.ts` | Logs, projection/debug state. |

Full route inventory lives in `docs/constraints/api-routes.md`.

## Gateway Client

`features/gateway/client.ts` owns the remote WebSocket connection.

Key facts:

- protocol version: `3`
- auth: Ed25519 device identity
- default request timeout: 30 seconds
- chat send timeout is handled by chat routes with a longer timeout
- auto-connect starts in `src/index.ts` after the HTTP server is listening

Gateway events include:

- `session.message`
- `session.tool`
- `sessions.changed`
- `chat.event`
- `agent.event`

When changing gateway behavior, also check `docs/constraints/gateway.md`.

## Compatibility Layer

`features/compat/routes.ts` is large because it preserves older API behavior. It includes commands for spaces, chats, projects, topics, sessions, workspace files, git, terminal PTY, migrations, and self-update.

Agent guidance:

- Prefer core v2 routes for new chat work.
- Keep compat behavior stable unless the task explicitly touches legacy APIs.
- If a UI call still uses `/api/commands/:command`, trace it through compat before changing backend assumptions.

## Skills Backend

Skill routes live in `features/skills`.

Main files:

- `routes.ts`: HTTP routes
- `service.ts`: local skills, ClawHub/SkillHub discovery, install, toggle

Important limits:

- ClawHub request timeout: `CLAWHUB_TIMEOUT_MS` = 15 seconds
- cache TTL: `CACHE_TTL_MS` = 30 seconds

Do not hardcode these values in responses. Import constants when needed.

## Limits and Timeouts

| Constraint | Value | File |
| --- | --- | --- |
| Middleware body limit | 25 MB | `src/app.ts` |
| Embedded text attachment cap | 120K chars | `features/chat/attachments.ts` |
| Total embedded text cap | 300K chars | `features/chat/attachments.ts` |
| Gateway request timeout | 30 seconds | `features/gateway/client.ts` |
| Chat send timeout | 120 seconds | `features/chat/routes.ts` |
| Chat send gateway timeout | 130 seconds | `features/chat/routes.ts` |
| Stale active run timeout | 10 minutes | `features/chat/repo.runs.ts` |
| Stale running tool timeout | 30 minutes | `features/chat/repo.runs.ts` |
| Stale detached tool timeout | 5 minutes | `features/chat/repo.runs.ts` |
| Projection version | 3 | `features/chat/projection.ts` |

## Common Change Paths

### Add a new backend route

1. Pick the correct feature folder.
2. Define a Zod schema for request input when the route accepts body/query data.
3. Use `AppContext` services and repositories.
4. Throw `HttpError` for structured API errors.
5. Broadcast through `context.patchBus` when UI state changes.
6. Add or update Vitest coverage in `apps/middleware/tests`.

### Change chat send behavior

Start in:

- `features/chat/routes.ts`
- `features/chat/send-queue.ts`
- `features/chat/attachments.ts`
- `features/gateway/client.ts`

Check:

- optimistic message always confirms or fails
- send queue remains session-scoped
- gateway send response is not treated as final completion
- errors set failed status for UI retry

### Change live message projection

Start in:

- `features/chat/live.ts`
- `features/chat/gateway-event-projector.ts`
- `features/chat/projection.ts`
- `features/chat/message-normalizer.ts`

Check:

- `openclaw_seq` is preserved
- duplicate gateway echoes dedupe correctly
- tool calls remain attached to the correct `runId`
- subagent events correlate correctly

### Change persistence

Start in:

- `db/migrate.ts`
- `features/chat/repo.messages.ts`
- `features/chat/repo.runs.ts`

Check:

- migrations are idempotent
- schema version changes are deliberate
- tests cover legacy/backfill behavior
- projection event replay remains compatible

## Backend Invariants

- Patch bus is the single source of UI truth.
- Every optimistic user message is confirmed or failed.
- Message ordering uses `openclaw_seq`, not timestamps.
- Gateway `chat.send` success does not mean assistant output is complete.
- Session sync preserves imported, manual, local, and desktop-created sessions.
- Tool calls are scoped to a `runId`.
- Stale runs and detached tools must be finalized, not silently reused.
- Middleware body limit remains high enough for base64 attachment overhead.

## Useful Commands

Run from repository root:

```bash
pnpm --filter @openclaw/desktop-middleware dev
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware build
pnpm --filter @openclaw/desktop-middleware test
```

Focused tests:

```bash
pnpm --filter @openclaw/desktop-middleware test -- send.test.ts
pnpm --filter @openclaw/desktop-middleware test -- projection.test.ts
pnpm --filter @openclaw/desktop-middleware test -- patch-stream.test.ts
```

## Agent Checklist

Before editing:

- Read `AGENTS.md`.
- Read the relevant constraint doc in `docs/constraints/`.
- Trace the route from UI helper to backend route to repository/projection.

Before finishing:

- Run `pnpm --filter @openclaw/desktop-middleware typecheck`.
- Run focused tests for the changed feature.
- Add or update tests for projection, migration, send lifecycle, or route contracts.
- Mention any verification that could not be run.
