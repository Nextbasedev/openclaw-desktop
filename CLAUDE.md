# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Jarvis is the OpenClaw Desktop app — a Tauri 2.0 (Rust) + Next.js 16 (React 19) native desktop client for interacting with OpenClaw agents. It connects to the OpenClaw Gateway over WebSocket (protocol v3, device-auth with ED25519 signatures).

## Monorepo Layout

pnpm workspaces with 4 packages:

- **`packages/ui`** — Next.js 16 frontend (static export mode, Turbopack dev). Path alias `@/*` maps to `./`.
- **`packages/desktop`** — Tauri 2.0 shell (Rust). Frameless window, IPC bridge, SQLite, keychain.
- **`packages/middleware`** — Gateway WebSocket client library (Node.js, no framework dependencies).
- **`packages/shared`** — Shared types and Zod validation schemas.

## Commands

```bash
pnpm install                    # install all workspace deps
pnpm dev                        # Next.js dev server on :3000 (Turbopack)
pnpm dev:tauri                  # full Tauri app (Rust backend + UI)
pnpm build                      # Next.js production build (static export to packages/ui/out)
pnpm build:tauri                # Tauri binary build
pnpm lint                       # ESLint across all packages
pnpm lint:architecture          # custom linter: layer direction, domain isolation, file size, naming
pnpm test                       # vitest across all packages
pnpm typecheck                  # tsc --noEmit across all packages
pnpm sandbox:verify             # agent-browser UI verification
```

Run a single test file: `cd packages/shared && npx vitest run src/path/to/file.test.ts`

## Architecture

Read `docs/ARCHITECTURE.md` before modifying domain code. Key rules enforced by `scripts/lint-architecture.ts`:

**Layer model** — every domain follows strict one-directional dependencies:
```
Types → Config → Store → Service → Runtime → UI
```
No backward imports. Types cannot import from Config; Service cannot import from UI, etc.

**Domain isolation** — domains under `packages/ui/src/domains/` cannot import from each other directly. Cross-domain state must go through Providers (`packages/ui/src/providers/`).

**File size limit** — 300 lines max per file.

**No `any`** — strict TypeScript, use `unknown` + type guards instead.

**File naming conventions:**
```
domains/<domain>/
  types/index.ts
  config/index.ts
  store/atoms.ts, selectors.ts
  service/<name>.service.ts
  runtime/<name>.runtime.ts
  ui/components/<Name>.tsx    (PascalCase)
  ui/hooks/use<Name>.ts      (camelCase with use prefix)
  ui/pages/<Name>Page.tsx
```

## Cross-Cutting Providers

Auth, WebSocket, IPC, Theme, and Navigation are shared via React context providers at the app root. These are the **only** mechanism for cross-domain communication.

## Gateway Protocol

The middleware package (`packages/middleware/src/index.ts`) implements the OpenClaw Gateway WebSocket protocol:
- `connectToOpenClawGateway()` — authenticated WS connection (challenge-response with ED25519)
- `createChatSession()` / `deleteChatSession()` — session lifecycle
- `sendChatMessage()` — send user message
- `openChatEventStream()` — subscribe to streaming events (`chat.ready`, `chat.status`, `chat.message`, `chat.tool`, `chat.error`)

Gateway config is read from `~/.openclaw/openclaw.json`; device identity from `~/.openclaw/state/identity/device.json`.

## UI Stack

- React 19 + Next.js 16 (static export, no SSR in production)
- shadcn/ui (radix-vega style, HugeIcons, zinc base color) — components are copy-pasted into `packages/ui/components/ui/`
- Tailwind CSS 4 with `cn()` utility from `@/lib/utils`
- Jotai for state management (atomic, per-domain atoms)
- Prettier: no semicolons, double quotes, 80-char width, Tailwind class sorting

## Tauri / Rust

Rust source lives in `packages/desktop/src-tauri/`. The Tauri config builds the UI from `packages/ui/out` (static export). Dev mode proxies to `localhost:3000`.

IPC pattern: UI calls `window.__TAURI__.core.invoke(command, args)` → Rust handler responds.

## Key Design Decisions

See `docs/DECISIONS.md` for full ADRs. Notable:
- Tauri over Electron (10x smaller binary, OS webview, Rust safety)
- Agent-first development — all code is agent-generated, humans steer
- Parse external data at boundary with Zod validation
- `chrome-devtools-axi` for agent-driven visual testing

## Docs

- `AGENTS.md` — project map and agent instructions
- `SPEC.md` — full feature spec (137 items, P0-P2)
- `docs/ARCHITECTURE.md` — domain map, layer model, data flow
- `docs/DECISIONS.md` — ADRs
- `docs/GATEWAY-PROTOCOL.md` — WebSocket protocol reference
- `docs/designs/` — per-feature design docs
