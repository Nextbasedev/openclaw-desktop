# API Routes Reference

Complete route inventory for the middleware service. All routes are registered in `apps/middleware/src/`.

## Core Chat Routes (`features/chat/routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/send` | Send user message (with optional attachments) |
| POST | `/api/chat/abort` | Abort current generation |
| GET | `/api/chat/bootstrap` | Fetch initial chat state (messages, status, tools) |
| GET | `/api/chat/messages` | Paginated message history (beforeSeq/afterSeq) |
| POST | `/api/exec/approval/resolve` | Resolve tool execution approval |

## Real-Time (`features/patches.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET (WS) | `/api/stream/ws` | WebSocket patch stream (primary real-time channel) |
| GET | `/api/patches` | HTTP backlog replay (afterCursor, limit) |

## System (`features/system/routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check (gateway status, uptime) |
| GET | `/api/system/info` | System info (port, DB path, gateway URL) |

## Gateway (`features/gateway/routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/gateway/status` | Gateway connection status |
| POST | `/api/gateway/reconnect` | Force gateway reconnection |

## Diagnostics (`features/diagnostics/routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/diagnostics` | Full system diagnostics (projection, live ingest, patch bus) |
| GET | `/api/logs` | Recent middleware log lines (memory buffer) |

## Skills (`features/skills/routes.ts`)

Proxies to ClawhHub (`https://skillhub.ai`) and local skill directories.

## Compat Layer (`features/compat/routes.ts`)

Legacy compatibility layer — ~4500 lines. Maps the old v1 API surface to v2 internals. This is the largest single file in the codebase.

### Data Management
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/version` | Version info |
| GET | `/api/bootstrap` | Legacy bootstrap (spaces, chats, projects, sessions) |
| GET/POST | `/api/spaces` | Space CRUD |
| PATCH/DELETE | `/api/spaces/:spaceId` | Space update/delete |
| GET/POST | `/api/chats` | Chat CRUD |
| PATCH/DELETE | `/api/chats/:chatId` | Chat update/delete |
| GET/POST | `/api/projects` | Project CRUD |
| GET/POST | `/api/topics` | Topic CRUD |
| GET/POST | `/api/sessions` | Session list/create |

### Git Operations
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/repos/recent` | Recent git repos |
| GET | `/api/repos/git/status` | Git status |
| GET | `/api/repos/git/diff` | Git diff |
| GET | `/api/repos/git/branches` | Branch list |
| POST | `/api/repos/git/checkout` | Branch checkout |
| GET | `/api/projects/:id/git/*` | Per-project git operations |

### Workspace File Operations
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspace/capabilities` | Read/write capability check |
| GET | `/api/workspace/tree` | Directory tree |
| GET | `/api/workspace/stat` | File/dir stat |
| GET/PUT/DELETE | `/api/workspace/file` | File read/write/delete |
| POST | `/api/workspace/mkdir` | Create directory |
| POST | `/api/workspace/move` | Move/rename file |
| GET | `/api/workspace/download` | Download file |
| * | `/api/projects/:id/workspace/*` | Per-project workspace ops |

### Terminal
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/terminal/spawn` | Spawn PTY session |
| POST | `/api/terminal/:ptyId/write` | Write to PTY |
| POST | `/api/terminal/:ptyId/resize` | Resize PTY |
| POST | `/api/terminal/:ptyId/kill` | Kill PTY |
| GET | `/api/terminal/:ptyId/stream` | SSE terminal stream |
| GET (WS) | `/api/terminal/:ptyId/ws` | WebSocket terminal stream |

### Streaming (Legacy)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/stream/cron` | Cron event stream (SSE) |
| GET | `/api/stream/chat/:sessionKey` | Per-session chat stream (SSE) |

### Migration
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/migration/telegram/scan` | Scan for Telegram sessions to import |
| POST | `/api/migration/telegram/import` | Import Telegram sessions |
| GET | `/api/migration/discord/scan` | Scan for Discord sessions to import |
| POST | `/api/migration/discord/import` | Import Discord sessions |
| POST | `/api/migration/v1-sqlite/import` | Import from v1 SQLite DB |

### Middleware Self-Update
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/middleware/update/status` | Update status |
| GET | `/api/middleware/update/branches` | Available update branches |
| POST | `/api/middleware/update` | Start self-update |

### Pairing
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/pairing/claim` | Claim pairing code |
| GET | `/pairing/local` | Local pairing info |

### Legacy Command Router
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/commands/:command` | Dispatches to ~40 `middleware_*` commands |

Commands include: `middleware_chat_send`, `middleware_chat_history`, `middleware_chat_regenerate`, `middleware_models_list`, `middleware_models_set_default`, `middleware_skills_*`, `middleware_pins_*`, `middleware_memory_*`, `middleware_usage*`, `middleware_voice_*`, `middleware_sync_pull_now`, `middleware_version_info`, `middleware_pty_spawn_workspace`, etc.
