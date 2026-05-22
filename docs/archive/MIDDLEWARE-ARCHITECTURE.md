# Middleware Architecture — End to End

The project uses a **3-layer communication pipeline** between the React frontend and the OpenClaw Gateway:

```
React UI  →  Node.js Server (:4000)  →  Middleware lib  →  OpenClaw Gateway (WebSocket)
  (HTTP/SSE)       (Express)              (pure WS client)      (remote/local)
```

---

## Layer 1: Middleware Package (`packages/middleware/src/index.ts`)

A **pure Node.js library** — no framework, no Express, just WebSocket + crypto. Handles gateway communication and authentication.

### Authentication (Ed25519 Challenge-Response)

1. Reads device keypair from `~/.openclaw/state/identity/device.json`
2. Reads gateway token/URL from `~/.openclaw/openclaw.json`
3. Connects to gateway WebSocket, receives a nonce
4. Signs an auth payload: `v3|deviceId|clientId|mode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`
5. Sends signature (base64url-encoded) back — handshake complete

### Core Exports

| Function | Purpose |
|----------|---------|
| `connectToOpenClawGateway()` | Authenticated WS connection, returns client |
| `createChatSession()` | Create a new agent session on gateway |
| `deleteChatSession()` | Delete session + transcripts |
| `resetChatSession()` | Clear conversation history |
| `getChatHistory()` | Fetch past messages |
| `listGatewaySessions()` | List all sessions |
| `upsertGatewaySession()` | Update or create a session |
| `sendChatMessage()` | Send user text, get back a `runId` |
| `openChatEventStream()` | Subscribe to real-time streaming events |
| `contentBlocksToText()` | Extract text from content blocks |
| `extractToolCallBlocks()` | Parse tool invocations from message content |
| `toolOutputVisibility()` | Map verboseLevel to visibility setting |

### Gateway WebSocket Frame Format

- **`req`** (client → server): `{type: "req", id: uuid, method: string, params?}`
- **`res`** (server → client): `{type: "res", id: uuid, ok: bool, payload?, error?}`
- **`event`** (server push): `{type: "event", event: string, payload?}`

### Streaming Event Types

| Event | Description |
|-------|-------------|
| `chat.ready` | Session initialized with history + settings |
| `chat.status` | State changes: `connected` / `sending` / `thinking` / `tool_running` / `streaming` / `done` / `error` |
| `chat.message` | Incoming assistant/user messages |
| `chat.tool` | Tool execution: `start` / `result` / `error` phases |
| `chat.agent` | Agent lifecycle events |
| `chat.error` | Stream errors |

---

## Layer 2: Node.js Server (`packages/server/src/`)

An **Express server on port 4000** that bridges the frontend (HTTP) to the middleware (WebSocket). Exists because browsers cannot run Node.js crypto or maintain persistent WS connections to the gateway.

### Key Components

#### Gateway Client Singleton (`gateway/client.ts`)

- Maintains a single persistent gateway connection
- Auto-reconnect with exponential backoff (3s → 30s max)
- Emits `connected` / `disconnected` / `error` events
- Scopes: `operator.read`, `operator.write`, `operator.approvals`, `operator.admin`

#### Chat Service (`services/chat.service.ts`)

Core business logic:

- Maps **local session keys** (UI-friendly) ↔ **gateway session keys** (immutable) in SQLite
- Validates attachments (max 10 files, 50MB each, 100MB total)
- Calls middleware functions (`sendChatMessage`, `openChatEventStream`)
- Pipes gateway events to an `EventEmitter` for SSE
- Tracks active streams per gateway key
- Deduplicates via `seenToolEvents` and `seenMessageIds`

#### IPC Dispatch (`dispatch/registry.ts`)

- Routes ~250 `middleware_*` commands from the frontend to service handlers
- All `middleware_chat_*` and `middleware_sessions_*` delegate to chat service

#### SSE Handler (`sse/chat.ts`)

- Bridges the `EventEmitter` to HTTP Server-Sent Events
- Listens to `chatEvents.on('chat:event:{sessionKey}', handler)`
- Formats as `event: {type}\ndata: {json}\n\n`

### Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/ipc/{command}` | POST | Generic IPC (request/response) |
| `/api/stream/chat/:sessionKey` | GET | SSE stream for chat events |
| `/api/stream/terminal/:sessionKey` | GET | Terminal events |
| `/api/stream/pty/:ptyId` | GET | PTY events |
| `/api/stream/cron` | GET | Cron events |
| `/health` | GET | Health check `{ok: true, timestamp}` |

---

## Layer 3: Frontend Consumption (`packages/ui/`)

### IPC Bridge (`lib/ipc.ts`)

- `invoke(command, args)` — sends `POST /api/ipc/{command}` with `{input: args}`
- `openEventStream(path, onEvent)` — opens an `EventSource` to the SSE endpoint
- Detects Tauri vs browser runtime and routes accordingly

### Chat Messages Hook (`hooks/useChatMessages.ts`)

The main consumer of the middleware pipeline:

- Bootstraps by loading history via `invoke("middleware_chat_history", ...)`
- Opens `EventSource` at `/api/stream/chat/{sessionKey}`
- Handles all 6 event types (`chat.ready`, `chat.status`, `chat.message`, `chat.tool`, `chat.agent`, `chat.error`)
- Manages sub-agent spawning, message branching, and optimistic UI updates

### Topic Session Hook (`hooks/useTopicSession.ts`)

- Calls `middleware_sessions_list({projectId, topicId})`
- Filters out hidden sessions, returns first match

---

## Complete Data Flow (Sending a Message)

```
 1. User clicks Send
        ↓
 2. useChatMessages.handleSend()
        ↓
 3. invoke("middleware_chat_send", {sessionKey, text, attachments})
        ↓  HTTP POST
 4. Server: POST /api/ipc/middleware_chat_send
        ↓
 5. chat.service.chatSend()
    - Validates attachments
    - ensureGatewaySession() → creates gateway session if needed, stores mapping in SQLite
    - sendChatMessage({sessionKey: gwKey, text}) → gateway returns {runId}
    - startEventStream(gwKey, localKey) in background
        ↓  WebSocket
 6. Middleware → Gateway: {type:"req", method:"chat.send", params:{sessionKey, message}}
        ↓
 7. Gateway processes, starts streaming back events
        ↓  WebSocket events
 8. Middleware's openChatEventStream() receives events, calls onEvent()
        ↓
 9. chat.service emits to EventEmitter: chatEvents.emit("chat:event:{localKey}", event)
        ↓
10. SSE handler pipes to HTTP: event: chat.message\ndata: {...}\n\n
        ↓  EventSource
11. Frontend receives SSE → handleStreamEvent() → React state updates
```

---

## Sub-Agent Handling

When the gateway spawns a sub-agent:

1. Gateway emits `session.created` event with a key like `agent:main:subagent:{uuid}`
2. Middleware auto-subscribes to the child session's events
3. Frontend tracks spawned sub-agents in a `spawnMapRef` map (`Map<toolCallId → SpawnedSubagent>`)
4. Child session events are piped through the same SSE channel
5. Frontend polls child history every 2s, watches for `sessions_yield` tool to detect completion
6. Status progression: `spawning` → `linking` → `working` → `completed` / `failed`

User messages to parent are filtered if from a subagent (key includes `:subagent:`). Tool messages from `sessions_spawn` are parsed for `childSessionKey` JSON. Tool messages from `sessions_yield` mark the subagent as terminal.

---

## Deduplication and Reliability

- **Seen tracking:** `seenToolEvents` (by `runId:seq:phase`) and `seenMessageIds` prevent duplicate event processing
- **Stream lifecycle:** One `openChatEventStream()` call per `sendChatMessage()`, kept alive for sub-agent monitoring
- **Message branching:** When a user edits a message, old responses are stored in the DB; history query applies edits to filter messages after the edit point
- **Auto-reconnect:** Gateway client reconnects with exponential backoff on disconnect

---

## Configuration Files

| File | Contents |
|------|----------|
| `~/.openclaw/openclaw.json` | Gateway URL, port, auth token |
| `~/.openclaw/state/identity/device.json` | Ed25519 keypair, deviceId, version |

### Device Identity Example

```json
{
  "version": 1,
  "deviceId": "b67b8f63...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...(Ed25519)...",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...(Ed25519)...",
  "createdAtMs": 1771838179935
}
```

### Gateway Config Example

```json
{
  "gateway": {
    "port": 18789,
    "auth": {
      "token": "c3774f1d..."
    },
    "remote": {
      "url": "ws://127.0.0.1:18789"
    }
  },
  "gateway_url": "ws://89.167.62.65:18789"
}
```

---

## Critical Integration Points

| Component | File | Purpose |
|-----------|------|---------|
| Middleware | `packages/middleware/src/index.ts` | Pure gateway client with auth + crypto |
| Server | `packages/server/src/index.ts` | Express server, gateway singleton, IPC dispatch |
| Chat Service | `packages/server/src/services/chat.service.ts` | Session mapping, attachment validation, event streaming |
| Dispatch | `packages/server/src/dispatch/registry.ts` | Command routing to service handlers |
| SSE Handler | `packages/server/src/sse/chat.ts` | EventEmitter → HTTP EventSource bridge |
| Frontend IPC | `packages/ui/lib/ipc.ts` | HTTP invoke + EventSource abstraction |
| Chat Hook | `packages/ui/hooks/useChatMessages.ts` | Message state, event subscription, branch tracking |
| Gateway Config | `~/.openclaw/openclaw.json` | Endpoint URL, token, ports |
| Device Identity | `~/.openclaw/state/identity/device.json` | Ed25519 keypair + deviceId |

---

## Summary

The middleware is a pure WebSocket client library. It does not run standalone — it is consumed by the Node.js server (port 4000), which acts as a bridge translating HTTP/SSE requests from the React frontend into authenticated WebSocket calls to the OpenClaw Gateway. The frontend never talks to the gateway directly.
