# OCPlatform Desktop — Middleware V2 API Reference

> **Audience:** Frontend developers building against the middleware-v2 HTTP/WS layer.
> **Generated from source:** `apps/middleware-v2/src/` (schema version 2, projection version 3)

---

## 1. Architecture Overview

```
┌──────────────────────┐      HTTP / WS        ┌─────────────────────┐      WebSocket       ┌──────────────────┐
│  Desktop Frontend    │ ◄──────────────────► │  Middleware V2      │ ◄──────────────────► │ OCPlatform Gateway │
│  (Tauri / Next.js)   │                       │  (Fastify, SQLite)  │                       │  (Agent Runtime) │
└──────────────────────┘                       └─────────────────────┘                       └──────────────────┘
```

### Two API Layers

| Layer | Prefix / Pattern | Purpose |
|-------|-----------------|---------|
| **v2 native** | `/api/chat/*`, `/api/exec/*`, `/api/patches`, `/api/stream/ws` | New projection-based chat, real-time patches, tool approvals |
| **Legacy compat** | `/api/bootstrap`, `/api/chats`, `/api/spaces`, `/api/projects`, `/api/topics`, `/api/sessions`, `/api/commands/:command`, `/api/workspace/*`, `/api/repos/*`, `/api/terminal/*`, `/api/stream/chat/:sessionKey`, `/api/stream/cron` | REST CRUD & SSE endpoints the frontend currently uses |

### Data Flow

1. **Send message:** Frontend `POST /api/chat/send` → Middleware creates optimistic user message in SQLite → sends `chat.send` to Gateway via WebSocket → Gateway dispatches to Agent → Agent streams events back via Gateway WebSocket → Middleware `ChatLiveIngest` receives `session.message` / `session.tool` events → normalizes & persists to SQLite → broadcasts `PatchPayload` to all connected patch-stream clients.

2. **Real-time updates:** Frontend connects to `/api/stream/ws` (WebSocket) or polls `GET /api/patches?afterCursor=N`. Patches carry a monotonically-increasing `cursor` (SQLite autoincrement). On reconnect, the frontend replays missed patches from the cursor it last saw.

3. **Bootstrap / Resume:** Frontend calls `GET /api/chat/bootstrap?sessionKey=X` → Middleware fetches full history from Gateway (`chat.history`), normalizes, persists to SQLite projection store, subscribes to live events, returns the full snapshot.

### SQLite Projection Store

| Table | Purpose |
|-------|---------|
| `v2_sessions` | Per-session metadata (status, sessionId, data blob) |
| `v2_messages` | Projected messages keyed by `(session_key, openclaw_seq)` |
| `v2_runs` | Run lifecycle tracking (thinking → streaming → tool_running → done/error/aborted) |
| `v2_tool_calls` | Individual tool call tracking within a run |
| `v2_projection_events` | Append-only event log; `cursor` column is the global ordering key |
| `v2_gateway_offsets` | Tracks the last synced `openclaw_seq` per session |

---

## 2. Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIDDLEWARE_V2_HOST` (or `HOST`) | `127.0.0.1` | Bind address |
| `MIDDLEWARE_V2_PORT` (or `PORT`) | `8787` | Listen port |
| `MIDDLEWARE_V2_DB` | `~/.openclaw/middleware-v2/state.sqlite` | SQLite database path |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(none)* | Auth token for Gateway (falls back to `~/.openclaw/openclaw.json` → `gateway.auth.token`) |
| `NODE_ENV` | `development` | |

### Config Shape (TypeScript)

```typescript
type MiddlewareV2Config = {
  host: string;           // "127.0.0.1"
  port: number;           // 8787
  databasePath: string;   // absolute path to SQLite file
  openclawGatewayUrl: string;  // "ws://127.0.0.1:18789"
  openclawGatewayToken?: string;
  nodeEnv: string;        // "development" | "production"
};
```

### OCPlatform Config File

Located at `~/.openclaw/openclaw.json`. The middleware reads:
- `gateway.auth.token` — fallback auth token
- `gateway.port` — fallback port for gateway URL construction
- `agents.defaults.model` — current default model
- `agents.defaults.models` — available model list

### Device Identity

Located at `~/.openclaw/state/identity/device.json`:
```json
{
  "deviceId": "...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n..."
}
```

Used for Ed25519 signature-based authentication with Gateway.

---

## 3. REST Endpoints

### Common Error Shape

All error responses share this structure:

```typescript
interface ErrorResponse {
  ok: false;
  error: {
    code: string;      // e.g. "NOT_FOUND", "INVALID_BODY", "BAD_REQUEST", "INTERNAL_ERROR"
    message: string;
    details?: unknown;  // Zod validation details when code is "INVALID_BODY"/"INVALID_QUERY"
  };
}
```

---

### 3.1 System Routes

#### `GET /health`

Health check endpoint.

**Response** `200`
```typescript
interface HealthResponse {
  ok: true;
  service: "openclaw-middleware-v2";
  version: "0.1.0";
  host: string;
  port: number;
  uptimeMs: number;
  gateway: GatewayStatus;
}

interface GatewayStatus {
  connected: boolean;
  gatewayUrl: string;
  connectedAtMs: number | null;
  lastError: string | null;
  pendingRequests: number;
  listenerCount: number;
}
```

**Example:**
```json
{
  "ok": true,
  "service": "openclaw-middleware-v2",
  "version": "0.1.0",
  "host": "127.0.0.1",
  "port": 8787,
  "uptimeMs": 123456,
  "gateway": {
    "connected": true,
    "gatewayUrl": "ws://127.0.0.1:18789",
    "connectedAtMs": 1715500000000,
    "lastError": null,
    "pendingRequests": 0,
    "listenerCount": 1
  }
}
```

---

#### `GET /api/system/info`

System information.

**Response** `200`
```typescript
interface SystemInfoResponse {
  ok: true;
  service: "openclaw-middleware-v2";
  version: "0.1.0";
  host: string;
  port: number;
  databasePath: string;
  gatewayUrl: string;
  uptimeMs: number;
}
```

---

#### `GET /api/version`

Version info (compat layer).

**Response** `200`
```json
{
  "ok": true,
  "version": "0.1.0",
  "service": "openclaw-middleware-v2"
}
```

---

### 3.2 Gateway Routes

#### `GET /api/gateway/status`

**Response** `200`
```typescript
interface GatewayStatusResponse {
  ok: true;
  gateway: GatewayStatus;
}
```

---

#### `POST /api/gateway/reconnect`

Force-reconnect to the Gateway WebSocket.

**Request body:** *(none)*

**Response** `200`
```json
{
  "ok": true,
  "gateway": { "connected": true, "gatewayUrl": "ws://...", "connectedAtMs": 1715500000000, "lastError": null, "pendingRequests": 0, "listenerCount": 1 }
}
```

---

### 3.3 Diagnostics Routes

#### `GET /api/diagnostics`

Full system diagnostics.

**Response** `200`
```typescript
interface DiagnosticsResponse {
  ok: true;
  service: "openclaw-middleware-v2";
  uptimeMs: number;
  gateway: GatewayStatus;
  projection: {
    enabled: true;
    sessions: number;
    messages: number;
    projectionEvents: number;
    latestCursor: number | null;
  };
  liveIngest: {
    subscribedSessions: string[];
    listening: boolean;
    optimisticUserSessions: number;
  };
  patchBus: {
    clients: number;
    clientCursors: Array<{
      id: string;
      connectedAtMs: number;
      lastSentCursor: number;
    }>;
  };
}
```

---

#### `GET /api/diagnostics/patch-clients`

**Response** `200`
```json
{
  "ok": true,
  "patchBus": {
    "clients": 2,
    "clientCursors": [
      { "id": "uuid-1", "connectedAtMs": 1715500000000, "lastSentCursor": 42 }
    ]
  }
}
```

---

### 3.4 Chat Routes (v2 Native)

#### `POST /api/chat/send`

Send a message to a chat session. This is the primary send endpoint. It:
1. Ensures the Gateway session exists (`sessions.create`)
2. Optionally patches exec policy (`sessions.patch`)
3. Subscribes to live events for the session
4. Creates an optimistic user message in SQLite
5. Broadcasts an optimistic `chat.message.upsert` patch
6. Sends `chat.send` to Gateway
7. Loads history from Gateway (`chat.history`) to reconcile
8. Confirms/upserts messages, broadcasts patches
9. On success: broadcasts `chat.status` → `done`
10. On error: broadcasts `chat.status` → `error`

**Uses a per-session send queue** — concurrent sends to the same session are serialized.

**Request Body:**
```typescript
interface ChatSendRequest {
  sessionKey: string;         // required — e.g. "agent:main:desktop:m1abc-xyz123"
  text?: string;              // message text (alias: message)
  message?: string;           // message text (alias: text)
  attachments?: Attachment[]; // optional file attachments
  idempotencyKey: string;     // required — unique per send
  clientMessageId?: string;   // optional — defaults to `client:${idempotencyKey}`
  timeoutMs?: number;         // optional — Gateway send timeout (default: 120000)
  agentId?: string;           // optional — default "main"
  label?: string;             // optional — session label for display
  execPolicy?: ExecPolicy | null; // optional — exec security policy
  replyTo?: unknown;          // optional — reserved
  autonomyMode?: unknown;     // optional — reserved
}

interface Attachment {
  name?: string;
  mimeType?: string;
  content?: string;           // base64 or utf-8 encoded content
  encoding?: "utf-8" | "base64";
  size?: number;
}

interface ExecPolicy {
  security?: "allowlist" | "full";
  ask?: "off" | "on-miss" | "always";
}
```

**Example Request:**
```json
{
  "sessionKey": "agent:main:desktop:m1abc-xyz123",
  "text": "Hello, can you help me with a task?",
  "idempotencyKey": "send_1715500000_abc",
  "clientMessageId": "client:send_1715500000_abc",
  "agentId": "main",
  "label": "My Chat"
}
```

**Response** `200`
```typescript
interface ChatSendResponse {
  ok: true;
  sessionKey: string;
  idempotencyKey: string;
  // ...plus any fields from Gateway's chat.send response:
  status?: string;     // e.g. "done", "streaming", "accepted"
  runId?: string;      // Gateway-assigned run ID
  [key: string]: unknown;
}
```

**Error Responses:**
- `400` — Missing/invalid body (Zod validation)
- `400` — Empty message text (`BAD_REQUEST`)
- `500` — Gateway send failure (propagated)

**Side Effects:**
- Creates optimistic user message in SQLite
- Broadcasts `chat.message.upsert` (optimistic), `chat.status` (thinking), then either `chat.message.confirmed`, more `chat.message.upsert` patches, and `chat.status` (done/error)
- Creates/updates run in `v2_runs` table
- Upserts session status in `v2_sessions`
- Fire-and-forget: `sessions.create` to Gateway (errors swallowed)

---

#### `POST /api/chat/abort`

Abort a running chat session/run.

**Request Body:**
```typescript
interface ChatAbortRequest {
  sessionKey: string;  // required
  runId?: string;      // optional — specific run to abort
}
```

**Response** `200`
```json
{
  "ok": true,
  "status": "aborted"
}
```

**Side Effects:**
- Sends `chat.abort` to Gateway
- Updates run status to `"aborted"` in SQLite
- Updates session status to `"aborted"`

---

#### `GET /api/chat/bootstrap?sessionKey=X`

Bootstrap/resume a chat session. Fetches full history from Gateway, normalizes, persists to SQLite, subscribes to live events.

**Query Parameters:**
```typescript
interface BootstrapQuery {
  sessionKey: string;       // required
  limit?: number;           // max messages (1-1000)
  maxChars?: number;        // max total chars hint to Gateway
}
```

**Response** `200`
```typescript
interface ChatBootstrapResponse {
  ok: true;
  source: "middleware-v2-projection";
  projectionVersion: 3;
  sessionKey: string;
  sessionId: string | null;
  runStatus: BootstrapRunStatus;  // "idle"|"queued"|"thinking"|"streaming"|"tool_running"|"done"|"error"|"aborted"
  statusLabel: string | null;     // e.g. "Thinking", "Streaming", null
  activeRun: ActiveRunProjection | null;
  messages: OCPlatformMessage[];    // full message history
  messageCount: number;
  tools: ToolCallProjection[];
  toolCalls: ToolCallProjection[];  // same as tools (alias)
  cursor: number;                   // latest projection cursor — use for patches
  sessionStatus: string | null;     // legacy status ("running", "done", "error", null)
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  projection: {
    enabled: true;
    version: 3;
    upserted: number;
    lastSeq: number;
    cursor: number;
    liveSubscribed: true;
  };
}

type BootstrapRunStatus = "idle" | "queued" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted";

interface ActiveRunProjection {
  runId: string;
  gatewayRunId: string | null;
  clientMessageId: string | null;
  idempotencyKey: string | null;
  status: RunStatus;
  statusLabel: string | null;
  startedAtMs: number;
  updatedAtMs: number;
}

interface ToolCallProjection {
  toolCallId: string;
  id: string;           // same as toolCallId
  sessionKey: string;
  runId: string | null;
  messageId: string | null;
  name: string;
  phase: "start" | "calling" | "result" | "error";
  status: "running" | "success" | "error";
  argsMeta: unknown;
  resultMeta: unknown;
  startedAtMs: number;
  finishedAtMs: number | null;
  updatedAtMs: number;
}
```

**Example:**
```json
{
  "ok": true,
  "source": "middleware-v2-projection",
  "projectionVersion": 3,
  "sessionKey": "agent:main:desktop:m1abc-xyz123",
  "sessionId": "sess_abc123",
  "runStatus": "idle",
  "statusLabel": null,
  "activeRun": null,
  "messages": [
    { "role": "user", "text": "Hello", "__openclaw": { "id": "msg_1", "seq": 1 } },
    { "role": "assistant", "text": "Hi there!", "__openclaw": { "id": "msg_2", "seq": 2 } }
  ],
  "messageCount": 2,
  "tools": [],
  "toolCalls": [],
  "cursor": 15,
  "sessionStatus": null,
  "projection": {
    "enabled": true,
    "version": 3,
    "upserted": 2,
    "lastSeq": 2,
    "cursor": 15,
    "liveSubscribed": true
  }
}
```

---

#### `GET /api/chat/messages?sessionKey=X`

Read projected messages from SQLite (no Gateway round-trip).

**Query Parameters:**
```typescript
interface MessagesQuery {
  sessionKey: string;    // required
  afterSeq?: number;     // only messages with seq > afterSeq (default: 0)
  limit?: number;        // max 1000 (default: 200)
}
```

**Response** `200`
```typescript
interface ChatMessagesResponse {
  ok: true;
  source: "middleware-v2-projection";
  sessionKey: string;
  messages: Array<{
    sessionKey: string;
    openclawSeq: number;
    messageId: string | null;
    role: string | null;
    data: OCPlatformMessage;
    updatedAtMs: number;
  }>;
  messageCount: number;
}
```

---

#### `POST /api/exec/approval/resolve`

Resolve a tool execution approval request (allow/deny).

**Request Body:**
```typescript
interface ApprovalResolveRequest {
  approvalId?: string;  // approval ID (or use `id`)
  id?: string;          // alias for approvalId
  decision: "allow-once" | "allow-always" | "deny";
}
```

**Response** `200`
```json
{
  "ok": true,
  "approvalId": "approval_abc",
  "decision": "allow-once"
}
```

**Error:** `400` if no `approvalId` provided, `500` if Gateway rejects.

---

### 3.5 Compat Routes — Spaces

#### `GET /api/bootstrap`

Full app bootstrap (legacy). Returns spaces, chats, projects, sessions, gateway status.

**Response** `200`
```typescript
interface BootstrapResponse {
  ok: true;
  service: "openclaw-middleware-v2";
  spaces: Space[];
  activeSpaceId: string;
  chats: Chat[];         // non-archived chats in active space
  projects: Project[];
  sessions: Session[];
  gateway: GatewayStatus;
}
```

---

#### `GET /api/spaces`

**Response** `200`
```typescript
{ spaces: Space[]; activeSpaceId: string; }
```

---

#### `POST /api/spaces`

Create a new space.

**Request Body:**
```typescript
{ name?: string; }  // default: "New Space"
```

**Response** `200`
```typescript
interface Space {
  id: string;          // "space_..."
  name: string;
  archived: boolean;
  deleted: boolean;
  sortOrder: number;
  createdAt: string;   // ISO 8601
  updatedAt: string;
}

{ space: Space; activeSpaceId: string; }
```

---

#### `PATCH /api/spaces/:spaceId`

Update a space. Body is a partial `Space`.

**Response** `200` `{ space: Space }` or `404`.

---

#### `POST /api/spaces/:spaceId/switch`

Switch to a space.

**Response** `200` `{ activeSpaceId: string; space: Space }` or `404`.

---

#### `DELETE /api/spaces/:spaceId`

Soft-delete a space.

**Response** `200` `{ ok: true }`

---

### 3.6 Compat Routes — Chats

#### `GET /api/chats`

**Query:** `spaceId?: string`, `archived?: "true"|"false"`

**Response** `200`
```typescript
{ chats: Chat[] }

interface Chat {
  id: string;             // "chat_..."
  name: string;
  sessionKey: string;     // e.g. "agent:main:desktop:m1abc-xyz123"
  spaceId: string;
  agentId: string;
  archived: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}
```

---

#### `POST /api/chats`

Create a new chat. Also creates a Gateway session (fire-and-forget) and a local compat session.

**Request Body:**
```typescript
interface CreateChatRequest {
  name?: string;          // default "New Chat"
  sessionKey?: string;    // auto-generated if omitted: "agent:{agentId}:desktop:{timestamp}-{random}"
  spaceId?: string;       // default: active space
  agentId?: string;       // default "main"
  projectId?: string;
  topicId?: string;
}
```

**Response** `200`
```typescript
{ chat: Chat; session: CompatSession }

interface CompatSession {
  id: string;
  key: string;          // same as sessionKey
  sessionKey: string;
  projectId: string | null;
  topicId: string | null;
  agentId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}
```

**Side Effect:** Fire-and-forget `sessions.create` to Gateway with label `"{name} · {shortSessionId}"`.

---

#### `PATCH /api/chats/:chatId`

Partial update. **Response** `200` `{ chat: Chat }` or `404`.

---

#### `POST /api/chats/:chatId/rename`

**Request Body:** `{ name: string }`
**Response** `200` `{ chat: Chat }` or `404`.

---

#### `POST /api/chats/:chatId/archive`

**Request Body:** `{ archived?: boolean }` (default: `true`)
**Response** `200` `{ chat: Chat }` or `404`.

---

#### `DELETE /api/chats/:chatId`

Soft-delete. **Response** `200` `{ ok: true }`

---

#### `POST /api/chats/:chatId/session`

Associate a session key with an existing chat, or create a new chat if it doesn't exist.

**Request Body:** `{ sessionKey: string; name?: string; spaceId?: string; agentId?: string }`
**Response** `200` `{ chat: Chat }`

---

### 3.7 Compat Routes — Projects

#### `GET /api/projects`

**Query:** `spaceId?: string`
**Response** `200` `{ projects: Project[] }`

```typescript
interface Project {
  id: string;
  name: string;
  spaceId: string;
  workspaceRoot?: string;
  repoRoot?: string;
  path?: string;
  currentBranch?: string;
  provider?: string;
  archived?: boolean;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

#### `POST /api/projects`

**Request Body:** `{ name?: string; spaceId?: string; workspaceRoot?: string; ... }`
**Response** `200` `{ project: Project }`

---

#### `PATCH /api/projects/:projectId`

**Response** `200` `{ project: Project }` or `404`.

---

#### `POST /api/projects/:projectId/archive`

**Request Body:** `{ archived?: boolean }`
**Response** `200` `{ project: Project }` or `404`.

---

#### `DELETE /api/projects/:projectId`

Soft-delete. **Response** `200` `{ ok: true }`

---

### 3.8 Compat Routes — Topics

#### `GET /api/topics`

**Query:** `projectId?: string`
**Response** `200` `{ topics: Topic[] }`

```typescript
interface Topic {
  id: string;
  name: string;
  projectId?: string;
  archived: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

#### `POST /api/topics`

**Request Body:** `{ name?: string; projectId?: string; ... }`
**Response** `200` `{ topic: Topic }`

---

#### `PATCH /api/topics/:topicId`

**Response** `200` `{ topic: Topic }` or `404`.

---

#### `POST /api/topics/:topicId/archive`

**Request Body:** `{ archived?: boolean }`
**Response** `200` `{ topic: Topic }` or `404`.

---

#### `DELETE /api/topics/:topicId`

Soft-delete. **Response** `200` `{ ok: true }`

---

### 3.9 Compat Routes — Sessions

#### `GET /api/sessions`

**Query:** `projectId?: string`, `topicId?: string`
**Response** `200` `{ sessions: CompatSession[] }`

---

#### `POST /api/sessions`

Creates a session and fires `sessions.create` to Gateway (fire-and-forget).

**Request Body:** `{ sessionKey?: string; agentId?: string; label?: string; projectId?: string; topicId?: string; }`
**Response** `200` `{ session: CompatSession }`

---

### 3.10 Compat Routes — Git

#### Project-Scoped Git

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/projects/:projectId/git/status` | GET | `{ dirty: boolean; files: Array<{ path: string; status: string }> }` |
| `/api/projects/:projectId/git/diff?path=FILE` | GET | `{ patch: string }` |
| `/api/projects/:projectId/git/branches` | GET | `{ branches: Array<{ name: string; current: boolean }>; current: string }` |
| `/api/projects/:projectId/git/checkout` | POST `{ branch: string }` | `{ ok: true; branch: string }` |

All return `404` if project not found or has no workspace root.

#### Repo-Path Git (No Project)

| Endpoint | Method | Query/Body | Response |
|----------|--------|------------|----------|
| `/api/repos/git/status` | GET | `?path=REPO_PATH` or `?repoPath=` | `{ dirty: boolean; files: [...] }` |
| `/api/repos/git/diff` | GET | `?repoPath=X&path=FILE` | `{ patch: string }` |
| `/api/repos/git/branches` | GET | `?path=REPO_PATH` | `{ branches: [...]; current: string }` |
| `/api/repos/git/checkout` | POST | `{ repoPath: string; branch: string }` | `{ ok: true; branch: string }` |

---

### 3.11 Compat Routes — Repos

#### `GET /api/repos/recent`

Scans the OCPlatform workspace root for git repos (max depth 4, limit 50).

**Response** `200`
```typescript
{
  repos: Array<{
    id: string;            // "repo_..." (base64url of path)
    name: string;          // directory basename
    path: string;          // absolute path
    repoRoot: string;
    workspaceRoot: string;
    currentBranch: string | null;
    provider: "local";
  }>
}
```

---

#### `POST /api/repos/scan`

**Request Body:** `{ path?: string; root?: string; workspaceRoot?: string }` — defaults to OCPlatform workspace root.
**Response** `200` `{ repos: Repo[]; root: string }`

---

#### `POST /api/repos/select`

Echo back the selection. **Response** `200` `{ ok: true, ...body }`

---

### 3.12 Compat Routes — Workspace (Global)

All workspace routes operate relative to the OCPlatform workspace root (`~/.openclaw/workspace` or configured).

#### `GET /api/workspace/capabilities`

**Response** `200`
```json
{
  "capabilities": {
    "canTree": true, "canStat": true, "canRead": true, "canWrite": true,
    "canDownloadFile": true, "canCreateDir": true, "canMoveEntry": true, "canDeleteEntry": true
  }
}
```

---

#### `GET /api/workspace/tree?path=REL`

**Response** `200`
```typescript
{
  entries: Array<{
    name: string;
    path: string;         // relative to workspace root
    type: "file" | "directory";
    size: number;
    modifiedAt: string;   // ISO 8601
  }>
}
```

---

#### `GET /api/workspace/stat?path=REL`

**Response** `200` `{ entry: WorkspaceEntry }` or `404`.

---

#### `GET /api/workspace/file?path=REL`

**Response** `200`
```json
{
  "path": "AGENTS.md",
  "content": "# file content...",
  "encoding": "utf-8",
  "file": { "path": "AGENTS.md", "content": "...", "encoding": "utf-8" }
}
```

---

#### `PUT /api/workspace/file`

**Request Body:** `{ path: string; content: string }`
**Response** `200` `{ ok: true; path: string }`

---

#### `DELETE /api/workspace/file?path=REL`

**Response** `200` `{ ok: true }` or `404`.

---

#### `POST /api/workspace/mkdir`

**Request Body:** `{ path: string }`
**Response** `200` `{ ok: true }`

---

#### `POST /api/workspace/move`

**Request Body:** `{ fromPath: string; toPath: string }`
**Response** `200` `{ ok: true }`

---

#### `GET /api/workspace/download?path=REL`

Returns raw file content with `Content-Disposition: attachment` header and appropriate MIME type.

---

### 3.13 Compat Routes — Workspace (Project-Scoped)

Same as global workspace, but scoped to a project's workspace root.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/projects/:projectId/workspace/tree?path=REL` | GET | List directory |
| `GET /api/projects/:projectId/workspace/file?path=REL` | GET | Read file |
| `PUT /api/projects/:projectId/workspace/file` | PUT | Write file (`{ path, content }`) |

All return `404` if project not found.

---

### 3.14 Compat Routes — Terminal

#### `POST /api/terminal/spawn`

Spawn a new terminal process.

**Request Body:** `{ cwd?: string; workspaceRoot?: string }`
**Response** `200`
```json
{
  "terminalId": "term_m1abc_xyz123",
  "cwd": "/root/.openclaw/workspace",
  "streamUrl": "/api/terminal/term_m1abc_xyz123/stream",
  "websocketUrl": "/api/terminal/term_m1abc_xyz123/ws"
}
```

---

#### `POST /api/projects/:projectId/terminal/spawn`

Spawn terminal at the project's workspace root.

---

#### `POST /api/terminal/:ptyId/write`

**Request Body:** `{ data: string }` — raw terminal input.
**Response** `200` `{ ok: true }`

---

#### `POST /api/terminal/:ptyId/resize`

No-op stub (child_process doesn't support resize). **Response** `200` `{ ok: true }`

---

#### `POST /api/terminal/:ptyId/kill`

Kill terminal process. **Response** `200` `{ ok: true }`

---

### 3.15 Compat Routes — Migration & Updates (Stubs)

| Endpoint | Method | Response |
|----------|--------|----------|
| `GET /api/migration/telegram/scan` | GET | `{ sessions: [], count: 0 }` |
| `POST /api/migration/telegram/import` | POST | `{ ok: true, imported: 0 }` |
| `GET /api/middleware/update/status` | GET | `{ available: false, current: "0.1.0" }` |
| `POST /api/middleware/update` | POST | `{ ok: true, status: "up-to-date" }` |

---

### 3.16 Pairing

#### `GET /pairing/local`

**Response** `200`
```json
{
  "ok": true,
  "url": "http://127.0.0.1:8787",
  "token": "",
  "mode": "local",
  "openclaw": { "connected": true }
}
```

---

### 3.17 Patches (REST)

#### `GET /api/patches`

Poll for projection events after a given cursor.

**Query Parameters:**
```typescript
interface PatchesQuery {
  afterCursor?: string;  // default "0"
  limit?: string;        // 1-5000, default 1000
}
```

**Response** `200`
```typescript
interface PatchesResponse {
  ok: true;
  patches: PatchPayload[];
  count: number;
  latestCursor: number;        // cursor of the last patch in this batch
  hasMore: boolean;            // true if count === limit
  replayWindowExceeded: boolean; // same as hasMore
  recovery: "bootstrap" | null; // "bootstrap" if client is too far behind
}

interface PatchPayload {
  cursor: number;              // monotonically increasing
  type: string;                // event type
  sessionKey: string | null;
  payload: unknown;            // event-specific payload
  createdAtMs: number;
}
```

---

## 4. SSE / Streaming Endpoints

### `GET /api/stream/chat/:sessionKey`

Legacy SSE stream for a specific chat session. Polls `v2_projection_events` every 500ms for new events matching the session key.

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**
```
event: chat.message.upsert
data: {"sessionKey":"...","message":{...},"optimistic":true}

event: chat.status
data: {"sessionKey":"...","status":"thinking","statusLabel":"Thinking"}

:heartbeat
```

- Event name is the `event_type` from projection events (if it starts with `chat.`), otherwise `"message"`.
- Heartbeat comment (`:heartbeat`) every 15 seconds.
- Initial `:ok` comment on connect.

---

### `GET /api/stream/cron`

Legacy cron SSE stream. Emits a `cron.ready` event immediately, then heartbeats.

**Events:**
```
event: cron.ready
data: {"ok":true}

:heartbeat
```

---

### `GET /api/terminal/:ptyId/stream`

SSE stream for terminal output.

**Events:**
```
event: data
data: {"type":"terminal.data","terminalId":"term_abc","data":"$ ls\n"}

event: exit
data: {"type":"terminal.exit","terminalId":"term_abc","exitCode":0}
```

---

## 5. WebSocket Endpoints

### `GET /api/stream/ws` (WebSocket)

**Primary real-time connection.** The frontend should prefer this over SSE.

**Query:** `?afterCursor=N` — cursor to replay from.

**Connection Flow:**
1. Client connects with `?afterCursor=42`
2. Server sends `hello` frame with replay info
3. Server replays up to 1000 missed patches
4. Server broadcasts new patches in real-time

**Server → Client Messages:**

```typescript
// Hello frame (first message)
interface HelloFrame {
  type: "hello";
  clientId: string;
  afterCursor: number;
  replayCount: number;
  replayHasMore: boolean;
  replayWindowExceeded: boolean;
  recovery: "bootstrap" | null;  // if too far behind, client should bootstrap
}

// Patch frame (all subsequent messages)
interface PatchFrame {
  type: "patch";
  patch: PatchPayload;
}
```

**No client→server messages expected** (fire-and-forget WebSocket).

---

### `GET /api/gateway/ws` *(Not registered in current source)*

The Gateway WebSocket connection is internal to the middleware — not exposed as a frontend-facing endpoint.

---

### `GET /api/terminal/:ptyId/ws` (WebSocket)

Terminal WebSocket.

**Server → Client:**
```json
{ "event": "data", "data": { "type": "terminal.data", "terminalId": "term_abc", "data": "output text" } }
{ "event": "exit", "data": { "type": "terminal.exit", "terminalId": "term_abc", "exitCode": 0 } }
```

**Client → Server:**
```json
{ "type": "write", "data": "ls\n" }
{ "type": "kill" }
```

---

## 6. Command Endpoints

### `POST /api/commands/:command`

Generic command dispatch (legacy compat layer). Request body format:

```typescript
interface CommandRequest {
  input?: Record<string, unknown>;  // command-specific payload
  // ...or body itself is treated as input
}
```

### Supported Commands

#### `middleware_usage`

**Input:** `{ days?: number }` (default: 30)
**Response:**
```json
{
  "range": { "days": 30 },
  "summary": { "totalCost": 0, "totalInputTokens": 0, "totalOutputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 0 },
  "providers": [],
  "usage": [],
  "source": "middleware-v2-compat"
}
```

---

#### `middleware_usage_daily`

**Input:** `{ days?: number }` (default: 30)
**Response:**
```json
{
  "range": { "days": 30 },
  "daily": [
    { "date": "2026-05-01", "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "total_tokens": 0, "cost_usd": 0 }
  ],
  "days": [ /* same as daily */ ],
  "source": "middleware-v2-compat"
}
```

---

#### `middleware_models_list`

Returns available models from `~/.openclaw/openclaw.json`.

**Response:**
```typescript
{
  models: Array<{
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
  }>;
  currentModel: string | null;   // e.g. "anthropic/claude-opus-4-6"
  defaultModel: string | null;
}
```

---

#### `middleware_models_set_default`

**Input:** `{ modelId: string }` or `{ modelRef: string }`
**Response:** `{ ok: true; modelId: string; currentModel: string; defaultModel: string }`

**Side Effect:** Writes to `~/.openclaw/openclaw.json` → sets `agents.defaults.model.primary`.

---

#### `middleware_models_auth_status`

**Response:** `{ providers: []; configured: true }`

---

#### `middleware_commands_list`

**Response:** `{ commands: [] }`

---

#### `middleware_autonaming_quick`

Quick auto-name from message text.

**Input:** `{ text?: string; prompt?: string }`
**Response:** `{ name: string; title: string }` — first 60 chars of input.

---

#### `middleware_chat_history`

Read chat history from the projection store (SQLite).

**Input:** `{ sessionKey: string }`
**Response:** `{ messages: OpenClawMessage[] }`

---

#### `middleware_chat_model_set`

Set the model for a specific session.

**Input:** `{ sessionKey: string; modelId: string }`
**Response:** `{ ok: true }`

**Side Effect:** Sends `sessions.patch` to Gateway with `{ model: { primary: modelId } }`.

---

#### `middleware_connect_status`

**Response:**
```json
{
  "gatewayConfigured": true,
  "gatewayUrl": "ws://127.0.0.1:18789",
  "gatewayToken": "configured",
  "hasConnection": true,
  "hasIdentity": true,
  "status": "connected",
  "error": null
}
```

---

#### `middleware_connect_test`

Tests Gateway connection latency.

**Response:** `{ ready: boolean; latencyMs: number; error: string | null }`

---

#### `middleware_connect_reset` / `middleware_connect_disconnect` / `middleware_connect_delete_all`

No-op stubs. **Response:** `{ ok: true }`

---

#### `middleware_connect_bootstrap`

**Response:** `{ ok: true; gateway: GatewayStatus; openclaw: { connected: boolean } }`

---

#### `middleware_exec_approval_resolve`

Resolve a tool execution approval.

**Input:** `{ approvalId: string; decision: "allow-once" | "allow-always" | "deny" }`
**Response:** `{ ok: true }`

**Side Effect:** Sends `exec.approval.resolve` to Gateway.

---

#### `middleware_message_feedback` / `middleware_message_feedback_delete`

No-op stubs. **Response:** `{ ok: true }`

---

#### `middleware_sessions_create`

Create a session via the command interface.

**Input:** `{ sessionKey?: string; agentId?: string; label?: string; projectId?: string; topicId?: string }`
**Response:** `{ session: CompatSession }`

---

#### `middleware_chats_create`

Create a chat via the command interface.

**Input:** `{ sessionKey?: string; name?: string; spaceId?: string; agentId?: string }`
**Response:** `{ chat: Chat; session: { sessionKey: string } }`

---

#### `middleware_chat_stop`

Stop a running chat.

**Input:** `{ sessionKey: string }`
**Response:** `{ ok: true }`

**Side Effect:** Sends `sessions.abort` to Gateway.

---

#### `middleware_cron_list` / `middleware_cron_get_job`

**Response:** `{ jobs: []; job: null }`

---

#### *(default / unknown commands)*

Returns `{ ok: true }` — safe fallback so UI doesn't crash.

---

## 7. Data Models

### OCPlatformMessage

The generic message shape from Gateway. Flexible `Record<string, unknown>` with known fields:

```typescript
type OCPlatformMessage = Record<string, unknown> & {
  role?: string;                // "user" | "assistant" | "tool" | "tool_result" | "system"
  text?: string;                // plain text content
  content?: string | ContentBlock[];
  __openclaw?: {
    id?: string;                // message ID
    seq?: number;               // sequence number
    clientMessageId?: string;
    idempotencyKey?: string;
    runId?: string;
    gatewayId?: string;         // set after optimistic confirmation
    gatewaySeq?: number;
  };
  __clientOptimistic?: boolean; // true for optimistic messages not yet confirmed
  isOptimistic?: boolean;       // same flag
  createdAt?: string;
  messageId?: string;
  id?: string;
  runId?: string;
  gatewayRunId?: string;
  clientMessageId?: string;
  idempotencyKey?: string;
};

type ContentBlock = {
  type: "text" | "toolCall" | "tool_use" | string;
  text?: string;
  [key: string]: unknown;
};
```

### ProjectedMessage (SQLite)

```typescript
interface ProjectedMessage {
  sessionKey: string;
  openclawSeq: number;       // sequence number within session
  messageId: string | null;
  role: string | null;
  data: OCPlatformMessage;     // full message object
  updatedAtMs: number;
}
```

### ProjectionEvent

```typescript
interface ProjectionEvent {
  cursor: number;            // auto-increment primary key
  sessionKey: string | null;
  eventType: string;
  payload: unknown;
  createdAtMs: number;
}
```

### ProjectedRun

```typescript
type RunStatus = "queued" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted";

interface ProjectedRun {
  runId: string;                    // "run:{idempotencyKey}"
  sessionKey: string;
  clientMessageId: string | null;
  idempotencyKey: string | null;
  gatewayRunId: string | null;
  status: RunStatus;
  statusLabel: string | null;
  startedAtMs: number;
  finishedAtMs: number | null;
  error: unknown;
  updatedAtMs: number;
}
```

### ProjectedToolCall

```typescript
type ToolPhase = "start" | "calling" | "result" | "error";
type ToolStatus = "running" | "success" | "error";

interface ProjectedToolCall {
  toolCallId: string;
  sessionKey: string;
  runId: string | null;
  messageId: string | null;
  name: string;
  phase: ToolPhase;
  status: ToolStatus;
  argsMeta: unknown;         // { keys: string[] } or null
  resultMeta: unknown;       // { type: string; length?: number; keys?: string[] } or null
  startedAtMs: number;
  finishedAtMs: number | null;
  updatedAtMs: number;
}
```

### PatchPayload

```typescript
interface PatchPayload {
  cursor: number;
  type: string;              // event type (see §7.1)
  sessionKey: string | null;
  payload: unknown;          // canonicalPatchPayload shape
  createdAtMs: number;
}
```

### Canonical Patch Payload Shape

Every patch payload broadcast through the PatchBus uses this envelope:

```typescript
interface CanonicalPatchPayload {
  projectionVersion: 3;
  semanticType: string;        // see below
  sessionKey: string;
  
  // Run context (present when a run is associated)
  runId?: string;
  gatewayRunId?: string | null;
  clientMessageId?: string | null;
  idempotencyKey?: string | null;
  runStatus?: RunStatus;
  status?: string;             // legacy status
  statusLabel?: string | null;
  activeRun?: ActiveRunProjection | null;
  
  // Message context
  messageId?: string;
  
  // Tool context
  toolCallId?: string;
  toolCall?: ToolCallProjection;
  
  // Event-specific payload (spread)
  [key: string]: unknown;
}
```

### 7.1 Projection Event Types

| `eventType` | `semanticType` | Trigger |
|-------------|----------------|---------|
| `chat.message.upsert` | `chat.user.created` | Optimistic user message created |
| `chat.message.upsert` | `chat.assistant.final` | Final assistant message from Gateway |
| `chat.message.upsert` | `chat.message.upsert` | Generic message upsert |
| `chat.message.confirmed` | `chat.user.confirmed` | Optimistic user message confirmed by Gateway |
| `chat.status` | `chat.run.status` | Run status change (thinking) |
| `chat.status` | `chat.run.done` | Run completed |
| `chat.status` | `chat.run.error` | Run failed |
| `chat.status` | `chat.run.streaming` | Run is streaming |
| `chat.tool.started` | `chat.tool.started` | Tool call started |
| `chat.tool.result` | `chat.tool.result` | Tool call completed |
| `chat.tool.error` | `chat.tool.error` | Tool call failed |
| `chat.bootstrap` | — | Bootstrap snapshot completed |
| `session.upsert` | — | Session metadata changed |

---

## 8. Gateway Integration

The middleware communicates with the OCPlatform Gateway over a single persistent WebSocket connection using a request/response protocol.

### Authentication

1. Connect to WebSocket at `openclawGatewayUrl`
2. Receive `connect.challenge` event with `{ nonce: string }`
3. Send `connect` request with Ed25519 signature over `v3|deviceId|gateway-client|backend|operator|scopes|signedAt|token|nonce|desktop|`
4. Receive response with `ok: true`

### Gateway Request Format

```typescript
// Client → Gateway
{
  type: "req";
  id: string;        // UUID
  method: string;    // e.g. "sessions.create"
  params: Record<string, unknown>;
}

// Gateway → Client (response)
{
  type: "res";
  id: string;        // matches request
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

// Gateway → Client (event, unsolicited)
{
  type: "event";
  event: string;     // e.g. "session.message"
  payload?: unknown;
}
```

### Gateway Methods Used

#### `sessions.create`

Create or ensure a session exists.

```typescript
// params
{
  key: string;          // session key
  agentId: string;      // "main"
  label: string;        // "{chatName} · {shortId}"
}
```

**Fire-and-forget pattern:** Errors are swallowed — the session may already exist.

---

#### `chat.send`

Send a message to the agent.

```typescript
// params
{
  sessionKey: string;
  message: string;
  timeoutMs: number;
  idempotencyKey: string;
  attachments?: Array<{ type: "image"; fileName: string; mimeType: string; content: string }>;
}

// response payload
{
  status?: string;    // "done", "streaming", "accepted"
  runId?: string;     // Gateway run ID
}
```

---

#### `chat.history`

Fetch message history for a session.

```typescript
// params
{
  sessionKey: string;
  limit?: number;
  maxChars?: number;
}

// response payload
{
  sessionKey?: string;
  sessionId?: string;
  messages?: OCPlatformMessage[];
  status?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
}
```

---

#### `chat.abort`

Abort a running session.

```typescript
// params
{ sessionKey: string; runId?: string; }
```

---

#### `sessions.patch`

Patch session settings (e.g., model, exec policy).

```typescript
// params
{
  key: string;        // or sessionKey
  execSecurity?: "allowlist" | "full" | null;
  execAsk?: "off" | "on-miss" | "always" | null;
  model?: { primary: string };
}
```

---

#### `sessions.abort`

Abort a session (used by `middleware_chat_stop` command).

```typescript
// params
{ sessionKey: string; }
```

---

#### `sessions.messages.subscribe`

Subscribe to real-time message events for a session.

```typescript
// params
{ key: string; }  // session key
```

---

#### `exec.approval.resolve`

Resolve a tool approval request.

```typescript
// params
{ id: string; decision: "allow-once" | "allow-always" | "deny"; }
```

---

### Gateway Events Handled

| Event | Description |
|-------|-------------|
| `session.message` | New message from agent — ingested as projected message |
| `session.tool` | Tool call lifecycle event — ingested as tool call |
| `sessions.changed` | Session metadata changed — persisted and broadcast |
| `chat` / `chat.delta` / `chat.final` | Streaming/status events — update run status |

---

## 9. Frontend Integration Patterns

### Create a New Chat

```typescript
// 1. Create the chat
const { chat, session } = await fetch("/api/chats", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "My Chat", agentId: "main" })
}).then(r => r.json());

// 2. Connect to real-time updates
const ws = new WebSocket(`ws://localhost:8787/api/stream/ws?afterCursor=0`);
ws.onmessage = (event) => {
  const frame = JSON.parse(event.data);
  if (frame.type === "hello") {
    console.log("Connected, replaying", frame.replayCount, "patches");
  }
  if (frame.type === "patch") {
    handlePatch(frame.patch); // { cursor, type, sessionKey, payload, createdAtMs }
  }
};

// 3. Send a message
const idempotencyKey = `send_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const result = await fetch("/api/chat/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionKey: chat.sessionKey,
    text: "Hello, help me build something!",
    idempotencyKey,
    label: chat.name,
  })
}).then(r => r.json());
```

### Resume an Existing Chat

```typescript
// 1. Bootstrap to get full state
const bootstrap = await fetch(`/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}`)
  .then(r => r.json());

// bootstrap.messages — full message history
// bootstrap.cursor — use this for patch stream
// bootstrap.runStatus — current status ("idle", "thinking", "streaming", etc.)
// bootstrap.activeRun — non-null if agent is currently running
// bootstrap.tools — tool call state

// 2. Connect to real-time updates from the bootstrap cursor
const ws = new WebSocket(`ws://localhost:8787/api/stream/ws?afterCursor=${bootstrap.cursor}`);
```

### Real-Time Update Handling

```typescript
function handlePatch(patch: PatchPayload) {
  // Filter by session if needed
  if (patch.sessionKey !== mySessionKey) return;

  switch (patch.type) {
    case "chat.message.upsert":
      // New or updated message
      // patch.payload.message — the message object
      // patch.payload.optimistic — true if optimistic (not yet confirmed)
      upsertMessage(patch.payload.message);
      break;

    case "chat.message.confirmed":
      // Optimistic message confirmed by Gateway
      // patch.payload.optimisticId — original client message ID
      // patch.payload.gatewayMessageId — Gateway's ID
      confirmMessage(patch.payload.optimisticId, patch.payload.message);
      break;

    case "chat.status":
      // Run status changed
      // patch.payload.status — "thinking" | "streaming" | "done" | "error"
      // patch.payload.statusLabel — "Thinking" | "Streaming" | null
      // patch.payload.activeRun — run details or null
      updateSessionStatus(patch.payload);
      break;

    case "chat.tool.started":
      // Tool call started
      // patch.payload.toolCall — { toolCallId, name, phase, status, ... }
      addToolCall(patch.payload.toolCall);
      break;

    case "chat.tool.result":
    case "chat.tool.error":
      updateToolCall(patch.payload.toolCall);
      break;

    case "session.upsert":
      // Session metadata changed
      updateSessionMeta(patch.payload);
      break;
  }
}
```

### Stop a Running Chat

```typescript
// Option 1: v2 endpoint
await fetch("/api/chat/abort", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionKey, runId: activeRun?.runId })
});

// Option 2: Legacy command
await fetch("/api/commands/middleware_chat_stop", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: { sessionKey } })
});
```

### Switch Models

```typescript
// For a specific session
await fetch("/api/commands/middleware_chat_model_set", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: { sessionKey, modelId: "anthropic/claude-sonnet-4-20250514" } })
});

// Set global default
await fetch("/api/commands/middleware_models_set_default", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: { modelId: "anthropic/claude-opus-4-6" } })
});

// List available models
const { models, currentModel } = await fetch("/api/commands/middleware_models_list", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})
}).then(r => r.json());
```

### Resolve Tool Approvals

```typescript
await fetch("/api/exec/approval/resolve", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    approvalId: "approval_abc123",
    decision: "allow-once"  // or "allow-always" or "deny"
  })
});
```

### Send Message with Attachments

```typescript
await fetch("/api/chat/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionKey,
    text: "Here's the file I mentioned",
    idempotencyKey: `send_${Date.now()}`,
    attachments: [
      {
        name: "screenshot.png",
        mimeType: "image/png",
        content: "<base64-encoded-data>",
        encoding: "base64"
      },
      {
        name: "config.json",
        mimeType: "application/json",
        content: '{"key": "value"}',
        encoding: "utf-8",
        size: 16
      }
    ]
  })
});
```

**Attachment Processing:**
- **Images** (`image/*`): Sent as Gateway attachments (passed through to the agent). Also prepended as `[Attached image: name]` in message text.
- **Text files** (`text/*`, `application/json`, etc.): Embedded inline in the message as `<attached-file>` blocks (max 120K chars each, 300K total).
- **Other types**: Noted as unreadable `[Attached file: ...]` markers.

### Patch Recovery After Disconnect

```typescript
// On reconnect, check if patches were missed
const response = await fetch(`/api/patches?afterCursor=${lastKnownCursor}&limit=1000`)
  .then(r => r.json());

if (response.replayWindowExceeded) {
  // Too many patches missed — full bootstrap needed
  const bootstrap = await fetch(`/api/chat/bootstrap?sessionKey=${sessionKey}`)
    .then(r => r.json());
  // Reset state from bootstrap
} else {
  // Apply missed patches
  for (const patch of response.patches) {
    handlePatch(patch);
  }
  // Update cursor
  lastKnownCursor = response.latestCursor;
}
```

---

## Appendix: Send Queue

The `SessionSendQueue` serializes concurrent sends to the same session key. If multiple `POST /api/chat/send` requests arrive for the same session simultaneously, they execute sequentially (FIFO). This prevents race conditions in optimistic message creation and history reconciliation.

## Appendix: Message Normalization

The `message-normalizer` module strips Gateway-injected metadata from message text before comparison:
- Sender metadata blocks (`Sender (untrusted metadata): ...`)
- Timestamp prefixes (`[Mon 2026-05-12 10:55 UTC]`)
- Attachment markers (`[Attached images: ...]`, `[Attached audio: ...]`, `[Attached file: ...]`)
- `<attached-file>` XML blocks
- Bootstrap truncation warnings

This ensures optimistic message matching works even when the Gateway echoes back a decorated version of the original text.

## Appendix: SQLite Schema

```sql
CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE v2_sessions (
  session_key TEXT PRIMARY KEY,
  session_id TEXT,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE v2_messages (
  session_key TEXT NOT NULL,
  openclaw_seq INTEGER NOT NULL,
  message_id TEXT,
  role TEXT,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_key, openclaw_seq)
);

CREATE TABLE v2_runs (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  client_message_id TEXT,
  idempotency_key TEXT,
  gateway_run_id TEXT,
  status TEXT NOT NULL,
  status_label TEXT,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  error_json TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE v2_tool_calls (
  tool_call_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  run_id TEXT,
  message_id TEXT,
  name TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  args_meta_json TEXT,
  result_meta_json TEXT,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_key, tool_call_id)
);

CREATE TABLE v2_projection_events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE v2_gateway_offsets (
  session_key TEXT PRIMARY KEY,
  last_openclaw_seq INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

**Pragmas:** `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`
