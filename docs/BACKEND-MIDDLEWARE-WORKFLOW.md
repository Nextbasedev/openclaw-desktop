# Backend & Middleware Workflow

Complete workflow documentation for the OpenClaw Desktop backend (server + middleware + Tauri shell).

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Startup Sequence](#2-startup-sequence)
3. [Gateway Connection & Authentication](#3-gateway-connection--authentication)
4. [Command Dispatch System](#4-command-dispatch-system)
5. [Chat Message Workflow](#5-chat-message-workflow)
6. [Session Lifecycle](#6-session-lifecycle)
7. [Branching Conversations](#7-branching-conversations)
8. [Database Layer](#8-database-layer)
9. [Server-Sent Events (SSE) Streaming](#9-server-sent-events-sse-streaming)
10. [Terminal / PTY System](#10-terminal--pty-system)
11. [Cron Scheduling](#11-cron-scheduling)
12. [Sync Engine](#12-sync-engine)
13. [Models & Auth](#13-models--auth)
14. [Error Handling & Resilience](#14-error-handling--resilience)
15. [File Reference](#15-file-reference)

---

## 1. System Architecture

### Layer Stack

```
┌─────────────────────────────────────────────────┐
│  Tauri Desktop Shell (Rust)                     │
│  packages/desktop/src-tauri/                    │
│  - Process management, IPC bridge, SQLite init  │
├─────────────────────────────────────────────────┤
│  Next.js UI (React 19, Static Export)           │
│  packages/ui/                                   │
│  - Webview renders at localhost:3000             │
├─────────────────────────────────────────────────┤
│  Jarvis Server (Express.js on :3001)            │
│  packages/server/                               │
│  - Local API, SQLite, SSE, services             │
├─────────────────────────────────────────────────┤
│  Middleware (WebSocket Client Library)           │
│  packages/middleware/                            │
│  - Gateway protocol v3, ED25519 auth            │
├─────────────────────────────────────────────────┤
│  OpenClaw Gateway (Remote, :18789)              │
│  - Cloud agents, sessions, cron, sync           │
└─────────────────────────────────────────────────┘
```

### Communication Patterns

| From → To | Protocol | Purpose |
|-----------|----------|---------|
| UI → Server | HTTP POST `/api/ipc/:command` | All commands via dispatch |
| UI → Server | HTTP GET `/api/stream/*` | SSE for chat, terminal, cron |
| Server → Gateway | WebSocket (ws://) | RPC + event subscription |
| Tauri → Server | Spawns process on :3001 | Backend lifecycle |
| Tauri → UI | IPC (`__TAURI__.core.invoke`) | Native OS features |

---

## 2. Startup Sequence

### Development Mode

```
pnpm dev:tauri
  │
  ├── Tauri starts (Rust)
  │     └── ensure_backend()
  │           └── Waits up to 30s for server on :3001
  │               (user must start server manually or via beforeDevCommand)
  │
  └── Next.js dev server on :3000 (Turbopack)
```

### Production Mode

```
App launches
  │
  ├── Tauri starts (Rust)
  │     └── ensure_backend()
  │           ├── TCP health check on :3001 (500ms timeout)
  │           ├── If server found → use existing
  │           └── If not found → spawn bundled Node.js
  │                 ├── Location: {resource_dir}/bundled/server/
  │                 │     ├── bin/node[.exe]
  │                 │     └── dist/index.js
  │                 ├── Env: NODE_ENV=production, JARVIS_SERVER_PORT=3001
  │                 ├── Logs: ~/.config/jarvis/backend.log
  │                 └── Windows: Job Object ensures child dies with parent
  │
  └── Server startup (Express.js)
        ├── 1. Start sync engine (database ↔ cloud)
        ├── 2. Connect to OpenClaw Gateway (fallback-tolerant)
        ├── 3. Start cron event listener
        └── 4. Listen on :3001
```

### Server Routes

```
POST /api/ipc/:command              → Command dispatcher (265 commands)
GET  /api/stream/chat/:sessionKey   → Chat event SSE stream
GET  /api/stream/terminal/:sessionId → Terminal output SSE stream
GET  /api/stream/pty/:ptyId         → Ephemeral PTY output SSE stream
GET  /api/stream/cron               → Cron event broadcast SSE stream
GET  /health                        → Health check
```

---

## 3. Gateway Connection & Authentication

### Protocol Constants

| Constant | Value |
|----------|-------|
| Protocol version | 3 |
| Default capabilities | `["chat", "sessions"]` |
| Client ID | `openclaw-control-ui` |
| Client mode | `webchat` |
| Default gateway port | 18789 |
| Operator scopes | `operator.read`, `operator.write`, `operator.approvals`, `operator.admin` |

### ED25519 Challenge-Response Handshake

```
Client                                    Gateway
  │                                          │
  ├──── WebSocket connect ──────────────────►│
  │     ws://127.0.0.1:18789                 │
  │                                          │
  │◄──── connect.challenge ─────────────────┤
  │      { nonce: "<random>" }               │
  │                                          │
  │  Build auth payload (v3 format):         │
  │  "v3|<deviceId>|<clientId>|<clientMode>  │
  │   |<role>|<scopes>|<signedAtMs>          │
  │   |<token>|<nonce>|<platform>            │
  │   |<deviceFamily>"                       │
  │                                          │
  │  Sign payload with ED25519 private key   │
  │                                          │
  ├──── connect request ────────────────────►│
  │     {                                    │
  │       minProtocol: 3,                    │
  │       maxProtocol: 3,                    │
  │       client: { id, displayName, ... },  │
  │       auth: { token },                   │
  │       device: {                          │
  │         id,                              │
  │         publicKey (base64url, 32 bytes), │
  │         signature (base64url),           │
  │         signedAt (ms),                   │
  │         nonce                            │
  │       }                                  │
  │     }                                    │
  │                                          │
  │◄──── hello-ok ──────────────────────────┤
  │      { server, connId, methods[] }       │
  │                                          │
  │      Connection established ✓            │
```

### Identity & Configuration Files

| File | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | Gateway URL, port, agent defaults |
| `~/.openclaw/state/identity/device.json` | ED25519 key pair, device ID |
| `~/.jarvis/openclaw-desktop/jarvis.db` | Local SQLite database |
| `~/.openclaw/skills/` | Installed skills directory |
| `~/.openclaw/skills-config.json` | Skill enable/disable state |
| `~/.config/jarvis/backend.log` | Server process log |

### Reconnection Strategy

```
Connection lost
  ├── Wait 3 seconds (initial delay)
  ├── Attempt reconnect
  ├── If fail → double delay (cap at 30s)
  ├── Repeat indefinitely
  └── On success → reset delay to 3s
```

### Gateway Client Singleton

```typescript
connectGateway()         // Connect with auth
getGatewayClient()       // Get client (throws if disconnected)
ensureGatewayClient()    // Connect if needed, return client
isGatewayConnected()     // Boolean status check
disconnectGateway()      // Close connection
```

---

## 4. Command Dispatch System

### How It Works

```
UI Component
  │
  ├── POST /api/ipc/middleware_chat_send
  │   Body: { input: { sessionKey, text } }
  │
  ▼
dispatch/handler.ts
  │
  ├── Extract :command from URL params
  ├── Lookup handler in registry
  ├── Call handler(input, req)
  ├── Return JSON result or { error }
  │
  ▼
dispatch/registry.ts
  │
  └── Map of 265 command → handler function
```

### Command Categories (265 total)

| Category | Count | Example Commands |
|----------|-------|------------------|
| Runtime | 6 | `middleware_runtime_info`, `middleware_request_admin_access` |
| Profiles | 7 | `middleware_profiles_list`, `middleware_profiles_create` |
| Projects | 7 | `middleware_projects_list`, `middleware_projects_create` |
| Topics | 7 | `middleware_topics_list`, `middleware_topics_create` |
| Sessions | 4 | `middleware_sessions_create`, `middleware_sessions_list` |
| Branches | 7 | `middleware_branch_create`, `middleware_branch_from_edit` |
| Files | 8 | `middleware_files_read`, `middleware_files_write` |
| Filesystem | 8 | `middleware_filesystem_list`, `middleware_filesystem_stat` |
| Git | 7 | `middleware_git_status`, `middleware_git_branch_switch` |
| Memory | 6 | `middleware_memory_search`, `middleware_memory_recall` |
| Skills | 13 | `middleware_skills_list`, `middleware_skills_install` |
| Chats | 10 | `middleware_chats_list`, `middleware_chats_create` |
| Chat (Gateway) | 9 | `middleware_chat_send`, `middleware_chat_history` |
| Cron | 12 | `middleware_cron_list_jobs`, `middleware_cron_create_job` |
| Sync | 6 | `middleware_sync_status`, `middleware_sync_push_now` |
| Terminal | 4 | `middleware_terminal_create`, `middleware_terminal_write` |
| Models | 3 | `middleware_models_list`, `middleware_models_set_default` |
| Usage | 4 | `middleware_usage_summary`, `middleware_usage_estimate` |
| Onboarding | 17 | `middleware_onboarding_validate_gateway`, `middleware_onboarding_init_workspace` |
| Connect | 5 | `middleware_connect_status`, `middleware_connect_test` |

---

## 5. Chat Message Workflow

### Sending a Message (Complete Flow)

```
UI: User types message and hits Send
  │
  ▼
POST /api/ipc/middleware_chat_send
  { input: { sessionKey: "sess_abc", text: "Hello", attachments?: [...] } }
  │
  ▼
chat.service.chatSend()
  │
  ├── 1. Resolve gateway session key
  │     ├── Check in-memory cache (localToGatewayKey map)
  │     ├── If miss → query session_mappings table
  │     ├── If no gateway session yet → create one:
  │     │     ├── middleware.createChatSession({ agentId, label, model })
  │     │     ├── Gateway returns: { sessionKey: "gw_xyz" }
  │     │     └── Persist to session_mappings.session_id
  │     └── Cache the mapping
  │
  ├── 2. Validate attachments (if any)
  │     ├── Max 10 attachments
  │     ├── Max 50 MB per attachment
  │     └── Max 100 MB total
  │
  ├── 3. Open event stream (subscribe to gateway events)
  │     └── middleware.openChatEventStream({ sessionKey: "gw_xyz" })
  │           ├── Subscribe: sessions.subscribe
  │           ├── Subscribe: sessions.messages.subscribe
  │           └── Begin listening for events
  │
  ├── 4. Send message via middleware
  │     └── middleware.sendChatMessage({
  │           sessionKey: "gw_xyz",
  │           text: "Hello",
  │           idempotencyKey: uuid(),
  │           attachments
  │         })
  │         │
  │         ▼
  │     WebSocket RPC frame:
  │     { type: "req", id: uuid, method: "chat.send", params: {...} }
  │         │
  │         ▼
  │     Gateway response:
  │     { type: "res", id, ok: true, payload: { runId, status: "started" } }
  │
  └── 5. Return result to UI
        { accepted: true, sessionKey, runId, status: "started" }
```

### Streaming Events Back to UI

```
Gateway (WebSocket push events)
  │
  ▼
middleware.openChatEventStream() callback
  │
  ├── Parse event type
  ├── Handle subagent tracking (if applicable)
  │
  ▼
chatEvents.emit(`chat:event:${localSessionKey}`, parsedEvent)
  │
  ▼
SSE Handler: GET /api/stream/chat/:sessionKey
  │
  ├── Listens on chatEvents for `chat:event:${sessionKey}`
  ├── Formats as SSE:
  │     event: chat.status
  │     data: {"state":"streaming","message":"..."}
  │
  ▼
UI: EventSource receives SSE events
  └── Updates chat UI in real-time
```

### Event Sequence for a Typical Chat

```
1. chat.ready       ← History loaded, ready state
2. chat.status      ← { state: "connected" }
3. chat.status      ← { state: "thinking" }
4. chat.status      ← { state: "streaming" }
5. chat.message     ← Token-by-token assistant response
   ...repeat...
6. chat.message     ← Final complete message
7. chat.status      ← { state: "done" }
```

### Event Sequence with Tool Use

```
1. chat.ready
2. chat.status      ← { state: "thinking" }
3. chat.tool        ← { phase: "start", toolName: "search", callId: "tc_1" }
4. chat.status      ← { state: "tool_running" }
5. chat.tool        ← { phase: "progress", callId: "tc_1", data: {...} }
6. chat.tool        ← { phase: "result", callId: "tc_1", output: {...} }
7. chat.status      ← { state: "streaming" }
8. chat.message     ← Assistant response using tool output
9. chat.status      ← { state: "done" }
```

### Event Sequence with Subagents

```
1. chat.status      ← { state: "thinking" }
2. chat.tool        ← { phase: "start", toolName: "delegate" }
3. chat.agent       ← { event: "spawn", subSessionKey: ":subagent:sub_1" }
   │
   │  Server auto-subscribes to subagent session
   │
4. chat.tool        ← Synthetic events from subagent activity
5. chat.agent       ← { event: "finish", subSessionKey: ":subagent:sub_1" }
6. chat.tool        ← { phase: "result", output: subagent result }
7. chat.status      ← { state: "done" }
```

### Chat Event Types (Shared Schema)

| Event | Key Fields | Description |
|-------|------------|-------------|
| `chat.ready` | `messages[]`, `thinkingLevel`, `verboseLevel` | Initial state after subscribing |
| `chat.status` | `state`, `message?` | State machine transitions |
| `chat.message` | `role`, `content[]`, `model`, `createdAt` | Message content (streaming or final) |
| `chat.tool` | `phase`, `toolName`, `callId`, `output?` | Tool execution lifecycle |
| `chat.agent` | `event`, `subSessionKey` | Subagent spawn/finish/error |
| `chat.error` | `code`, `message`, `retryable` | Error details |

### Chat Status States

```
connected → thinking → tool_running → streaming → done
                │              │            │
                └──────────────┴────────────┴──→ error
```

---

## 6. Session Lifecycle

### Local Session Creation

```
UI: New conversation
  │
  ▼
POST /api/ipc/middleware_sessions_create
  { projectId, topicId?, label, agentId: "main" }
  │
  ▼
sessions.service.sessionsCreate()
  ├── Generate key: "sess_" + uuid()
  ├── INSERT INTO session_mappings (
  │     session_key, session_id=NULL, project_id,
  │     topic_id, agent_id, label, status="idle",
  │     source="jarvis", created_at, updated_at
  │   )
  └── Return session object

  Note: session_id (gateway key) is NULL at this point.
  It gets populated on first chat.send.
```

### Lazy Gateway Session Binding

```
First message in session
  │
  ▼
ensureGatewaySession("sess_abc")
  ├── Check local cache: localToGatewayKey["sess_abc"]
  ├── If miss → SELECT session_id FROM session_mappings WHERE session_key = "sess_abc"
  ├── If session_id is NULL:
  │     ├── middleware.createChatSession({
  │     │     agentId: "main",
  │     │     label: "New conversation",
  │     │     model: userSelectedModel
  │     │   })
  │     ├── Gateway returns: { sessionKey: "gw_xyz" }
  │     ├── UPDATE session_mappings SET session_id = "gw_xyz" WHERE session_key = "sess_abc"
  │     └── Cache: localToGatewayKey["sess_abc"] = "gw_xyz"
  └── Return "gw_xyz"
```

### Session Deletion

```
POST /api/ipc/middleware_sessions_delete
  { sessionKey: "sess_abc" }
  │
  ▼
sessions.service.sessionsDelete()
  ├── Close any active SSE streams for this session
  ├── Record tombstone (for sync): recordSyncTombstone("session_mapping", "sess_abc")
  ├── DELETE FROM session_mappings WHERE session_key = "sess_abc"
  ├── If gateway session existed:
  │     └── middleware.deleteChatSession("gw_xyz") (includes transcript)
  └── Clear from cache
```

---

## 7. Branching Conversations

```
UI: User clicks "Branch from here" on message msg_123 in session sess_abc
  │
  ▼
POST /api/ipc/middleware_branch_create
  {
    sourceSessionKey: "sess_abc",
    sourceMessageId: "msg_123",
    projectId: "proj_1",
    branchName: "Exploring alternative",
    branchSessionKey: "sess_branch_new"
  }
  │
  ▼
branches.service.branchCreate()  [within db.transaction()]
  │
  ├── 1. Create new topic
  │     INSERT INTO topics (id, project_id, title, sort_order, ...)
  │
  ├── 2. Create new session mapping
  │     INSERT INTO session_mappings (
  │       session_key: "sess_branch_new",
  │       session_id: NULL,
  │       topic_id: newTopicId,
  │       project_id: "proj_1",
  │       source: "jarvis"
  │     )
  │
  ├── 3. Record branch metadata
  │     INSERT INTO branches (
  │       id, source_session_key: "sess_abc",
  │       source_message_id: "msg_123",
  │       branch_session_key: "sess_branch_new",
  │       topic_id: newTopicId,
  │       reason: "branch"
  │     )
  │
  └── Return { branch, topicId, sessionKey: "sess_branch_new" }

Variants:
  - branch_from_regenerate: Branch + auto-resend last user message
  - branch_from_edit: Branch + send edited version of user message
  - branch_create_thread: Create thread from branch point
```

---

## 8. Database Layer

### SQLite Configuration

- **Path**: `~/.jarvis/openclaw-desktop/jarvis.db`
- **Mode**: WAL (Write-Ahead Logging) for better concurrency
- **Driver**: better-sqlite3 (synchronous)
- **Connection**: Singleton via `getDb()`

### Schema (14 tables)

```sql
profiles
  ├── id (TEXT PK)           -- "prof_" + uuid
  ├── name (TEXT)
  ├── gateway_url (TEXT)
  ├── workspace_root (TEXT)
  ├── is_default (INT)
  ├── sync_dirty (INT)
  └── created_at, updated_at (TEXT ISO 8601)

projects
  ├── id (TEXT PK)           -- "proj_" + uuid
  ├── profile_id (TEXT FK)
  ├── name (TEXT)
  ├── path (TEXT)            -- workspace directory
  ├── pinned (INT)
  ├── archived (INT)
  ├── sort_order (INT)
  ├── sync_dirty (INT)
  └── created_at, updated_at

topics
  ├── id (TEXT PK)           -- "topic_" + uuid
  ├── project_id (TEXT FK)
  ├── title (TEXT)
  ├── sort_order (INT)
  ├── sync_dirty (INT)
  └── created_at, updated_at

session_mappings
  ├── session_key (TEXT PK)  -- "sess_" + uuid (local)
  ├── session_id (TEXT)      -- gateway session key (nullable, set on first use)
  ├── project_id (TEXT FK)
  ├── topic_id (TEXT FK)
  ├── agent_id (TEXT)
  ├── label (TEXT)
  ├── status (TEXT)          -- idle, sending, streaming, done, error
  ├── pinned (INT)
  ├── hidden (INT)
  ├── source (TEXT)          -- "jarvis" or "openclaw-existing"
  ├── sync_dirty (INT)
  └── created_at, updated_at

branches
  ├── id (TEXT PK)
  ├── source_session_key (TEXT FK)
  ├── source_message_id (TEXT)
  ├── branch_session_key (TEXT FK)
  ├── topic_id (TEXT FK)
  ├── reason (TEXT)          -- "branch", "regenerate", "edit"
  └── created_at

terminal_sessions
  ├── id (TEXT PK)
  ├── project_id (TEXT FK)
  ├── title (TEXT)
  ├── cwd (TEXT)
  ├── runtime_id (TEXT)      -- links to in-memory PTY handle
  └── created_at

app_settings
  ├── key (TEXT PK)          -- e.g., "profile_token.prof_abc"
  └── value (TEXT)

chats
  ├── id (TEXT PK)           -- "chat_" + uuid
  ├── session_key (TEXT)
  ├── name (TEXT)
  ├── project_id (TEXT FK)
  ├── sync_dirty (INT)
  └── created_at, updated_at

topic_git_context
  ├── topic_id (TEXT PK FK)
  ├── branch_name (TEXT)
  └── updated_at

sync_tombstones
  ├── entity_type (TEXT)
  ├── entity_id (TEXT)
  └── deleted_at

sync_outbox
  ├── id (INTEGER PK AUTOINCREMENT)
  ├── entity_type (TEXT)
  ├── entity_id (TEXT)
  ├── op (TEXT)              -- "upsert", "delete"
  ├── enqueued_at (TEXT)
  ├── attempts (INT)
  └── next_attempt_at (TEXT)

recent_repos
  ├── path (TEXT PK)
  ├── name (TEXT)
  └── last_used_at

chat_errors
  ├── id (TEXT PK)
  ├── session_key (TEXT)
  ├── error_code (TEXT)
  ├── error_message (TEXT)
  └── created_at
```

### Helper Utilities

| Function | Purpose |
|----------|---------|
| `nowIso()` | Current time as ISO 8601 string |
| `generateId(prefix)` | `prefix_` + UUID (e.g., `sess_a1b2c3...`) |
| `profileRowToJson()` | Map DB row to API shape |
| `projectRowToJson()` | Map DB row to API shape |
| `sessionRowToJson()` | Map DB row to API shape |
| `recordSyncTombstone()` | Mark entity deleted for sync |
| `parseJsonColumn()` | Safe JSON.parse for SQLite text columns |

---

## 9. Server-Sent Events (SSE) Streaming

### Architecture

```
┌──────────────────────┐      EventEmitter      ┌──────────────────┐
│  Service Layer       │ ──────────────────────► │  SSE Handler     │
│  (chat, terminal,    │   chatEvents.emit()     │  (Express route) │
│   cron services)     │   terminalEvents.emit() │                  │
└──────────────────────┘                         └────────┬─────────┘
                                                          │
                                                   SSE Protocol
                                                          │
                                                          ▼
                                                 ┌──────────────────┐
                                                 │  UI (EventSource)│
                                                 └──────────────────┘
```

### Chat SSE

```
GET /api/stream/chat/:sessionKey

Headers:
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive

Events emitted:
  event: chat.ready
  data: {"messages":[...],"thinkingLevel":1}

  event: chat.status
  data: {"state":"streaming"}

  event: chat.message
  data: {"role":"assistant","content":[{"type":"text","text":"Hello..."}]}

  event: chat.tool
  data: {"phase":"start","toolName":"search","callId":"tc_1"}

  event: chat.error
  data: {"code":"rate_limit","message":"...","retryable":true}

Behavior:
  - On connect: replays last status if session is active
  - On disconnect: removes listener, cleans up
```

### Terminal SSE

```
GET /api/stream/terminal/:sessionId

Events emitted:
  event: output
  data: {"data":"$ ls\nfile1.txt  file2.txt\n"}

  event: exit
  data: {"code":0}
```

### Cron SSE

```
GET /api/stream/cron

Events emitted:
  event: cron:event
  data: {"jobId":"...","status":"running","runId":"..."}
```

---

## 10. Terminal / PTY System

### Terminal Session Flow

```
UI: Open terminal
  │
  ▼
POST /api/ipc/middleware_terminal_create
  { projectId: "proj_1", cwd: "/path/to/project", title: "Shell" }
  │
  ▼
terminal.service.terminalCreate()
  ├── Validate: activeTerminals.size < 20 (MAX_SESSIONS)
  ├── Validate: cwd exists and is directory
  ├── Load node-pty dynamically
  ├── Spawn: pty.spawn(shell, [], { cwd, cols: 80, rows: 24 })
  ├── Generate sessionId and runtimeId
  ├── INSERT INTO terminal_sessions
  ├── Store TerminalHandle in activeTerminals map
  ├── Wire up output listener:
  │     pty.onData(data => terminalEvents.emit(`terminal:output:${sessionId}`, data))
  ├── Wire up exit listener:
  │     pty.onExit(code => terminalEvents.emit(`terminal:exit:${sessionId}`, code))
  └── Return { sessionId, cols, rows }

UI: Start listening
  └── GET /api/stream/terminal/:sessionId (SSE)

UI: User types
  └── POST /api/ipc/middleware_terminal_write
        { sessionId, data: "ls -la\n" }
        → pty.write(data) → shell stdin

Shell output
  → PTY stdout → terminalEvents → SSE → UI renders

UI: Resize
  └── POST /api/ipc/middleware_terminal_resize
        { sessionId, cols: 120, rows: 40 }
        → pty.resize(cols, rows)

UI: Close
  └── POST /api/ipc/middleware_terminal_close
        { sessionId }
        → pty.kill() → cleanup
```

### Ephemeral PTY (for one-off commands)

```
POST /api/ipc/middleware_pty_spawn
  { command: "git", args: ["log", "--oneline"], cwd: "/project" }
  │
  ▼
pty.service.ptySpawn()
  ├── Spawn process
  ├── Generate ptyId
  └── Return { ptyId }

GET /api/stream/pty/:ptyId  (SSE for output)
```

---

## 11. Cron Scheduling

### Cron Job Lifecycle

```
UI: Create scheduled job
  │
  ▼
POST /api/ipc/middleware_cron_create_job
  {
    name: "Daily summary",
    schedule: "0 9 * * *",       -- or "every 2h", "at 15:00"
    taskType: "chat",
    message: "Summarize today's changes",
    agentId: "main"
  }
  │
  ▼
cron.service.cronCreateJob()
  └── Gateway RPC: cron.createJob(params)
      └── Returns { jobId }
```

### Cron Event Flow

```
Gateway: Job fires at scheduled time
  │
  ├── Gateway event: cron.run.started
  │     └── cron-events.service receives via WebSocket
  │           └── cronEvents.emit("cron:event", { jobId, runId, status: "running" })
  │                 └── SSE: GET /api/stream/cron
  │
  ├── Gateway event: cron.run.completed
  │     └── Same flow → SSE broadcasts completion
  │
  └── UI updates cron dashboard in real-time
```

### Cron Commands

| Command | Purpose |
|---------|---------|
| `middleware_cron_list_jobs` | List all jobs |
| `middleware_cron_create_job` | Create new job |
| `middleware_cron_update_job` | Modify schedule/task |
| `middleware_cron_delete_job` | Remove job |
| `middleware_cron_run_job` | Manually trigger |
| `middleware_cron_stop_run` | Abort running job |
| `middleware_cron_list_runs` | Run history |
| `middleware_cron_get_run` | Single run details |
| `middleware_cron_poll_run_completion` | Wait for completion (timeout-based) |

---

## 12. Sync Engine

### Purpose

Bidirectional sync between local SQLite database and OpenClaw cloud storage.

### Architecture

```
Local SQLite                    Sync Engine                    Cloud
  │                                │                             │
  ├── sync_dirty = 1 ────────────►│                             │
  │   (entity modified)           │                             │
  │                               ├── buildPayload() ─────────►│
  │                               │   (JSON state)              │
  │                               │                             │
  │                               │◄───── pull changes ────────┤
  │◄── merge into tables ────────┤   (since last anchor)       │
  │                               │                             │
  │                               ├── recordTombstone() ───────►│
  │   (entity deleted)            │   (deletion marker)         │
```

### Timing

| Operation | Interval |
|-----------|----------|
| Push tick | Every 2 seconds |
| Pull tick | Every 30 seconds |
| Backfill | On first connect (full load from cloud) |

### Push Flow (every 2s)

```
1. Query tables where sync_dirty = 1
2. For each dirty entity:
   ├── Build payload:
   │   ├── buildProjectPayload(project)
   │   ├── buildTopicPayload(topic)
   │   └── buildChatPayload(chat)
   ├── Enqueue to sync_outbox:
   │   { entity_type, entity_id, op: "upsert", attempts: 0 }
   └── Clear sync_dirty flag
3. Claim due outbox tasks (next_attempt_at <= now)
4. For each task:
   ├── Send to gateway via RPC
   ├── On success: markDone() → DELETE from outbox
   └── On failure: markFailed() → increment attempts, set next_attempt_at
```

### Pull Flow (every 30s)

```
1. Request changes from cloud since last anchor
2. For each change:
   ├── If entity exists locally → merge (cloud wins on conflict)
   ├── If entity is new → insert
   └── If entity deleted → record tombstone, delete local
3. Update sync anchor to latest timestamp
```

---

## 13. Models & Auth

### Models Service

```
POST /api/ipc/middleware_models_list
  │
  ▼
models.service.modelsList()
  └── Gateway RPC: models.list()
      └── Returns: [
            { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", ... },
            { id: "gpt-4o", name: "GPT-4o", provider: "openai", ... },
            ...
          ]

POST /api/ipc/middleware_models_auth_status
  │
  ▼
models.service.modelsAuthStatus()
  └── Gateway RPC: models.authStatus()
      └── Returns: { authenticated: boolean, providers: [...], usage: {...} }

POST /api/ipc/middleware_models_set_default
  { modelId: "claude-sonnet-4-6" }
  │
  ▼
models.service.modelsSetDefault()
  └── Update ~/.openclaw/openclaw.json:
      agents.defaults.model.primary = "claude-sonnet-4-6"
```

### Token Management

```
Tokens are stored encrypted in app_settings table:
  key: "profile_token.{profileId}"
  value: encrypted token string

auth/secrets.ts:
  setProfileToken(profileId, token)  → INSERT/UPDATE app_settings
  getProfileToken(profileId)         → SELECT from app_settings
  deleteProfileToken(profileId)      → DELETE from app_settings
```

---

## 14. Error Handling & Resilience

### Gateway Connection Errors

| Error Code | Meaning | Recovery |
|------------|---------|----------|
| `gateway_not_running` | Cannot reach gateway | Auto-reconnect with backoff |
| `token_missing` | No auth token configured | Prompt user in onboarding |
| `token_invalid` | Token rejected by gateway | Re-authenticate |
| `identity_mismatch` | Device key doesn't match | Re-register device |
| `origin_not_allowed` | CORS/origin rejection | Check gateway config |
| `protocol_mismatch` | Version incompatibility | Update client |

### Graceful Degradation

```
Server startup:
  ├── Try connect to gateway
  ├── If fails → log warning, continue startup
  ├── Server runs with local-only features
  │   (profiles, projects, topics, files, terminal)
  └── Gateway features disabled until reconnect
      (chat, models, cron, sync, skills)
```

### Attachment Validation

```
chatSend() validates before sending:
  ├── attachments.length <= 10          → "Too many attachments (max 10)"
  ├── each attachment.size <= 50MB      → "Attachment too large (max 50MB)"
  └── total size <= 100MB              → "Total attachments too large (max 100MB)"
```

### PTY Constraints

```
terminalCreate() validates:
  ├── activeTerminals.size < 20         → "Too many terminal sessions"
  ├── cwd exists                        → "Working directory not found"
  ├── cwd is directory                  → "Path is not a directory"
  └── node-pty available                → "Terminal not available"
```

### Cron Timeouts

```
Default request timeout: 15 seconds
Poll completion timeout: configurable (default 120s)
Stale run cleanup: runs > 2 hours old pruned from tracking
```

### Database Transactions

```
Used for multi-table operations:
  ├── Branch creation (topic + session + branch record)
  ├── Profile deletion (profile + tokens + sessions)
  └── Sync operations (multiple entity types)

Pattern: db.transaction(() => { ... })()
Automatic rollback on thrown error.
```

---

## 15. File Reference

| File | Purpose |
|------|---------|
| `packages/middleware/src/index.ts` | WebSocket client, auth, chat streaming, session management |
| `packages/server/src/index.ts` | Express server setup, routes, startup sequence |
| `packages/server/src/dispatch/registry.ts` | 265 command → handler mappings |
| `packages/server/src/dispatch/handler.ts` | HTTP POST handler for `/api/ipc/:command` |
| `packages/server/src/db/connection.ts` | SQLite connection singleton (WAL mode) |
| `packages/server/src/db/schema.ts` | 14 table definitions |
| `packages/server/src/db/helpers.ts` | ID generation, timestamps, row mappers |
| `packages/server/src/gateway/client.ts` | Gateway connection singleton, reconnection logic |
| `packages/server/src/services/chat.service.ts` | Chat send, history, session resolution, event emission |
| `packages/server/src/services/sessions.service.ts` | Local session CRUD |
| `packages/server/src/services/profiles.service.ts` | Profile CRUD, token management |
| `packages/server/src/services/projects.service.ts` | Project CRUD, git status |
| `packages/server/src/services/topics.service.ts` | Topic/thread management |
| `packages/server/src/services/branches.service.ts` | Conversation branching |
| `packages/server/src/services/terminal.service.ts` | PTY session management |
| `packages/server/src/services/pty.service.ts` | Ephemeral PTY sessions |
| `packages/server/src/services/cron.service.ts` | Cron job CRUD, execution |
| `packages/server/src/services/cron-events.service.ts` | Cron event listener |
| `packages/server/src/services/models.service.ts` | Model listing, default selection |
| `packages/server/src/services/skills.service.ts` | Skill discovery, install |
| `packages/server/src/services/memory.service.ts` | Vector search, semantic recall |
| `packages/server/src/services/sync.service.ts` | Sync status, push/pull triggers |
| `packages/server/src/services/runtime.service.ts` | Runtime info, admin approval |
| `packages/server/src/services/connect.service.ts` | Gateway diagnostics |
| `packages/server/src/services/onboarding.service.ts` | First-run setup |
| `packages/server/src/services/usage.service.ts` | Token/cost accounting |
| `packages/server/src/auth/secrets.ts` | Encrypted token storage |
| `packages/server/src/sse/chat.ts` | Chat SSE stream handler |
| `packages/server/src/sse/terminal.ts` | Terminal SSE stream handler |
| `packages/server/src/sse/pty.ts` | PTY SSE stream handler |
| `packages/server/src/sse/cron.ts` | Cron SSE stream handler |
| `packages/server/src/sync/engine.ts` | Sync engine (push/pull orchestration) |
| `packages/server/src/sync/outbox.ts` | Sync outbox queue |
| `packages/server/src/sync/encoding.ts` | Entity serialization for cloud |
| `packages/shared/src/api/chat.ts` | Chat Zod schemas |
| `packages/shared/src/api/sessions.ts` | Session Zod schemas |
| `packages/desktop/src-tauri/src/lib.rs` | Tauri entry point, plugin setup |
| `packages/desktop/src-tauri/src/backend.rs` | Backend process management |
