# Backend & Middleware — Quick Guide

---

## Two Pieces

**Server** (`packages/server/`) — Express.js on port 3001. Stores data in SQLite, runs 33 services, exposes 266 commands. This is the brain.

**Middleware** (`packages/middleware/`) — One file (969 lines). A WebSocket client library the server imports to talk to the remote OpenClaw Gateway (port 18789). This is the phone line.

```
Caller  →  Server (port 3001)  →  Middleware  →  Gateway (port 18789, cloud)
               ↕                                        ↕
          Local SQLite                            AI agents run here
```

---

## How Commands Work

Every operation hits one endpoint: `POST /api/ipc/{command_name}`

```
Request comes in: /api/ipc/middleware_chat_send
  → handler.ts looks up "middleware_chat_send" in registry.ts
  → registry.ts maps it to chatSend() function in chat.service.ts
  → function runs, returns result as JSON
```

Registry is just a big lookup table — 266 command names mapped to functions across 33 service files.

---

## How Chat Works (The Core Flow)

```
1. RESOLVE SESSION
   Local key "sess_abc" → look up gateway key "gw_xyz"
   If first message: create gateway session via middleware, save mapping

2. OPEN EVENT STREAM
   Middleware subscribes to gateway session via WebSocket
   Every gateway event gets forwarded to an internal EventEmitter

3. SEND MESSAGE
   Middleware sends text to gateway over WebSocket
   Gateway starts the AI

4. STREAM RESPONSE
   Gateway pushes events back through WebSocket:
     status: thinking → streaming → done
     message: token by token
     tool: start → progress → result (if AI uses tools)
     agent: spawn → finish (if AI creates subagents)

5. DELIVER TO CALLER
   Events flow: Gateway → WebSocket → Middleware → EventEmitter → SSE stream
   SSE endpoint: GET /api/stream/chat/{sessionKey}
```

---

## How Authentication Works

Middleware uses ED25519 key-pair auth (like SSH):

```
1. Open WebSocket to gateway
2. Gateway sends random nonce
3. Middleware builds payload string: "v3|deviceId|clientId|scopes|nonce|..."
4. Signs it with private key (from ~/.openclaw/state/identity/device.json)
5. Sends signature + public key to gateway
6. Gateway verifies → connection established
```

---

## What the Server Stores (SQLite)

Path: `~/.jarvis/openclaw-desktop/jarvis.db`

| Table | Purpose |
|-------|---------|
| `profiles` | Connections to OpenClaw instances |
| `projects` | Workspaces (name, folder path) |
| `topics` | Threads within projects |
| `session_mappings` | Local key → gateway key mapping |
| `chats` | Conversations (name, linked session) |
| `branches` | Fork points in conversations |
| `app_settings` | Key-value config (tokens, preferences) |
| `sync_outbox` | Pending changes to push to cloud |
| `sync_tombstones` | Deletion records for cross-device sync |

---

## What Each Service Does

### Gateway-Dependent (need middleware)

| Service | Job |
|---------|-----|
| `chat.service` | Send messages, stream responses, manage chat sessions |
| `cron.service` | Create/run/pause scheduled jobs on gateway |
| `models.service` | List available AI models, set default |
| `usage.service` | Token/cost tracking from gateway |
| `skills-gateway.service` | Skills installed on gateway |
| `sync (engine + 5 files)` | Push local changes every 2s, pull cloud changes every 30s |

### Local-Only (no gateway needed)

| Service | Job |
|---------|-----|
| `sessions.service` | CRUD for local session mappings |
| `projects.service` | CRUD for workspaces |
| `topics.service` | CRUD for conversation threads |
| `chats.service` | CRUD for conversations |
| `branches.service` | Fork conversations at any message |
| `profiles.service` | Manage OpenClaw connections + tokens |
| `terminal.service` | Spawn shell sessions (max 20), stream output via SSE |
| `pty.service` | One-off command execution |
| `files.service` | Read/write files within project (sandboxed) |
| `fs.service` | Read/write files anywhere (no sandbox) |
| `git.service` | Branch switch, status, commit details |
| `memory.service` | Store/search knowledge as markdown files |
| `skills-local.ts` | Scan local skills from ~/.openclaw/skills/ |
| `onboarding.service` | First-time setup: generate keys, configure gateway |
| `connect.service` | Gateway health checks and diagnostics |

---

## Sync in 30 Seconds

Sync uses gateway sessions as transport — payloads are encoded into session labels.

```
Every 2s:  Find dirty rows → encode as payload → upsert gateway session
Every 30s: List gateway sessions → decode payloads → merge into local DB
First run: Backfill all local data to gateway
```

---

## When Gateway Is Down

| Works | Broken |
|-------|--------|
| All local DB operations | Chat send/stream |
| Projects, topics, chats, branches | Cron jobs |
| Files, git, terminal | Model listing |
| Memory, local skills | Sync (pauses, retries later) |
| Profiles, settings | Gateway skills, usage data |

Server starts fine without gateway. Reconnects automatically with exponential backoff (3s → 6s → 12s → ... → 30s cap).
