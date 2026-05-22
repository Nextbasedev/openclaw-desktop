# AGENTS.md — OCPlatform Desktop

> Structured knowledge base for AI-assisted development. Read this first before writing any code.

## Project Overview

OCPlatform Desktop is a Tauri 2.0 + Next.js 16 native desktop client for interacting with OCPlatform agents. Users chat with AI agents through a local middleware that bridges the UI to the remote OCPlatform Gateway over WebSocket.

**Year:** 2026  
**Monorepo:** pnpm workspaces  
**Language:** TypeScript (UI + middleware), Rust (Tauri shell)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                                      │
│  └─ packages/desktop/src-tauri/                          │
│     Frameless window, IPC bridge, native chrome          │
├──────────────────────────────────────────────────────────┤
│  Next.js 16 UI (React 19)                                │
│  └─ packages/ui/                                         │
│     Static export, Turbopack dev, Jotai state            │
│     Path alias: @/* → ./                                 │
├──────────────────────────────────────────────────────────┤
│  Middleware (Fastify)                         Port 8787  │
│  └─ apps/middleware/                                     │
│     SQLite (better-sqlite3), patch bus, message          │
│     projection, session management, skill proxy          │
├──────────────────────────────────────────────────────────┤
│  OpenClaw Gateway (remote)                    WebSocket  │
│  └─ Protocol v3, Ed25519 device auth                     │
│     Events: session.message, session.tool,               │
│     sessions.changed, chat.event, agent.event            │
└──────────────────────────────────────────────────────────┘
```

### Request Flow

1. User types message in ChatBox composer
2. UI calls `sendChatV2()` → `POST /api/chat/send` (middleware)
3. Middleware validates, creates optimistic message + status patches
4. Middleware forwards to Gateway `chat.send` via WebSocket
5. Gateway streams responses as events → middleware projects into patches
6. UI receives patches via WebSocket `/api/stream/ws` → updates chat state

### Repository Layout

```
├── AGENTS.md                    ← You are here
├── CLAUDE.md                    ← Claude Code specific guidance
├── SPEC.md                      ← Feature spec
│
├── apps/
│   └── middleware/              ← Fastify middleware service
│       ├── src/
│       │   ├── app.ts           ← Fastify setup, body limits, CORS
│       │   ├── config/env.ts    ← Environment config (host, port, DB path)
│       │   ├── db/              ← SQLite migrations
│       │   ├── features/
│       │   │   ├── chat/        ← Core: routes, attachments, live ingest,
│       │   │   │                   message repo, run repo, send queue
│       │   │   ├── compat/      ← Legacy API compatibility layer
│       │   │   ├── gateway/     ← WebSocket client to OCPlatform Gateway
│       │   │   ├── patches.ts   ← Patch bus (real-time UI updates)
│       │   │   ├── skills/      ← Skill proxy (ClawhubService)
│       │   │   ├── system/      ← Health, info, pairing routes
│       │   │   └── diagnostics/ ← Debug endpoints
│       │   └── lib/             ← Logger, errors, utilities
│       └── tests/               ← Vitest test suites
│
├── packages/
│   ├── ui/                      ← Next.js 16 frontend
│   │   ├── components/
│   │   │   ├── ChatView/        ← Message list, scroll, rich content
│   │   │   ├── ChatBox/         ← Composer, attachments, slash commands
│   │   │   └── AppPage.tsx      ← Main app shell
│   │   ├── hooks/
│   │   │   ├── useChatMessages.ts  ← Chat state, send, bootstrap, streaming
│   │   │   └── useChatComposerAttachments.ts
│   │   └── lib/
│   │       ├── chat-engine-v2/  ← Patch stream client, bootstrap, store
│   │       ├── chatAttachments.ts  ← File encoding, limits, MIME types
│   │       ├── chatMessageDedupe.ts ← Message deduplication
│   │       └── chatHistoryParser.ts ← Gateway history normalization
│   │
│   ├── desktop/                 ← Tauri 2.0 Rust shell
│   │   └── src-tauri/
│   ├── middleware/              ← Legacy Gateway WebSocket client (deprecated)
│   └── shared/                  ← Shared Zod schemas and types
│
├── docs/
│   ├── constraints/             ← Domain constraint files (for AI agents)
│   ├── lessons/                 ← Post-incident learnings
│   ├── skills/                  ← Skill definitions
│   └── archive/                 ← Historical docs (preserved, not authoritative)
│
└── scripts/                     ← Build tools, linters, sandbox tests
```

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop shell | Tauri (Rust) | 2.x |
| UI framework | Next.js + React | 16.x / 19.x |
| Language | TypeScript | 5.9.x |
| Styling | Tailwind CSS | v4 |
| UI primitives | shadcn/ui + Radix | — |
| State | Jotai | 2.x |
| Middleware | Fastify | 5.x |
| Database | SQLite (better-sqlite3) | 11.x |
| Gateway protocol | WebSocket v3 | Ed25519 auth |

## Key Invariants

These rules MUST be true at all times. Violating them causes bugs.

1. **Message ordering uses `openclaw_seq`** — Messages are ordered by `openclaw_seq` within segments. Never sort by timestamp alone; gateway timestamps can be inconsistent.

2. **Optimistic messages must be confirmed or failed** — Every optimistic user message gets a `chat.message.confirmed` patch when gateway echoes it back, or a `sendStatus: "failed"` when the send fails. Never leave orphaned optimistic messages.

3. **Scroll-to-bottom only on user intent or initial open** — First chat open scrolls to latest. Live assistant updates follow only when user is already near bottom. User scroll-up must be preserved. See `docs/constraints/ui-scroll.md`.

4. **Per-window layout isolation** — Each Tauri/browser window has a unique `openclawWindowId`. Layout cache keys are scoped per window. Main window uses stable `"main"` scope with legacy fallback.

5. **Session sync preserves local-only sessions** — Gateway session sync must never delete imported, manual, local, or desktop-created sessions. Only stale gateway-only sessions are cleaned up.

6. **Middleware body limit is 25 MB** — `MIDDLEWARE_BODY_LIMIT_BYTES` in `apps/middleware/src/app.ts`. UI allows 10 MB attachments; base64 + JSON overhead requires the higher middleware limit.

7. **Patch bus is the single source of UI truth** — All chat state changes flow through projection events → patch bus → WebSocket → UI. Direct state mutations outside this flow cause desync.

8. **Tool call lifecycle is run-scoped** — Tool calls belong to a specific `runId`. Bootstrap must not adopt old detached tool rows into a new run.

9. **Gateway events drive status, not send response** — Gateway `chat.send` returning "done" does not mean the UI should show done. Wait for the assistant message to appear in history before broadcasting completion.

10. **Warm cache is a bounded preview, not source of truth** — `setWarmChatCache` stores only recent messages for fast paint on reopen. The middleware V2 projection is the authoritative chat source.

## System Constraints Quick Reference

| Constraint | Value | Location |
|-----------|-------|----------|
| Middleware body limit | 25 MB | `MIDDLEWARE_BODY_LIMIT_BYTES` in `apps/middleware/src/app.ts` |
| UI attachment max (single) | 10 MB | `CHAT_ATTACHMENT_LIMITS.maxSingleBytes` in `packages/ui/lib/chatAttachments.ts` |
| UI attachment max (total) | 10 MB | `CHAT_ATTACHMENT_LIMITS.maxTotalBytes` in `packages/ui/lib/chatAttachments.ts` |
| UI attachment max count | 10 files | `CHAT_ATTACHMENT_LIMITS.maxCount` in `packages/ui/lib/chatAttachments.ts` |
| Embedded text attachment cap | 120K chars | `MAX_EMBEDDED_ATTACHMENT_CHARS` in `apps/middleware/src/features/chat/attachments.ts` |
| Total embedded text cap | 300K chars | `MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS` in `apps/middleware/src/features/chat/attachments.ts` |
| Middleware default port | 8787 | `apps/middleware/src/config/env.ts` (env: `MIDDLEWARE_PORT` or `PORT`) |
| Gateway protocol version | 3 | `PROTOCOL_VERSION` in `apps/middleware/src/features/gateway/client.ts` |
| Gateway default request timeout | 30s | `apps/middleware/src/features/gateway/client.ts` |
| Chat send timeout | 120s | `apps/middleware/src/features/chat/routes.ts` |
| Chat send gateway call timeout | 130s | Send timeout + 10s buffer |
| Clawhub skill timeout | 15s | `CLAWHUB_TIMEOUT_MS` in `apps/middleware/src/features/skills/service.ts` |
| Clawhub cache TTL | 30s | `CACHE_TTL_MS` in `apps/middleware/src/features/skills/service.ts` |
| Log buffer limit | 1000 lines | `LOG_BUFFER_LIMIT` in `apps/middleware/src/lib/logger.ts` |
| Chat history fetch limit | 200 messages | `apps/middleware/src/features/chat/routes.ts` |
| Stale active run timeout | 10 min | `DEFAULT_STALE_ACTIVE_RUN_MS` in `apps/middleware/src/features/chat/repo.runs.ts` |
| Stale running tool timeout | 30 min | `DEFAULT_STALE_RUNNING_TOOL_MS` in `apps/middleware/src/features/chat/repo.runs.ts` |
| Stale detached tool timeout | 5 min | `STALE_DETACHED_TOOL_MS` in `apps/middleware/src/features/chat/repo.runs.ts` |
| Stale bootstrap run age | 5 min | `STALE_BOOTSTRAP_RUN_MS` in `apps/middleware/src/features/chat/routes.ts` |
| Stale bootstrap tool age | 30 min | `STALE_BOOTSTRAP_TOOL_MS` in `apps/middleware/src/features/chat/routes.ts` |
| Chat projection version | 3 | `CHAT_PROJECTION_VERSION` in `apps/middleware/src/features/chat/projection.ts` |
| DB schema version | 2 | `SCHEMA_VERSION` in `apps/middleware/src/db/migrate.ts` |
| Middleware update stale timeout | 5 min | `UPDATE_ACTIVE_STALE_MS` in `apps/middleware/src/features/compat/routes.ts` |
| Min valid timestamp | 1,700,000,000,000 ms | `MIN_REAL_TIMESTAMP_MS` in `apps/middleware/src/features/chat/routes.ts` |
| Tauri window default size | 1400×900 (min 900×600) | `packages/desktop/src-tauri/tauri.conf.json` |
| Tauri app identifier | `ai.openclaw.jarvis` | `packages/desktop/src-tauri/tauri.conf.json` |

## Database Schema

SQLite database managed by `apps/middleware/src/db/migrate.ts`. Schema version: 2.

| Table | Primary Key | Purpose |
|-------|-------------|----------|
| `v2_meta` | `key` | Key-value metadata (schema version) |
| `v2_sessions` | `session_key` | Session state (data JSON, timestamps) |
| `v2_chat_segments` | `segment_id` | Chat history segments (base_seq, session_file, active flag) |
| `v2_messages` | `(session_key, openclaw_seq)` | Projected messages (role, data JSON, segment_id) |
| `v2_archive_imports` | `(session_key, file_path)` | Tracks imported archive files to avoid re-import |
| `v2_runs` | `run_id` | Agent run lifecycle (status, gateway_run_id, timing) |
| `v2_tool_calls` | `(session_key, tool_call_id)` | Tool call lifecycle (phase, status, args/result meta) |
| `v2_projection_events` | `cursor` (autoincrement) | Patch bus event log for replay |
| `v2_gateway_offsets` | `session_key` | Tracks last projected seq per session |
| `v2_compat_state` | `key` | Legacy compat layer state |

Migrations run automatically on startup. Schema includes column backfill for `segment_id` and `gateway_seq` on legacy messages.

## API Surface

Full route inventory: `docs/constraints/api-routes.md`

Key routes:
- `POST /api/chat/send` — Send message (core flow)
- `GET /api/chat/bootstrap` — Initial chat state
- `GET /api/chat/messages` — Paginated history
- `WS /api/stream/ws` — Real-time patch stream
- `GET /health` — Health check
- `POST /api/commands/:command` — Legacy command router (~40 commands)

The compat layer (`features/compat/routes.ts`, ~4500 lines) maps the v1 API surface to v2. It handles spaces, chats, projects, topics, sessions, git ops, workspace file ops, terminal PTY, migrations, and self-update.

## Code Patterns

### Error handling
```typescript
// Middleware: use HttpError for structured API errors
throw new HttpError(400, "message is required", "BAD_REQUEST");

// Payload too large → automatic PAYLOAD_TOO_LARGE response via error handler
// UI: catch in sendChatV2, surface via setErrorMessage / setComposerError
```

### Optimistic message lifecycle
```
User clicks Send
  → Create optimistic message (isOptimistic: true, sendStatus: "sending")
  → Broadcast chat.message.upsert patch (optimistic: true)
  → POST /api/chat/send to middleware
  → Middleware forwards to Gateway chat.send
  → Gateway echoes user message in chat.history
  → Middleware broadcasts chat.message.confirmed patch
  → UI removes optimistic flag
  
On error:
  → Set sendStatus: "failed", sendError: message
  → User can retry via onRetrySend
```

### Adding a new middleware route
1. Define Zod schema for request body
2. Add route in the appropriate `features/*/routes.ts`
3. Use `context.gateway.request()` to call Gateway
4. Broadcast projection events via `context.patchBus`
5. Add tests in `apps/middleware/tests/`

### Adding UI state
1. Use Jotai atoms for global state, React state for component-local
2. Chat state flows through `useChatMessages` hook
3. Patches update state via `chat-engine-v2/applyPatches.ts`

## Anti-Patterns

1. **❌ Sorting messages by timestamp** — Use `openclaw_seq`. Timestamps from gateway can be inconsistent across segments.

2. **❌ Force-scrolling on every assistant update** — Causes bounce/jank. Only follow-scroll when user is already near bottom.

3. **❌ Shared layout cache across windows** — Causes cross-window chat bleed. Always scope by `openclawWindowId`.

4. **❌ Broadcasting "done" from Gateway send response** — Gateway returns "done" before the assistant message is in history. Wait for history confirmation.

5. **❌ Deleting sessions during sync** — Gateway sync must preserve imported/manual/local sessions. Only clean stale gateway-only sessions.

6. **❌ Adopting old tool calls into new runs** — Creates ghost tool cards. Check `startedAtMs` gap before associating.

7. **❌ Reading warm cache as authoritative** — It's a bounded preview. Always prefer middleware projection data.

8. **❌ Using `--break-system-packages` for pip** — Use venv or apt install instead.

9. **❌ Hardcoding limits in error messages** — Import the constant (e.g., `MIDDLEWARE_BODY_LIMIT_BYTES`) instead of duplicating values.

10. **❌ Testing on real users/channels** — Always use test channels, test users, or dry-run mode first.

## Commands

```bash
pnpm install                              # install all deps
pnpm dev                                  # Next.js dev (Turbopack, :3000)
pnpm dev:tauri                            # full Tauri app
pnpm build                                # Next.js static export
pnpm build:tauri                          # Tauri binary build
pnpm lint                                 # ESLint all packages
pnpm test                                 # vitest all packages
pnpm typecheck                            # tsc --noEmit all packages

# Package-specific
pnpm --filter ui typecheck                # UI type check
pnpm --filter ui build                    # UI build
pnpm --filter @openclaw/desktop-middleware test -- --runInBand  # middleware tests
pnpm --filter @openclaw/desktop-middleware typecheck            # middleware types
```

## Testing & Deployment

- **Unit tests:** Vitest, co-located in packages (e.g., `apps/middleware/tests/`)
- **Type checking:** `tsc --noEmit` per package
- **Build verification:** `pnpm --filter ui build` (static export)
- **Before pushing:** Always run typecheck + build for changed packages
- **PR workflow:** Create branch → implement → typecheck → build → test → push → create PR

## Key Libraries & Modules

### UI (`packages/ui/lib/`)
| Module | Purpose |
|--------|---------|
| `chat-engine-v2/client.ts` | Middleware fetch client (sendChatV2, fetchBootstrap, openPatchStream) |
| `chat-engine-v2/applyPatches.ts` | Patch → state reducer |
| `chat-engine-v2/store.ts` | Centralized chat state store |
| `chat-engine-v2/types.ts` | RunStatus, ToolCallProjection, ChatBootstrap types |
| `chatAttachments.ts` | File encoding, MIME detection, size limits |
| `chatMessageDedupe.ts` | Message deduplication and merge logic |
| `chatHistoryParser.ts` | Gateway history → ChatMessage normalization |
| `chatAttachmentPreview.ts` | Attachment display helpers (kind, label, URL) |
| `chatSessionStore.ts` | Global session cache (warm cache, bootstrap cache) |
| `chatActivityStore.ts` | Optimistic activity tracking |
| `composerState.ts` | Composer state machine (idle, sending, pending) |
| `openRouteWindow.ts` | Multi-window route opening with windowId tagging |
| `workspaceLayoutPersistence.ts` | Per-window layout cache |
| `persistentCache.ts` | IndexedDB-backed persistent cache |
| `middleware-client.ts` | Middleware connection management |
| `clientLogs.ts` | Frontend structured logging with redaction |
| `events.ts` | Event emitter for cross-component communication |
| `ipc.ts` | Tauri IPC bridge |

### UI Components (`packages/ui/components/`)
| Component | Purpose |
|-----------|---------|
| `AppPage.tsx` | Main app shell, routing, global state |
| `ChatView/` | Message list, scroll behavior, rich content preview |
| `ChatBox/` | Composer, attachments, slash commands, voice input |
| `sidebar/` | Navigation sidebar |
| `connect/` | Gateway connection UI |
| `settings/` | Settings pages |
| `terminal/` | Terminal emulator |
| `inspector/` | Message/run inspector |
| `SkillPage/` | Skill browser/installer |
| `TopicView/` | Topic management |
| `onboarding/` | First-run onboarding |

### UI Hooks (`packages/ui/hooks/`)
| Hook | Purpose |
|------|---------|
| `useChatMessages.ts` | Core chat state (send, bootstrap, streaming, status) |
| `useChatComposerAttachments.ts` | File selection, encoding, validation |
| `useModels.ts` | Model list and selection |
| `useSlashCommands.ts` | Slash command discovery and execution |
| `useVoiceInput.ts` / `useVoiceRecorder.ts` | Voice recording and transcription |
| `useSubagentMessages.ts` | Subagent message tracking |
| `useAppShortcuts.ts` | Global keyboard shortcuts |

### Middleware Features (`apps/middleware/src/features/`)
| Feature | Key Files | Purpose |
|---------|-----------|---------|
| `chat/` | routes, live, attachments, repo.messages, repo.runs, send-queue, projection | Core chat pipeline |
| `compat/` | routes (~4500 lines) | Legacy v1 API compatibility |
| `gateway/` | client, routes | WebSocket connection to OCPlatform Gateway |
| `patches.ts` | — | Patch bus (broadcast + HTTP replay) |
| `skills/` | service, routes | ClawhHub proxy + local skill management |
| `system/` | routes | Health + info endpoints |
| `diagnostics/` | routes | Debug endpoints (logs, projection state) |

## Identity & Config

- **Product name:** OCPlatform (display), Jarvis (internal codename)
- **Tauri identifier:** `ai.openclaw.jarvis`
- **Tauri window:** frameless, 1400×900 default, 900×600 minimum, maximized on start
- **Tauri frontend:** static export from `packages/ui/out`
- **Middleware bundles with Tauri:** `bundled/middleware/**/*`
- **Auto-updater:** enabled, pulls from GitHub releases
- **Gateway identity:** Ed25519 keypair stored at `~/.openclaw/middleware/identity.json` (or CLI's `~/.openclaw/state/identity/device.json`)
- **ClawhHub:** `https://skillhub.ai` (skill marketplace)
- **Update repo:** `https://github.com/Nextbasedev/openclaw-desktop.git`

## Further Reading

- `docs/constraints/` — Domain-specific constraint files
  - `api-routes.md` — Complete route inventory
  - `middleware.md` — Body limits, send pipeline, patch bus, timeouts
  - `chat-engine.md` — Message ordering, dedup, history, streaming
  - `ui-scroll.md` — Scroll behavior rules
  - `sessions.md` — Session types, sync, window isolation
  - `gateway.md` — Protocol, requests, events
- `docs/lessons/` — Post-incident learnings
- `docs/archive/` — Historical documentation (preserved for reference)
- `CLAUDE.md` — Claude Code specific guidance
- `SPEC.md` — Full feature specification
