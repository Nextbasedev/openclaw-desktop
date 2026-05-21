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
| Middleware body limit | 25 MB | `apps/middleware/src/app.ts` |
| UI attachment max (single) | 10 MB | `packages/ui/lib/chatAttachments.ts` |
| UI attachment max (total) | 10 MB | `packages/ui/lib/chatAttachments.ts` |
| UI attachment max count | 10 files | `packages/ui/lib/chatAttachments.ts` |
| Embedded text attachment cap | 120K chars | `apps/middleware/src/features/chat/attachments.ts` |
| Total embedded text cap | 300K chars | `apps/middleware/src/features/chat/attachments.ts` |
| Middleware default port | 8787 | `apps/middleware/src/config/env.ts` |
| Gateway protocol version | 3 | `apps/middleware/src/features/gateway/client.ts` |
| Clawhub skill timeout | 15s | `apps/middleware/src/features/skills/service.ts` |
| Log buffer limit | 1000 lines | `apps/middleware/src/lib/logger.ts` |
| Chat history fetch limit | 200 messages | `apps/middleware/src/features/chat/routes.ts` |
| Default chat send timeout | 120s | `apps/middleware/src/features/chat/routes.ts` |

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

## Further Reading

- `docs/constraints/` — Domain-specific constraint files
- `docs/lessons/` — Post-incident learnings
- `docs/archive/` — Historical documentation (preserved for reference)
- `CLAUDE.md` — Claude Code specific guidance
- `SPEC.md` — Full feature specification
