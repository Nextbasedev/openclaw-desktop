# Backend & Middleware — How It Actually Works

Only the server (`packages/server/`) and middleware (`packages/middleware/`) — no frontend, no Tauri.

---

## Two Pieces, One Job

```
┌──────────────────────────────────────────────┐
│  SERVER  (Express.js, port 3001)             │
│  The brain. Stores data, runs services,      │
│  manages sessions, streams events.           │
│  33 service files, 266 commands, SQLite DB.  │
├──────────────────────────────────────────────┤
│  MIDDLEWARE  (WebSocket client library)       │
│  The phone line. Connects to the cloud,      │
│  authenticates, sends/receives messages.      │
│  One file: index.ts (969 lines).             │
├──────────────────────────────────────────────┤
│  OPENCLAW GATEWAY  (Remote, port 18789)      │
│  The cloud. AI agents, models, cron, sync.   │
└──────────────────────────────────────────────┘
```

The middleware is NOT a standalone server. It's a library that the server imports and calls. The server is what actually runs.

---

## How the Server Starts

File: `packages/server/src/index.ts` (57 lines)

```
Server boots up on 127.0.0.1:3001
  │
  ├── 1. Express app created
  │     - JSON body limit: 150MB
  │     - CORS: allow all origins
  │
  ├── 2. Routes registered:
  │     POST /api/ipc/:command          → command dispatcher
  │     GET  /api/stream/chat/:key      → chat SSE stream
  │     GET  /api/stream/terminal/:id   → terminal SSE stream
  │     GET  /api/stream/pty/:id        → PTY SSE stream
  │     GET  /api/stream/cron           → cron SSE stream
  │     GET  /health                    → { ok: true, timestamp }
  │
  ├── 3. Start listening, then:
  │     a. startSyncEngine()            → background sync every 2s/30s
  │     b. connectGateway()             → connect to OpenClaw via middleware
  │        └── if fails: log warning, continue (server works without gateway)
  │     c. startCronEventListener()     → listen for cron job events
  │
  └── Server is ready
```

---

## How a Command Gets Executed

Every request from the outside hits ONE endpoint: `POST /api/ipc/:command`

File: `packages/server/src/dispatch/handler.ts` (21 lines)

```
POST /api/ipc/middleware_chat_send
Body: { input: { sessionKey: "sess_abc", text: "Hello" } }
  │
  ▼
handler.ts
  ├── Extract command name from URL: "middleware_chat_send"
  ├── Look it up in registry.ts (a big object mapping names → functions)
  ├── Extract input from body (body.input if present, otherwise body itself)
  ├── Call the handler function: chatSend(input)
  ├── Return the result as JSON
  └── If error: return { error: "message" } with status 500
```

File: `packages/server/src/dispatch/registry.ts` (263 lines)

This is just a giant lookup table. Every command name maps to a function:

```typescript
const commandRegistry = {
  // Runtime
  middleware_runtime_info:               runtimeInfo,
  middleware_openclaw_bot_name:          botName,

  // Chat (gateway-dependent)
  middleware_chat_create_session:        chatCreateSession,
  middleware_chat_send:                  chatSend,
  middleware_chat_stop:                  chatStop,
  middleware_chat_history:               chatHistory,
  middleware_chat_edit_and_resend:       chatEditAndResend,
  middleware_chat_regenerate:            chatRegenerate,

  // Sessions (local DB)
  middleware_sessions_list:              sessionsList,
  middleware_sessions_create:            sessionsCreate,
  middleware_sessions_update:            sessionsUpdate,
  middleware_sessions_delete:            sessionsDelete,

  // ... 250+ more entries
}
```

Adding a new command = adding one line here + writing the function.

---

## The Database

File: `packages/server/src/db/connection.ts` (38 lines)

- **SQLite** at `~/.jarvis/openclaw-desktop/jarvis.db`
- **WAL mode** (better for concurrent reads/writes)
- **Singleton**: `getDb()` returns the same connection every time

File: `packages/server/src/db/schema.ts` (206 lines)

Creates 13 tables + 2 extra tables via migrations. Key tables:

| Table | What it stores |
|-------|---------------|
| `profiles` | Connections to OpenClaw instances (name, gateway URL, workspace root) |
| `projects` | Workspaces — each has a name, path, profile link |
| `topics` | Conversation threads within projects |
| `session_mappings` | Maps local session keys (sess_xxx) → gateway session keys |
| `chats` | Standalone conversations (name, linked session) |
| `branches` | Fork points in conversations (source session + message ID) |
| `app_settings` | Key-value store (tokens, bot name, preferences) |
| `terminal_sessions` | Active shell sessions (project, cwd, runtime ID) |
| `sync_outbox` | Queue of changes waiting to be pushed to cloud |
| `sync_tombstones` | Deletion records so other devices know what was removed |
| `anchor_sessions` | Sync position tracking (last processed timestamp) |
| `recent_repos` | Recently used git repositories |
| `chat_errors` | Persisted chat errors for debugging |
| `topic_git_context` | Which git branch is associated with which topic |
| `project_local_overrides` | Per-project local settings |

File: `packages/server/src/db/helpers.ts` (239 lines)

Utility functions:
- `generateId("sess")` → `"sess_a1b2c3d4-..."` (prefix + UUID)
- `nowIso()` → `"2026-04-28T12:00:00.000Z"`
- Row-to-JSON mappers: `profileRowToJson()`, `projectRowToJson()`, `sessionRowToJson()`, etc.
- `getAppSetting(key)` / `setAppSetting(key, value)` — reads/writes app_settings table
- `recordSyncTombstone(type, id)` — marks entity as deleted for sync

---

## The Gateway Client (Server ↔ Cloud Connection)

File: `packages/server/src/gateway/client.ts` (136 lines)

This is the server's connection manager for the remote gateway. It wraps the middleware library.

```
connectGateway()
  │
  ├── Calls middleware's connectToOpenClawGateway() with:
  │     scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"]
  │     client: { id: "openclaw-control-ui", displayName: "Jarvis Middleware", ... }
  │
  ├── If success:
  │     - Store as singleton
  │     - Reset reconnect delay to 3s
  │     - Attach close/error listeners for auto-reconnect
  │     - Emit "connected" event
  │
  └── If fails:
        - Schedule reconnect with exponential backoff
        - 3s → 6s → 12s → 24s → 30s (cap)
        - Emit "error" event
```

Other functions:
- `getGatewayClient()` — returns the connection or throws "Gateway not connected"
- `ensureGatewayClient()` — connects if needed, then returns
- `isGatewayConnected()` — boolean check
- `disconnectGateway()` — close connection + stop reconnect timer

---

## How the Middleware Works

File: `packages/middleware/src/index.ts` (969 lines)

This is the ONLY file in the middleware package. It does three things:
1. **Authenticate** with the gateway (ED25519 challenge-response)
2. **Make RPC calls** (request-response over WebSocket)
3. **Stream events** (real-time chat/tool/agent events)

### Authentication Flow

```
connectToOpenClawGateway(options)
  │
  ├── 1. Read config files
  │     ~/.openclaw/openclaw.json           → gateway URL + port
  │     ~/.openclaw/state/identity/device.json → ED25519 keys + device ID
  │
  ├── 2. Open WebSocket
  │     ws://127.0.0.1:{port}   (default 18789)
  │     Wait up to 10s for connection
  │
  ├── 3. Gateway sends challenge
  │     ← { type: "event", event: "connect.challenge", payload: { nonce: "random123" } }
  │
  ├── 4. Build auth payload (pipe-delimited string)
  │     "v3|{deviceId}|{clientId}|webchat|operator|operator.read,operator.write,...|{timestampMs}|{token}|{nonce}|desktop|desktop"
  │
  ├── 5. Sign payload with ED25519 private key
  │     signature = crypto.sign(null, payloadBuffer, privateKeyPEM)
  │
  ├── 6. Send connect request
  │     → { type: "req", id: uuid, method: "connect", params: {
  │           minProtocol: 3, maxProtocol: 3,
  │           client: { id, displayName, version, platform, mode },
  │           auth: { token },
  │           device: { id, publicKey (base64url), signature (base64url), signedAt, nonce }
  │         }}
  │
  ├── 7. Gateway validates and responds
  │     ← { type: "res", id, ok: true, payload: { server: {...}, connId, methods: [...] } }
  │
  └── 8. Return client object with:
        - request(method, params, timeout)  → send RPC, wait for response
        - addMessageListener(fn)            → listen for all incoming messages
        - close()                           → close WebSocket
        - socket                            → raw WebSocket reference
```

### RPC Calls (Request-Response)

The middleware sends WebSocket messages and waits for matching responses:

```
client.request("sessions.create", { agentId: "main", label: "My chat" })
  │
  ├── Generate unique ID: uuid
  ├── Send: { type: "req", id: uuid, method: "sessions.create", params: {...} }
  ├── Wait for response with matching ID (or timeout)
  ├── Receive: { type: "res", id: uuid, ok: true, payload: { sessionKey: "gw_xyz" } }
  └── Return payload: { sessionKey: "gw_xyz" }
```

### Functions the Middleware Exports

**Session management:**
- `createChatSession({ agentId, label, model, verboseLevel })` → creates session on gateway, returns `{ sessionKey }`
- `listGatewaySessions({ limit? })` → lists all sessions, returns `{ sessions[] }`
- `upsertGatewaySession({ key, label, agentId? })` → create-or-update, returns `{ sessionKey, created }`
- `deleteChatSession(sessionKey)` → deletes session + transcript
- `resetChatSession(sessionKey)` → clears session history

**Chat operations:**
- `getChatHistory(sessionKey)` → returns `{ messages[], thinkingLevel, verboseLevel }`
- `sendChatMessage({ sessionKey, text, timeoutMs?, attachments? })` → sends message, returns `{ accepted, runId, status }`

**Event streaming:**
- `openChatEventStream({ sessionKey, onEvent })` → subscribes to live events, calls onEvent for each one

**Utilities:**
- `contentBlocksToText(content)` → extracts plain text from content blocks
- `extractToolCallBlocks(content)` → pulls out tool_use/toolCall blocks
- `toolOutputVisibility(verboseLevel)` → returns "hidden" | "metadata-only" | "full"

---

## The Chat Flow (Server + Middleware Together)

This is the core workflow — sending a message and getting a streamed response.

### Step 1: Server receives command

```
POST /api/ipc/middleware_chat_send
Body: { input: { sessionKey: "sess_abc", text: "Hello" } }
  → registry.ts maps to chatSend()
```

### Step 2: Server resolves session (`chat.service.ts`)

The server uses LOCAL session keys (like `sess_abc`). The gateway uses DIFFERENT keys. The server maps between them:

```
chatSend(input)
  │
  ├── Look up gateway key for "sess_abc"
  │     1. Check in-memory cache: localToGatewayKey map
  │     2. If miss → query DB: SELECT session_id FROM session_mappings WHERE session_key = "sess_abc"
  │     3. If session_id is NULL (first message ever):
  │           ├── Call middleware: createChatSession({ agentId, label, model })
  │           ├── Gateway returns: { sessionKey: "gw_xyz" }
  │           ├── Save to DB: UPDATE session_mappings SET session_id = "gw_xyz"
  │           └── Cache it: localToGatewayKey["sess_abc"] = "gw_xyz"
  │
  ├── Now we have gateway key: "gw_xyz"
```

### Step 3: Validate attachments

```
  ├── If attachments provided:
  │     ├── Max 10 files
  │     ├── Each ≤ 50 MB
  │     └── Total ≤ 100 MB
  │     (throws error if violated)
```

### Step 4: Open event stream

```
  ├── Call middleware: openChatEventStream({ sessionKey: "gw_xyz", onEvent })
  │     │
  │     ├── Middleware fetches history from gateway
  │     ├── Middleware subscribes to session events on gateway
  │     ├── Middleware starts listening for WebSocket push messages
  │     │
  │     └── onEvent callback fires for each event:
  │           ├── Server receives the event
  │           ├── Maps gateway key back to local key
  │           └── Emits to internal EventEmitter: chatEvents.emit("chat:event:sess_abc", event)
```

### Step 5: Send the message

```
  ├── Call middleware: sendChatMessage({ sessionKey: "gw_xyz", text: "Hello", idempotencyKey: uuid })
  │     │
  │     ├── Middleware sends WebSocket RPC:
  │     │     { type: "req", method: "chat.send", params: { sessionKey, text, idempotencyKey } }
  │     │
  │     ├── Gateway starts AI processing
  │     │
  │     └── Returns: { accepted: true, runId: "run_123", status: "started" }
  │
  └── Return result to caller
```

### Step 6: Events stream back

```
Gateway pushes events over WebSocket → Middleware receives them → Server emits them

Timeline:
  ← chat.status  { state: "thinking" }          AI is processing
  ← chat.status  { state: "streaming" }         AI starts typing
  ← chat.message { role: "assistant", content: [{ type: "text", text: "Hi" }] }
  ← chat.message { role: "assistant", content: [{ type: "text", text: "Hi there!" }] }
  ← chat.status  { state: "done" }              Finished

If AI uses a tool:
  ← chat.tool    { phase: "start", toolName: "file_search", callId: "tc_1" }
  ← chat.status  { state: "tool_running" }
  ← chat.tool    { phase: "progress", callId: "tc_1", data: {...} }
  ← chat.tool    { phase: "result", callId: "tc_1", output: {...} }
  ← chat.status  { state: "streaming" }         Back to typing after tool

If AI spawns a subagent:
  ← chat.agent   { event: "spawn", subSessionKey: ":subagent:sub_1" }
     → Middleware auto-subscribes to the subagent's session
     → Synthetic chat.tool events emitted for subagent activity
  ← chat.agent   { event: "finish", subSessionKey: ":subagent:sub_1" }
```

### Step 7: SSE delivers events to the outside

File: `packages/server/src/sse/chat.ts` (42 lines)

```
GET /api/stream/chat/sess_abc
  │
  ├── Set headers: Content-Type: text/event-stream, Cache-Control: no-cache
  │
  ├── Check if session is already active (thinking/streaming/tool_running)
  │     → If yes: replay last status event immediately so caller catches up
  │
  ├── Listen on chatEvents for "chat:event:sess_abc"
  │     → For each event: write to HTTP stream as SSE:
  │        event: chat.status
  │        data: {"state":"streaming"}
  │
  └── On client disconnect: remove listener, clean up
```

---

## Session Management

File: `packages/server/src/services/sessions.service.ts` (107 lines)

Sessions are the bridge between the local DB and the gateway.

```
sessionsCreate({ projectId, topicId, label, agentId })
  ├── Generate key: "sess_" + uuid
  ├── INSERT INTO session_mappings (session_key, session_id=NULL, project_id, topic_id, ...)
  └── Return session object
  
  session_id stays NULL until first message (lazy binding pattern).
```

```
sessionsList({ projectId?, topicId? })
  └── SELECT from session_mappings WHERE source="jarvis" (optionally filtered)
```

```
sessionsUpdate(sessionKey, { label?, pinned?, hidden?, topicId? })
  ├── UPDATE session_mappings
  └── Set sync_dirty = 1 (so sync engine picks it up)
```

```
sessionsDelete(sessionKey)
  ├── recordSyncTombstone("session_mapping", sessionKey)
  └── DELETE FROM session_mappings WHERE session_key = ?
```

---

## Branching Conversations

File: `packages/server/src/services/branches.service.ts` (190 lines)

Fork a conversation at any message to explore a different direction:

```
branchCreate({ sourceSessionKey, sourceMessageId, projectId, label })
  │
  ├── Inside db.transaction():
  │     ├── Create new topic
  │     ├── Create new session mapping (session_id=NULL)
  │     ├── INSERT INTO branches (source_session_key, source_message_id, branch_session_key, reason: "branch")
  │     └── Kick sync engine
  │
  └── Return { branch, topicId, sessionKey }

branchFromEdit({ sourceSessionKey, sourceMessageId, text })
  └── Same as above but also sends the edited message via chatEditAndResend

branchFromRegenerate({ sourceSessionKey, sourceMessageId })
  └── Same as above but re-sends the last user message via chatRegenerate
```

---

## Profiles & Connection

File: `packages/server/src/services/profiles.service.ts` (168 lines)

Profiles represent connections to OpenClaw instances:

```
profilesCreate({ name, gatewayUrl, workspaceRoot })
  └── INSERT INTO profiles, mark as default if first one

profileTokenSet({ profileId, token })
  └── setAppSetting("profile_token.{profileId}", token)

environmentConnect({ profileId })
  └── Validate gateway URL is reachable, return capabilities
```

File: `packages/server/src/services/connect.service.ts` (459 lines)

Connection management and diagnostics:

```
connectStatus()
  ├── Check if gateway config exists
  ├── Check if identity exists
  ├── Check if gateway is connected
  └── Return { configured, connected, gatewayUrl, ... }

connectBootstrap()
  ├── Read config + identity
  ├── Connect via middleware if not connected
  └── Pull sync data

connectTest({ url })
  ├── Try connecting to the given URL
  ├── Classify any errors:
  │     gateway_not_running, token_invalid, identity_mismatch,
  │     origin_not_allowed, protocol_mismatch, etc.
  └── Return { ok, error?, classification? }
```

---

## Cron System

File: `packages/server/src/services/cron.service.ts` (806 lines — the largest service)

All cron operations go through the gateway:

```
cronCreateJob({ name, schedule, message, agentId, ... })
  └── Gateway RPC: cron.create → returns { jobId }

cronListJobs()
  └── Gateway RPC: cron.list → returns jobs array
      Each job is normalized with local overrides (paused state, custom names)

cronRunJob({ jobId })
  └── Gateway RPC: cron.run → returns { runId }

cronPauseJob({ jobId, paused })
  └── Store pause state in project_local_overrides table (local only, not on gateway)

cronPollRunCompletion({ runId, timeoutMs })
  └── Poll gateway every few seconds until run finishes or timeout
```

File: `packages/server/src/services/cron-events.service.ts` (120 lines)

Listens for cron events from the gateway and re-emits them locally:

```
startCronEventListener()
  ├── Get gateway client
  ├── Listen for all incoming WebSocket messages
  ├── Filter for cron-related events
  └── Emit to cronEvents EventEmitter → picked up by SSE handler
```

---

## Sync Engine

How local data syncs to the cloud. Uses gateway sessions as a transport mechanism — sync payloads are encoded into session labels.

### Files

| File | Purpose |
|------|---------|
| `sync/engine.ts` (340 lines) | Main loop: push every 2s, pull every 30s |
| `sync/outbox.ts` (66 lines) | Queue of pending push operations |
| `sync/encoding.ts` (59 lines) | Encode/decode payloads into session labels |
| `sync/pull.ts` (359 lines) | Pull changes from gateway, merge into local DB |
| `sync/anchor.ts` (40 lines) | Track sync position per entity |
| `sync/backfill.ts` (66 lines) | Initial full sync on first connect |

### Push Flow (every 2 seconds)

```
engine.ts push tick
  │
  ├── 1. Find dirty rows (sync_dirty = 1) in projects, topics, chats
  │
  ├── 2. For each dirty entity:
  │     ├── Build payload: { type: "project", id, name, path, ... }
  │     ├── Encode into session label: "\x00JRV1\x00" + JSON
  │     ├── Upsert gateway session with encoded label
  │     ├── Remember anchor (session key for this entity)
  │     └── Clear sync_dirty flag
  │
  ├── 3. Process outbox queue (retries for previously failed pushes)
  │     ├── claimDueTasks() → get tasks where next_attempt_at <= now
  │     ├── For each: try to push
  │     ├── If success: markDone() → delete from outbox
  │     └── If fail: markFailed() → exponential backoff (1s → 2s → 4s → ... → 60s cap)
  │
  └── 4. Handle deletions
        ├── Check sync_tombstones
        └── Delete corresponding gateway sessions
```

### Pull Flow (every 30 seconds)

```
pull.ts pullOnce()
  │
  ├── 1. Fetch all gateway sessions
  │
  ├── 2. For each session with encoded label (starts with \x00JRV1\x00):
  │     ├── Decode the payload
  │     ├── Determine entity type (project, topic, chat)
  │     │
  │     ├── If entity exists locally:
  │     │     └── Update if gateway version is newer (compare updated_at)
  │     │
  │     ├── If entity is new:
  │     │     └── Insert into local DB
  │     │
  │     └── Remember anchor for this entity
  │
  ├── 3. Import bare sessions (non-encoded, created outside this device)
  │
  └── 4. Ensure default project exists (create "Default" if none)
```

### Backfill (on first connect)

```
backfill.ts runBackfillIfNeeded()
  ├── Check flag: already backfilled?
  ├── If no: enqueue all local dirty rows to outbox
  └── Set flag so it doesn't run again
```

---

## Terminal & PTY

### Persistent Terminals (`terminal.service.ts`, 220 lines)

```
terminalCreate({ projectId, cwd, title })
  ├── Check: < 20 active terminals
  ├── Validate: cwd exists and is a directory
  ├── Load node-pty dynamically
  ├── Spawn shell: pty.spawn(shell, [], { cwd, cols: 80, rows: 24 })
  ├── Store handle in activeTerminals map
  ├── INSERT INTO terminal_sessions
  ├── Wire up events:
  │     pty.onData → terminalEvents.emit("terminal:output:{id}", data)
  │     pty.onExit → terminalEvents.emit("terminal:exit:{id}", code)
  └── Return { sessionId, cols, rows }

terminalWrite({ sessionId, data })  → pty.write(data)
terminalResize({ sessionId, cols, rows })  → pty.resize(cols, rows)
terminalClose({ sessionId })  → pty.kill(), remove from map, delete from DB
```

### Ephemeral PTY (`pty.service.ts`, 120 lines)

For one-off commands (not saved to DB):

```
ptySpawn({ command?, args?, cwd, cols?, rows? })
  ├── Detect shell (Windows: powershell/COMSPEC, Unix: SHELL env)
  ├── Spawn process
  ├── Wire events to ptyEvents EventEmitter
  └── Return { ptyId }

ptyWrite({ ptyId, data })  → write to stdin
ptyResize({ ptyId, cols, rows })
ptyKill({ ptyId })  → destroy process, clean up
```

### SSE Delivery

All terminal/PTY output is delivered via Server-Sent Events:

```
GET /api/stream/terminal/:sessionId  → terminalEvents listens for output/exit
GET /api/stream/pty/:ptyId           → ptyEvents listens for data/exit
```

---

## Models

File: `packages/server/src/services/models.service.ts` (180 lines)

```
modelsList()
  └── Gateway RPC → returns array of available models
      Each has: id, name, provider, contextWindow, reasoning support

modelsAuthStatus()
  └── Gateway RPC → returns { authenticated, providers[], usage }
      Cached with expiry to avoid hammering gateway

modelsSetDefault({ modelId })
  └── Read ~/.openclaw/openclaw.json
      Set agents.defaults.model.primary = modelId
      Write back to file
```

---

## Skills System

Pulls skills from three sources:

```
┌────────────┐   ┌────────────┐   ┌────────────┐
│   Local     │   │  ClawHub   │   │  Gateway   │
│ ~/.openclaw │   │ clawhub.ai │   │  (remote)  │
│ /skills/    │   │  HTTP API  │   │  WebSocket │
└──────┬──────┘   └──────┬─────┘   └──────┬─────┘
       └─────────────────┴────────────────┘
                         │
              skills.service.ts (404 lines)
              Unified discover/install API
```

**Local skills** (`skills-local.ts`, 265 lines):
- Scanned from `~/.openclaw/skills/` directory
- Each skill is a directory with a frontmatter file
- Can be installed from catalog templates

**ClawHub** (`clawhub-client.ts`, 200 lines):
- HTTP client for `clawhub.ai` marketplace
- Search, list, fetch details, fetch versions

**Gateway** (`skills-gateway.service.ts`, 146 lines):
- Installed skills on the remote gateway
- Commands list, tools catalog

**Runtime** (`skill-runtime.service.ts`, 200 lines):
- Enable/disable via config file (`~/.openclaw/skills-config.json`)
- Caching with invalidation
- Context building for skill injection into chat

**Templates** (`skill-templates.ts`, 273 lines):
- 17 built-in templates: code-review, git-commit, test-gen, refactor, doc-gen, bug-finder, api-designer, sql-helper, playwright-browser, code-explainer, security-audit, performance-optimizer, regex-builder, csv-excel-processor, image-describer, pdf-reader, slides-creator

---

## Memory System

File: `packages/server/src/services/memory.service.ts` (241 lines)

Stores user knowledge as markdown files with YAML frontmatter:

```
Storage location: ~/.openclaw/workspace/memory/

memoryWrite({ path, content, category?, importance?, tags? })
  └── Write .md file with frontmatter: ---\ncategory: fact\nimportance: high\ntags: [api, auth]\n---\nActual content here

memoryRead({ path })
  └── Read file, parse frontmatter, return content

memorySearch({ query, limit? })
  └── Scan all memory files, match query against content/tags, return ranked results

memoryStore({ key, value })
  └── Quick key-value storage (simplified memoryWrite)

memoryRecall({ key })
  └── Quick retrieval (simplified memoryRead)

memoryReindex()
  └── Rebuild search index
```

---

## File Operations

Two services for files — one scoped, one raw:

**Project-scoped** (`files.service.ts`, 260 lines):
```
filesRead({ projectId, path })
  ├── Resolve path WITHIN project root (security: can't escape project directory)
  ├── Read file (max 50MB)
  └── Return { content, mimeType, encoding }

filesWrite({ projectId, path, content })
  └── Write file within project root

filesTree({ projectId, path?, depth? })
  └── Recursive directory listing within project

filesSearch({ projectId, query })
  └── Search file names/content within project
```

**Raw filesystem** (`fs.service.ts`, 241 lines):
```
fsReadFile({ path })
  └── Read any absolute path (no project constraint)

fsWriteFile({ path, content })
  └── Write to any absolute path

fsReadDir({ path })
  └── List directory contents

fsSearch({ path, query })
  └── Search files by name
```

---

## Git Operations

File: `packages/server/src/services/git.service.ts` (268 lines)

Runs git commands in project directories:

```
gitContext({ projectPath })
  └── Run: git status, git log, git branch
      Parse output, return { branch, dirty, ahead, behind, recentCommits }

gitSwitchBranch({ projectPath, branch })
  └── Run: git checkout {branch}

gitBranches({ projectPath })
  └── Run: git branch -a, parse into { local[], remote[] }

gitCommitDetails({ projectPath, sha })
  └── Run: git show {sha}, parse into { sha, title, author, date, diff }
```

File: `packages/server/src/services/git-parsers.ts` (216 lines)

Parsing utilities:
- `parseChangedFiles(porcelainOutput)` → array of { path, status }
- `parseRecentCommits(logOutput)` → array of { sha, title, author, date }
- `getAheadBehind(statusOutput)` → { ahead: number, behind: number }

---

## Onboarding

File: `packages/server/src/services/onboarding.service.ts` (1664 lines — the largest file)

First-time setup wizard. Handles:

```
1. Gateway validation    → Is the URL reachable? Is it an OpenClaw gateway?
2. Identity generation   → Generate ED25519 key pair, derive device ID from public key SHA-256
3. Config saving         → Write gateway URL + port to ~/.openclaw/openclaw.json
4. Workspace creation    → Create ~/.openclaw/ directory structure
5. Provider setup        → Which AI providers are configured?
6. Model selection       → Which model to use by default?
7. Connection test       → Full end-to-end connection verification

Key functions:
  onboardingGenerateIdentity()  → crypto.generateKeyPairSync("ed25519") → write to device.json
  onboardingSaveGatewayConfig() → write openclaw.json with URL, port
  onboardingCore()              → check all prerequisites
  onboardingFlow()              → orchestrate the full wizard
  onboardingSignOut()           → remove config + identity
  onboardingDeleteAccount()     → sign out + remove all data
```

---

## Usage Tracking

File: `packages/server/src/services/usage.service.ts` (183 lines)

All usage data comes from the gateway:

```
usageSummary({ from?, to? })
  └── Gateway RPC → returns { totalTokens, totalCost, breakdown[] }

usageCurrent()
  └── Gateway RPC → returns current billing period usage

usageLimits()
  └── Gateway RPC → returns { tokenLimit, costLimit, remaining }

usageEstimate({ model, inputTokens, outputTokens })
  └── Calculate estimated cost without calling gateway
```

---

## Auth / Secrets

File: `packages/server/src/auth/secrets.ts` (20 lines)

Dead simple — tokens are stored in the app_settings table:

```
getProfileToken(profileId)
  └── getAppSetting("profile_token." + profileId)

setProfileToken(profileId, token)
  └── setAppSetting("profile_token." + profileId, token)

deleteProfileToken(profileId)
  └── delete from app_settings where key = "profile_token." + profileId
```

---

## Other Small Services

| Service | Lines | What it does |
|---------|-------|-------------|
| `runtime.service.ts` | 65 | Returns contract version `"2026-04-17"`, bot name get/set, admin approval workflow |
| `autonaming.service.ts` | 17 | Truncates first message to 30 chars as conversation name |
| `recent.service.ts` | 71 | Lists recently accessed chats + topics from DB |
| `repos.service.ts` | 149 | Scans filesystem for git repos, tracks recently used ones |
| `version.service.ts` | 49 | Returns OpenClaw version from gateway/config + Node.js version |
| `sandbox.service.ts` | 79 | Deletes test audit data (chats/sessions matching patterns) |

---

## Summary: What Depends on What

```
Server calls Middleware for:
  ✓ Authenticate with gateway
  ✓ Create/delete/reset chat sessions
  ✓ Send messages
  ✓ Stream chat events
  ✓ List gateway sessions
  ✓ All cron operations
  ✓ Model listing and auth status
  ✓ Skills from gateway
  ✓ Usage data
  ✓ Sync push/pull (via session upsert)

Server does locally (NO middleware needed):
  ✓ SQLite database (all CRUD)
  ✓ Session mappings
  ✓ Projects, topics, chats, branches
  ✓ File and filesystem operations
  ✓ Git operations
  ✓ Terminal/PTY spawning
  ✓ Memory read/write
  ✓ Local skills scanning
  ✓ Profile management
  ✓ App settings
  ✓ Onboarding (except gateway test)

If gateway is down:
  ✓ All local operations work
  ✗ Chat send/stream fails
  ✗ Cron operations fail
  ✗ Model listing fails
  ✗ Sync pauses (retries when reconnected)
  ✗ Gateway skills unavailable
```
