# OpenClaw Desktop Middleware V2 — Phase-by-Phase Module Implementation Plan

Status: design/plan only. No coding until this plan is approved.

Core principle:

```txt
Do not reinvent OpenClaw.
Gateway is the source of truth.
Middleware-v2 is a desktop adapter + SQLite projection + multi-window fanout layer.
Frontend is the existing UI updated directly on this branch.
```

Dedicated branch decision:

```txt
No frontend feature flag.
This branch directly moves frontend to middleware-v2.
V1 remains fallback by branch/service switch, not runtime UI flag.
```

Ports:

```txt
middleware-v1: 8787
middleware-v2: 8989
```

Database:

```txt
/var/lib/openclaw-middleware-v2/state.sqlite
```

---

## Phase 0 — Preflight and Scope Lock

Goal: make sure we start coding from facts, not assumptions.

Actions:

```txt
1. Confirm repo branch: ui/new-feat.
2. Confirm existing middleware keeps running on 8787.
3. Confirm middleware-v2 will run separately on 8989.
4. Confirm frontend on this branch directly targets 8989.
5. Confirm no approval UI/module in V2 initial scope.
6. Confirm terminal/workspace are full-control local mode.
7. Confirm OpenClaw Gateway primitives are reused first.
```

OpenClaw primitives to trust:

```txt
chat.history
chat.send
chat.abort
/sessions/:key/history SSE
sessions.messages.subscribe
session.message
sessions.changed
sessions.list/preview/get/patch
cron.*
models.*
config.*
usage.*
skills.*
health/status/logs.tail
node.invoke/node events
```

Acceptance:

```txt
Plan accepted by user.
No unresolved source-of-truth confusion.
No duplicate backend execution design remains.
```

---

## Phase 1 — Middleware-v2 Foundation

Goal: create a clean Fastify service shell on port 8989.

Module(s):

```txt
features/system
features/diagnostics
features/gateway
```

Files to create:

```txt
apps/middleware-v2/package.json
apps/middleware-v2/tsconfig.json
apps/middleware-v2/src/index.ts
apps/middleware-v2/src/app.ts
apps/middleware-v2/src/config/env.ts
apps/middleware-v2/src/lib/logger.ts
apps/middleware-v2/src/lib/errors.ts
apps/middleware-v2/src/features/system/routes.ts
apps/middleware-v2/src/features/diagnostics/routes.ts
apps/middleware-v2/src/features/gateway/client.ts
apps/middleware-v2/src/features/gateway/routes.ts
```

OpenClaw reuse:

```txt
Gateway WS RPC protocol
health
status
commands.list
logs.tail
```

V2 adds:

```txt
Fastify service
CORS
JSON error envelope
health endpoint for V2 itself
Gateway connection status
basic diagnostics endpoint
```

Routes:

```txt
GET /health
GET /api/system/info
GET /api/gateway/status
POST /api/gateway/reconnect
GET /api/diagnostics
```

Tests:

```txt
health returns ok
unknown route returns structured 404
Gateway client handles disconnected state
Gateway reconnect does not crash
```

Commands:

```txt
pnpm --filter @openclaw/desktop-middleware-v2 typecheck
pnpm --filter @openclaw/desktop-middleware-v2 test
```

Acceptance:

```txt
middleware-v2 starts on 8989
/health works
Gateway status visible
No changes to v1 middleware behavior
```

---

## Phase 2 — SQLite Projection Base

Goal: create the local read model foundation without inventing a new backend.

Module(s):

```txt
features/db
features/migration
features/diagnostics
```

Files:

```txt
apps/middleware-v2/src/db/connection.ts
apps/middleware-v2/src/db/migrate.ts
apps/middleware-v2/src/db/schema.sql
apps/middleware-v2/src/db/meta.ts
apps/middleware-v2/src/features/diagnostics/db-routes.ts
```

Tables:

```sql
v2_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
v2_sessions(session_key TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)
v2_messages(session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(session_key, openclaw_seq))
v2_projection_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL)
v2_gateway_offsets(session_key TEXT PRIMARY KEY, last_openclaw_seq INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)
```

Important distinction:

```txt
OpenClaw seq = canonical message order inside a session.
V2 cursor = local patch/projection order for frontend windows.
```

OpenClaw reuse:

```txt
__openclaw.seq
messageSeq
chat.history bounded history
/sessions/:key/history cursor
```

V2 adds:

```txt
local read model
local patch cursor
projection diagnostics
schema migration versioning
```

Tests:

```txt
migration creates tables
migration is idempotent
message upsert uses (session_key, openclaw_seq)
projection event cursor increases monotonically
```

Acceptance:

```txt
SQLite opens at configured path
schema version visible in diagnostics
projection can store/retrieve messages by session and seq
```

---

## Phase 3 — Chat History Bootstrap

Goal: bootstrap one session from OpenClaw into V2 projection.

Module(s):

```txt
features/chat
features/gateway
features/diagnostics
```

OpenClaw reuse:

```txt
chat.history
or /sessions/:key/history HTTP snapshot
__openclaw.seq/messageSeq
OpenClaw sanitization/bounds
```

V2 adds:

```txt
/api/chat/bootstrap
history import into SQLite projection
message normalization for frontend
projection freshness metadata
```

Routes:

```txt
GET /api/chat/bootstrap?sessionKey=...
GET /api/chat/messages?sessionKey=...&afterSeq=...&limit=...
```

Files:

```txt
apps/middleware-v2/src/features/chat/routes.ts
apps/middleware-v2/src/features/chat/gateway-history.ts
apps/middleware-v2/src/features/chat/message-normalizer.ts
apps/middleware-v2/src/features/chat/repo.messages.ts
apps/middleware-v2/src/features/chat/types.ts
```

Tests:

```txt
imports chat.history messages into v2_messages
keeps OpenClaw seq
handles messages missing seq by assigning stable fallback only inside projection
never overwrites newer seq with older payload
returns frontend bootstrap shape
```

Acceptance:

```txt
Given real Gateway sessionKey, V2 returns same latest messages as chat.history.
No frontend localStorage message cache needed.
```

---

## Phase 4 — Live Chat Ingest

Goal: keep projection updated from OpenClaw live events.

Module(s):

```txt
features/chat
features/gateway
features/sessions
```

OpenClaw reuse:

```txt
sessions.messages.subscribe
sessions.messages.unsubscribe
session.message event
sessions.changed event
/sessions/:key/history SSE if selected
```

V2 adds:

```txt
subscription registry per active session
one upstream Gateway subscription for many frontend windows
live event normalization
projection event append
```

Files:

```txt
apps/middleware-v2/src/features/chat/live-subscriptions.ts
apps/middleware-v2/src/features/chat/ingest.ts
apps/middleware-v2/src/features/gateway/events.ts
apps/middleware-v2/src/features/sessions/session-key-map.ts
```

Rules:

```txt
Do not create one Gateway subscription per frontend window.
Subscribe once per active session in middleware-v2.
Fan out locally.
```

Tests:

```txt
multiple V2 clients on same session create one Gateway subscription
session.message updates projection
sessions.changed updates session projection/status
out-of-order/duplicate seq does not duplicate message
unsubscribe only when no local clients need session
```

Acceptance:

```txt
Live messages appear in V2 projection without polling chat.history.
Duplicate session.message events do not duplicate UI rows.
```

---

## Phase 5 — Patch Bus and Multi-Window Correctness

Goal: make 5-15 windows reliable like Telegram.

Module(s):

```txt
features/cache
features/chat
features/sessions
features/diagnostics
```

V2 adds:

```txt
WebSocket patch stream
local cursor replay
client registry
afterCursor reconnect
slow consumer handling
patch diagnostics
```

Routes:

```txt
GET /api/stream/ws?afterCursor=...
GET /api/patches?afterCursor=...
GET /api/diagnostics/patch-clients
GET /api/diagnostics/cursors
```

Patch types:

```txt
chat.message.upsert
chat.message.delete optional
session.upsert
session.status
cron.update later
notification.upsert later
resync.required
```

Files:

```txt
apps/middleware-v2/src/features/patches/patch-bus.ts
apps/middleware-v2/src/features/patches/routes.ts
apps/middleware-v2/src/features/patches/replay.ts
apps/middleware-v2/src/features/patches/types.ts
```

Tests:

```txt
5 clients receive same patch order
15 clients do not create 15 Gateway subscriptions
client reconnect after cursor receives missed patches
old cursor beyond retention returns resync.required
slow client disconnect does not block others
```

Acceptance:

```txt
5 windows normal.
15 windows correct/responsive.
No stale window overwrites newer state.
```

---

## Phase 6 — Frontend Direct V2 Chat Engine

Goal: update existing UI directly. No feature flag.

Module(s):

```txt
frontend chat engine
frontend session store
frontend cache snapshot
```

Existing frontend to update:

```txt
packages/ui/components/ChatView/index.tsx
packages/ui/hooks/useChatMessages.ts
packages/ui/lib/localFirstSync.ts
packages/ui/lib/chatMessageDedupe.ts
packages/ui/components/ChatBox or send hook files
sidebar/session list hooks
```

New frontend files:

```txt
packages/ui/lib/chat-engine-v2/client.ts
packages/ui/lib/chat-engine-v2/store.ts
packages/ui/lib/chat-engine-v2/applyPatches.ts
packages/ui/lib/chat-engine-v2/selectors.ts
packages/ui/lib/chat-engine-v2/snapshot.ts
packages/ui/lib/chat-engine-v2/types.ts
packages/ui/hooks/useChatEngineV2.ts
packages/ui/hooks/useChatTimelineV2.ts
packages/ui/hooks/useChatSendV2.ts
```

Frontend rules:

```txt
No full message arrays in localStorage.
No BroadcastChannel full-array sync.
No frontend-owned canonical message history.
IndexedDB snapshot allowed only for startup speed.
Apply only newer V2 patch cursor.
Use OpenClaw seq for message ordering.
```

Tests:

```txt
applyPatches ignores stale cursor
message selector returns stable ordered rows
switching sessions does not render old session async results
cache snapshot cannot overwrite newer runtime state
```

Acceptance:

```txt
Existing UI runs against 8989.
ChatView uses V2 normalized store.
Fast session switching no longer mixes messages.
```

---

## Phase 7 — Send Path and Idempotency

Goal: sending messages works correctly across tabs/windows.

Module(s):

```txt
features/chat
frontend send hook
```

OpenClaw reuse:

```txt
chat.send
chat.abort
OpenClaw transcript update for user message
session.message event for persisted result
```

V2 adds:

```txt
stable client-generated send idempotency key
pending send projection
send status patches
single canonical pending row behavior
```

Routes:

```txt
POST /api/chat/send
POST /api/chat/abort
```

Rules:

```txt
Do not generate random idempotency key per retry.
Do not let each tab create a separate optimistic canonical row.
Pending UI row must reconcile with OpenClaw persisted user message.
```

Tests:

```txt
retry uses same idempotency key
two tabs sending same request key do not duplicate user message
abort updates status everywhere
assistant response attaches to correct session/message
```

Acceptance:

```txt
Send from any window updates all windows.
No duplicate user blocks.
No assistant answer under wrong session after fast switching.
```

---

## Phase 8 — Sessions Sidebar and Session Actions

Goal: move session list/sidebar/status to V2 projection.

Module(s):

```txt
features/sessions
frontend sidebar/session hooks
```

OpenClaw reuse:

```txt
sessions.list
sessions.preview
sessions.get
sessions.resolve
sessions.subscribe
sessions.changed
sessions.create
sessions.patch
sessions.reset
sessions.delete
sessions.compact
```

V2 adds:

```txt
fast session projection
sidebar sorting/filtering
preview cache
key normalization cache
```

Routes:

```txt
GET /api/sessions
GET /api/sessions/:key
POST /api/sessions
PATCH /api/sessions/:key
POST /api/sessions/:key/reset
DELETE /api/sessions/:key
```

Tests:

```txt
sessions.changed updates sidebar preview
canonical key mapping prevents duplicate session rows
deleted/reset session invalidates projection
session create returns canonical key
```

Acceptance:

```txt
Sidebar remains consistent across windows.
Session status/preview updates without manual refresh.
```

---

## Phase 9 — Tools and Subagents Timeline

Goal: render tools/subagents correctly without duplicating runtime.

Module(s):

```txt
features/tools
features/subagents
features/chat timeline
```

OpenClaw reuse:

```txt
tools.catalog
tools.effective
session.tool event
agent/tool events
sessions.list with child/parent/spawned metadata
sessions.send/steer/abort
agent.wait if needed
chat.history transcript entries
```

V2 adds:

```txt
timeline projection rows
lazy tool payload endpoint
subagent tree projection
completion/status notification patches
```

Routes:

```txt
GET /api/tools/catalog
GET /api/tools/effective?sessionKey=...
GET /api/chat/tools/:toolCallId
GET /api/subagents?parentSessionKey=...
POST /api/subagents/:key/steer
POST /api/subagents/:key/abort
```

Tests:

```txt
tool call/result rows pair correctly
large tool output is lazy-loaded
subagent child session appears under parent
subagent completion updates parent timeline/notifications
```

Acceptance:

```txt
Existing tool/subagent UI behavior preserved.
No huge tool JSON pushed to every window by default.
```

---

## Phase 10 — Cron and Activity/Notifications

Goal: expose cron and activity using Gateway as source of truth.

Module(s):

```txt
features/cron
features/notifications
features/activity
```

OpenClaw reuse:

```txt
cron.list
cron.status
cron.add/update/remove/run/runs
cron event
heartbeat event
last-heartbeat
wake
agent/chat/session/health/presence events
system-presence
system-event
```

V2 adds:

```txt
cron dashboard projection
run history UI shape
activity timeline projection
read/unread local UI state
notification grouping
```

Routes:

```txt
GET /api/cron/status
GET /api/cron/jobs
GET /api/cron/jobs/:id/runs
POST /api/cron/jobs/:id/run
PATCH /api/cron/jobs/:id
DELETE /api/cron/jobs/:id
GET /api/activity
GET /api/notifications
POST /api/notifications/read
```

Tests:

```txt
cron event updates cached job/run state
run-now calls Gateway cron.run
failed cron run appears in activity/notifications
read/unread state remains local UI state only
```

Acceptance:

```txt
Cron UI works without rebuilding scheduler.
Activity feed reflects Gateway events.
```

---

## Phase 11 — Models, Config, Usage, Skills

Goal: replace remaining settings/dashboard API calls with thin V2 wrappers.

Module(s):

```txt
features/models
features/config
features/usage
features/skills
```

OpenClaw reuse:

```txt
models.list
models.authStatus
config.get/set/apply/patch/schema/schema.lookup
usage.status
usage.cost
sessions.usage/timeseries/logs
skills.status/search/detail/bins/install/update
```

V2 adds:

```txt
UI-shaped response objects
short cache
combined dashboard endpoints
error formatting
```

Routes:

```txt
GET /api/models
GET /api/models/auth-status
GET /api/config
PATCH /api/config
GET /api/usage/summary
GET /api/sessions/:key/usage
GET /api/skills/status
GET /api/skills/search
GET /api/skills/:id
```

Tests:

```txt
V2 wrappers call expected Gateway method
schema validation errors are surfaced clearly
short cache invalidates after mutation
skills install/update passes through Gateway
```

Acceptance:

```txt
Settings/dashboard pages no longer depend on v1 middleware-specific routes.
No provider/config/skill logic duplicated.
```

---

## Phase 12 — Terminal and Workspace Full-Control Adapters

Goal: use existing OpenClaw/local runtime power, not a restrictive new abstraction.

Module(s):

```txt
features/terminal
features/workspace
```

OpenClaw reuse:

```txt
node.invoke
node.list
node.describe
node.event
exec.started/finished/denied
agents.files.list/get/set for agent workspace files
local runtime command execution capability
```

V2 adds only if needed:

```txt
terminal tab metadata
stream fanout
PTY adapter if existing primitive lacks interactive PTY
workspace tree adapter
file watcher debounce
recent roots/files
```

Routes if needed:

```txt
POST /api/terminal/open
GET /api/terminal/:id/stream/ws
POST /api/terminal/:id/write
POST /api/terminal/:id/resize
POST /api/terminal/:id/close
GET /api/workspace/tree
GET /api/workspace/file
POST /api/workspace/file
GET /api/workspace/watch/ws
```

Rules:

```txt
Full local control.
No approval UI.
No new sandbox model.
No virtual filesystem.
Still show explicit paths and confirmations for destructive UI actions.
```

Tests:

```txt
terminal stream reaches multiple windows if same terminal viewed twice
terminal close cleans up process/session metadata
workspace file read/write uses selected root/path visibly
file watcher updates tree without loops
```

Acceptance:

```txt
Terminal/workspace work with full local power.
No restrictive permission system added.
```

---

## Phase 13 — Media and Git Later Modules

Goal: add only after chat/session core is stable.

Media OpenClaw reuse:

```txt
chat.send attachment behavior
chat.history media/canvas blocks
transcript media rewriting
provider formatting
```

Media V2 adds if needed:

```txt
upload/preview cache
media reference endpoint
local preview proxy
```

Git current state:

```txt
No clear native git.* Gateway primitive found.
Use node.invoke/system.run only as fallback.
Prefer later small safe git primitives if UI needs git deeply.
```

Do not build initially:

```txt
full Git client
commit/push/merge/rebase workflow
large media manager
```

Acceptance:

```txt
No Git/media scope blocks chat V2 cutover.
Git/media added only after exact UI need is confirmed.
```

---

## Phase 14 — Diagnostics, Migration, and Cutover

Goal: prove V2 can replace v1 safely.

Module(s):

```txt
features/diagnostics
features/migration
all modules
```

Diagnostics required:

```txt
Gateway connection status
SQLite schema/status
active Gateway subscriptions
patch clients/window count
last patch cursor per client
last OpenClaw seq per session
projection lag
session debug: why message missing?
cron/gateway event freshness
```

Migration/cutover routes:

```txt
GET /api/migration/status
POST /api/migration/import-v1 optional
GET /api/migration/compare/session/:key
POST /api/migration/reindex/session/:key
```

V1 rules:

```txt
V2 may read V1 data if necessary.
V2 must not mutate V1 DB/state during migration.
V1 fallback remains possible until V2 acceptance passes.
```

Final acceptance tests:

```txt
5 windows same session: no duplicates, same order everywhere
15 windows passive: no missed final message, responsive
5 windows different sessions: no cross-session leakage
sleeping window reconnect: catches up without stale overwrite
slow consumer: disconnected/reconnects without blocking others
send retry: stable idempotency key, no duplicate user block
cron: list/status/runs/run-now works
settings/models/usage/skills pages work through V2 wrappers
terminal/workspace full-control adapters work if implemented
```

Cutover acceptance:

```txt
Frontend uses 8989 for middleware APIs.
No localStorage message array dependency remains.
No BroadcastChannel canonical chat sync remains.
Build/typecheck/tests pass.
Manual multi-window test passes.
V1 can be stopped without breaking required desktop flows.
```

---

## Recommended Coding Order

```txt
0. Approve this plan.
1. Phase 1 foundation.
2. Phase 2 DB projection base.
3. Phase 3 chat bootstrap.
4. Phase 4 live ingest.
5. Phase 5 patch bus/multi-window.
6. Phase 6 frontend direct V2 engine.
7. Phase 7 send path.
8. Phase 8 sessions sidebar.
9. Phase 9 tools/subagents.
10. Phase 10 cron/activity.
11. Phase 11 models/config/usage/skills.
12. Phase 12 terminal/workspace if UI needs it immediately.
13. Phase 14 diagnostics/migration/cutover.
14. Phase 13 media/git later as needed.
```

Do not start with terminal/workspace/git/media. They are important, but they should not block fixing the main chat/session/multi-window correctness problem.

---

## Correction: Workspace / Git / Terminal Stay on V1 Backend

Decision:

```txt
Do not rebuild workspace, git, or terminal in middleware-v2.
Keep them on the existing V1 backend/runtime.
```

Phase 12 is therefore changed from “build adapters” to:

```txt
Phase 12 — Package/Routing Compatibility Only
```

Scope:

```txt
- keep existing terminal backend behavior
- keep existing workspace backend behavior
- keep existing git/backend-command behavior
- adjust package/routing references only if the new app structure requires it
- do not create new V2 terminal/workspace/git routes
```

Acceptance:

```txt
Existing terminal/workspace/git UI continues to work exactly like V1.
V2 chat/session work does not regress those features.
No new abstraction or permission model is introduced.
```

Updated coding priority:

```txt
Workspace/Git/Terminal are not part of V2 rewrite scope.
They are compatibility surfaces to preserve.
```

---

## Pre-Coding Test Strategy

Before coding, define how V2 proves it works.

### 1. Unit tests

Run inside `apps/middleware-v2`.

Covers:

```txt
message normalization
OpenClaw seq handling
SQLite upsert behavior
patch cursor ordering
stale patch rejection
idempotency key handling
session key normalization
```

Example acceptance:

```txt
same sessionKey + same OpenClaw seq = update existing row, not duplicate
patch cursor 10 applied before cursor 9 = cursor 9 ignored by frontend store
```

---

### 2. Gateway contract tests

Use real or mocked Gateway RPC shape.

Covers:

```txt
chat.history -> V2 bootstrap shape
session.message event -> SQLite projection update
sessions.changed event -> session projection update
chat.send passthrough -> stable idempotency key
```

Important:

```txt
V2 must not assume Gateway gives fields that code does not actually provide.
```

---

### 3. Integration tests against real local OpenClaw Gateway

Use current OpenClaw Gateway on `8787` or configured Gateway WS.

Covers:

```txt
V2 starts on 8989
V2 connects to Gateway
/api/chat/bootstrap returns real session messages
live Gateway event updates V2 projection
```

This is required because user prefers testing against real middleware/Gateway behavior, not isolated fixtures only.

---

### 4. Multi-window load tests

Create scripts that simulate many browser windows/WebSocket clients.

Scripts:

```txt
apps/middleware-v2/scripts/test-5-windows.cjs
apps/middleware-v2/scripts/test-15-windows.cjs
apps/middleware-v2/scripts/test-sleep-reconnect.cjs
apps/middleware-v2/scripts/test-slow-client.cjs
```

Covers:

```txt
5 clients same session receive same patches in same order
15 clients do not create 15 Gateway subscriptions
sleeping client reconnects with afterCursor and catches up
slow client does not block other clients
```

---

### 5. Frontend store tests

Run in `packages/ui`.

Covers:

```txt
applyPatches ignores stale cursor
session switch does not show old session messages
snapshot cache cannot overwrite newer runtime state
send pending row reconciles with persisted OpenClaw message
```

---

### 6. Manual UI test checklist

Must pass before calling chat V2 done:

```txt
Open 5 windows on same session.
Send messages from different windows.
All windows show same order.
No duplicate user blocks.
No answer appears in wrong session.
Fast switch between 5 sessions while streaming.
Sleeping/reloaded window catches up.
Long tool output does not lag all windows.
```

---

### 7. Regression tests for preserved V1 surfaces

Because workspace/git/terminal stay on V1 backend, verify they still work after V2 chat changes.

Covers:

```txt
terminal still opens/runs existing path
workspace/file UI still uses existing backend
Git UI/commands still use existing backend/package
```

No V2 rewrite for these surfaces.

---

### 8. Minimum test gate per phase

Each coding phase must end with:

```txt
typecheck
targeted unit tests
targeted integration/manual check
short note of what passed and what is still not covered
```

Do not move to the next phase if the current phase has an untested correctness assumption.
