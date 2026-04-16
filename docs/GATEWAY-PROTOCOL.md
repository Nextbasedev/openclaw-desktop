# GATEWAY-PROTOCOL.md — OpenClaw Gateway WebSocket Protocol

> Reverse-engineered from OpenClaw source (`src/gateway/`).
> Source cloned to `.openclaw-src/` for reference.

## Connection

**Transport:** WebSocket
**Default URL:** `ws://127.0.0.1:18789`
**Auth:** Token-based (in connect handshake)

### Handshake

Client sends `connect` params immediately after WS open:

```typescript
{
  minProtocol: 1,
  maxProtocol: PROTOCOL_VERSION,
  client: {
    id: string,           // unique client identifier
    displayName?: string, // "Jarvis Desktop"
    version: string,      // app version
    platform: string,     // "desktop-linux" | "desktop-macos" | "desktop-windows"
    deviceFamily?: string,
    mode: "control",      // "control" | "cli" | "node" | "tunnel"
  },
  auth: {
    token?: string,       // gateway token
  },
  caps: string[],         // capabilities: ["chat", "sessions"]
}
```

Server responds with `hello-ok`:

```typescript
{
  type: "hello-ok",
  protocol: number,
  server: { version: string, connId: string },
  features: {
    methods: string[],  // available RPC methods
    events: string[],   // subscribable events
  },
  snapshot: {
    presence: PresenceEntry[],
    health: any,
    stateVersion: { presence: number, health: number },
    uptimeMs: number,
    sessionDefaults: {
      defaultAgentId: string,
      mainKey: string,
      mainSessionKey: string,
    },
    authMode: "none" | "token" | "password" | "trusted-proxy",
  },
  policy: {
    maxPayload: number,
    maxBufferedBytes: number,
    tickIntervalMs: number,
  },
}
```

## Frame Types

All messages are JSON. Three frame types:

### Request (client → server)
```typescript
{ type: "req", id: string, method: string, params?: unknown }
```

### Response (server → client)
```typescript
{ type: "res", id: string, ok: boolean, payload?: unknown, error?: ErrorShape }
```

### Event (server → client, push)
```typescript
{ type: "event", event: string, payload?: unknown, seq?: number, stateVersion?: StateVersion }
```

## Chat Methods (Core for Jarvis)

### `chat.send` — Send a message
```typescript
params: {
  sessionKey: string,      // e.g. "dashboard:abc123"
  message: string,
  thinking?: string,       // thinking level
  attachments?: unknown[],
  timeoutMs?: number,
  idempotencyKey: string,  // dedup key
}
```

### `chat.history` — Get message history
```typescript
params: {
  sessionKey: string,
  limit?: number,    // max 1000
  maxChars?: number, // max 500_000
}
```

### `chat.abort` — Cancel running generation
```typescript
params: {
  sessionKey: string,
  runId?: string,    // specific run to abort
}
```

### Chat Events (push from server)
Event name: `"chat"` with ChatEvent payload:

```typescript
{
  runId: string,
  sessionKey: string,
  seq: number,           // sequence within this run
  state: "delta" | "final" | "aborted" | "error",
  message?: unknown,     // content blocks for delta/final
  errorMessage?: string,
  errorKind?: "refusal" | "timeout" | "rate_limit" | "context_length" | "unknown",
  usage?: unknown,       // token usage stats
  stopReason?: string,
}
```

**Streaming flow:**
1. Client sends `chat.send`
2. Server pushes `chat` events with `state: "delta"` (streaming tokens)
3. Final event has `state: "final"` with complete message + usage

## Session Methods

### `sessions.list` — List all sessions
```typescript
params: {
  limit?: number,
  activeMinutes?: number,
  includeDerivedTitles?: boolean,
  includeLastMessage?: boolean,
  label?: string,
  agentId?: string,
  search?: string,
}
```

### `sessions.create` — Create new session
```typescript
params: {
  key?: string,
  agentId?: string,
  label?: string,
  model?: string,
  task?: string,
  message?: string,
}
```

### `sessions.send` — Send to a session
```typescript
params: {
  key: string,
  message: string,
  thinking?: string,
  attachments?: unknown[],
  timeoutMs?: number,
}
```

### `sessions.abort` — Abort a session run
```typescript
params: { key: string, runId?: string }
```

### `sessions.reset` — Reset a session
```typescript
params: { key: string, reason?: "new" | "reset" }
```

### `sessions.delete` — Delete a session
```typescript
params: { key: string, deleteTranscript?: boolean }
```

### `sessions.patch` — Update session settings
```typescript
params: {
  key: string,
  model?: string,           // change model
  label?: string,
  thinkingLevel?: string,
  elevatedLevel?: string,
  execHost?: string,
  execSecurity?: string,
}
```

### `sessions.compact` — Compact session history
```typescript
params: { key: string, maxLines?: number }
```

### `sessions.messages.subscribe` — Subscribe to session events
```typescript
params: { key: string }
```

### `sessions.messages.unsubscribe`
```typescript
params: { key: string }
```

## Agent Methods

### `agents.list`
```typescript
params: {}
// Returns: list of agent summaries (id, name, status)
```

### `agent.wait` — Wait for agent to finish
```typescript
params: { ... }
```

## Model Methods

### `models.list` — List available models
```typescript
params: {}
// Returns: available models with pricing info
```

## Cron Methods

### `cron.list` — List cron jobs
### `cron.add` — Create cron job
### `cron.remove` — Delete cron job
### `cron.run` — Manually trigger a cron job
### `cron.status` — Get cron job status
### `cron.runs` — Get run history

## Skills Methods

### `skills.search` — Search ClawHub
### `skills.detail` — Get skill details
### `skills.install` — Install a skill
### `skills.update` — Update a skill
### `skills.status` — Get installed skills
### `skills.bins` — List skill binary assets

## Config Methods

### `config.get` — Read config value
### `config.set` — Write config value
### `config.patch` — Patch config
### `config.schema` — Get config schema
### `config.apply` — Apply config changes

## Exec Approval Methods (for supervised mode)

### `exec.approval.request` — Request approval for tool execution
### `exec.approval.resolve` — Approve or deny
### `exec.approval.list` — List pending approvals
### `exec.approvals.set` — Set approval policy

## Tool Methods

### `tools.catalog` — List available tools
### `tools.effective` — Get effective tools for a session

## Usage Methods

### `usage.cost` — Get cost data
### `usage.status` — Get usage status

## Logs

### `logs.tail` — Tail gateway logs
```typescript
params: {
  cursor?: number,
  limit?: number,    // max 5000
  maxBytes?: number, // max 1_000_000
}
```

## All Available Methods (93 total)

```
agent.identity.get, agents.create, agents.delete, agents.files.get,
agents.files.list, agents.files.set, agents.list, agents.update,
agent.wait, channels.logout, channels.status, chat.abort, chat.history,
chat.send, commands.list, config.apply, config.get, config.patch,
config.schema, config.schema.lookup, config.set, connect.challenge,
cron.add, cron.list, cron.remove, cron.run, cron.runs, cron.status,
cron.update, device.pair.*, device.token.*, doctor.memory.status,
exec.approval.*, gateway.identity.get, logs.tail, message.action,
models.list, node.*, plugin.approval.*, secrets.reload, secrets.resolve,
session.message, sessions.abort, sessions.changed, sessions.compact,
sessions.compaction.*, sessions.create, sessions.delete, sessions.list,
sessions.messages.subscribe, sessions.messages.unsubscribe, sessions.patch,
sessions.preview, sessions.reset, sessions.send, sessions.subscribe,
sessions.unsubscribe, session.tool, skills.*, talk.*, tools.catalog,
tools.effective, tts.*, update.run, usage.cost, usage.status,
voicewake.*, wizard.*
```

## Key Observations for Jarvis

1. **We can reuse the protocol directly** — no custom backend needed. Jarvis connects as a WebSocket client to the existing Gateway.

2. **Chat flow is simple:** `chat.send` → subscribe to `chat` events → render deltas → show final.

3. **Session management is built-in:** create, list, send, abort, reset, delete, compact.

4. **Exec approvals exist** — supervised mode is already supported at the protocol level.

5. **Skills/ClawHub integration** — search, install, update all available via WS methods.

6. **No file system API** — file browsing needs `agents.files.list` / `agents.files.get` / `agents.files.set` (agent workspace files only, not full filesystem).

7. **Token savings opportunity:** Use `sessions.compact` to manage context. Use `chat.history` with `maxChars` to limit initial load.

8. **Sub-agent events** — `sessions.subscribe` / `sessions.messages.subscribe` for watching child session activity. Session keys have parent references via `sessions.patch` (`spawnedBy` field).
