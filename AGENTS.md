# AGENTS.md — Jarvis (OpenClaw Desktop)

> A factual map for AI coding agents. Read this first. Every claim below is derived from the actual project files.

## Project Overview

Jarvis is the official OpenClaw Desktop app — a Tauri 2.0 + Next.js 16 native desktop client for interacting with OpenClaw agents. It presents two UI modes: **Simple** (clean chat) and **Mission Control** (full observability dashboard).

The app talks to a local Express backend (`packages/server`) which bridges to the remote OpenClaw Gateway over WebSocket. A standalone WebSocket client library (`packages/middleware`) implements the Gateway protocol (challenge-response auth with Ed25519 signatures). Shared Zod schemas (`packages/shared`) enforce type-safe API boundaries across the stack.

## Repository Layout

```
├── AGENTS.md                    ← You are here
├── SPEC.md                      ← Feature spec (137 items, P0–P2)
├── package.json                 ← Root scripts & engine requirements
├── pnpm-workspace.yaml          ← pnpm workspace definition
│
├── packages/
│   ├── ui/                      ← Next.js 16 + React 19 UI (no src/ folder)
│   ├── desktop/                 ← Tauri 2.0 Rust shell
│   │   └── src-tauri/           ← Cargo project, Rust source, tauri.conf.json
│   ├── server/                  ← Express.js local backend + SQLite
│   ├── shared/                  ← Shared types & Zod API contracts
│   └── middleware/              ← OpenClaw Gateway WebSocket client (zero deps)
│
├── scripts/
│   ├── lint-architecture.ts     ← Custom architectural boundary linter
│   ├── live-reasoning-check.ts  ← Live Gateway integration test
│   ├── raw-gateway-reasoning-check.ts
│   ├── rebuild-sqlite.bat       ← Windows native module rebuild helper
│   ├── run-tauri.cjs            ← PATH-aware Tauri CLI wrapper
│   ├── run-ui-dev.cjs           ← Prevents duplicate Next.js dev servers
│   └── sandbox/                 ← Build verification, AXI UI tests, git worktrees
│
└── docs/
    ├── ARCHITECTURE.md          ← Domain map, 6-layer model, dependency rules
    ├── QUALITY.md               ← Per-domain quality grades (all F currently)
    ├── DECISIONS.md             ← Architecture Decision Records
    ├── GATEWAY-PROTOCOL.md      ← Reverse-engineered WebSocket protocol
    ├── backend/                 ← Domain contract docs for implemented commands
    ├── designs/                 ← Feature design docs & screenshots
    ├── journal/                 ← Build journal (day-by-day progress)
    └── plans/                   ← Execution plans
```

**Note:** `tests/` and `.github/` do **not** exist yet. Test files are co-located inside packages (e.g. `packages/server/src/__tests__/`).

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop shell | Tauri (Rust) | 2.10.3 |
| UI framework | Next.js + React | 16.1.7 / 19.2.4 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS | v4 |
| UI primitives | shadcn/ui + Radix | — |
| State management | Jotai | ^2.19.1 |
| Local backend | Express.js | ^5.1.0 |
| Database | SQLite (better-sqlite3) | ^11.9.1 |
| Terminal | node-pty + XTerm.js | ^1.1.0 |
| Package manager | pnpm workspaces | ≥9 |
| Node engine | Node.js | ≥22 |

### Frontend Key Libraries
- **Turbopack** for dev (`next dev --turbopack`)
- **Framer Motion** for animations
- **react-markdown + remark-gfm + react-syntax-highlighter** for markdown
- **@dnd-kit** for drag-and-drop
- **@hugeicons/react** for icons
- **@xterm/xterm** for terminal emulator
- **next-themes** for dark/light theming

### Rust Dependencies
- `tauri` 2.10.3, `tauri-plugin-log` 2
- `serde`, `serde_json`, `log`
- No custom Tauri commands defined yet
- Plugins installed as JS deps but not yet wired in Rust: `@tauri-apps/plugin-sql`, `plugin-shell`, `plugin-store`

## Architecture & Conventions

### Rigid 6-Layer Model
Every domain follows strict one-direction dependency flow:

```
Types → Config → Store → Service → Runtime → UI
```

| Layer | Purpose | Can Import From |
|-------|---------|-----------------|
| **Types** | TypeScript types, Zod schemas | Nothing (leaf) |
| **Config** | Constants, defaults, feature flags | Types |
| **Store** | Jotai atoms, derived state | Types, Config |
| **Service** | Business logic, API call wrappers | Types, Config, Store |
| **Runtime** | Side effects, WebSocket handlers, IPC calls | Types, Config, Store, Service |
| **UI** | React components, hooks, pages | All layers above |

**What layers cannot do:**
- Types: no runtime code, no imports from other layers
- Config: no state, no side effects
- Store: no side effects, no direct API calls
- Service: no React, no UI, no side effects
- Runtime: no React components
- UI: no direct WebSocket/IPC calls (go through Runtime/Service)

### Cross-Cutting Providers
The only way to share state across domains is through Providers:
- **AuthProvider** — Gateway token, connection state
- **WebSocketProvider** — Gateway WS connection, event routing
- **IPCProvider** — Tauri IPC bridge
- **ThemeProvider** — Dark/light mode
- **NavigationProvider** — Sidebar state, active project/topic/agent

### File Naming Conventions
```
domains/<domain>/
  types/           ← index.ts
  config/          ← index.ts
  store/           ← atoms.ts, selectors.ts
  service/         ← <name>.service.ts
  runtime/         ← <name>.runtime.ts
  ui/
    components/    ← <Name>.tsx (PascalCase)
    hooks/         ← use<Name>.ts
    pages/         ← <Name>Page.tsx
```

### Enforced Invariants (Mechanically Checked)
1. **Layer direction**: No backward imports
2. **Domain isolation**: No direct imports between domains (use Providers)
3. **Parse at boundary**: All external data validated with Zod at entry
4. **File size**: No file exceeds 300 lines
5. **Naming**: Files match conventions above
6. **No `any`**: TypeScript strict mode
7. **Test coverage**: Every service function has at least one test

## Build & Development Commands

```bash
# Setup
pnpm install

# Dev (Next.js only — fast iteration, port 3000, Turbopack)
pnpm dev
# or
pnpm --filter ui dev

# Dev (full Tauri app)
pnpm dev:tauri
# or
pnpm --filter desktop tauri dev

# Dev (web mode: server + UI concurrently)
pnpm dev:web

# Build
pnpm build                 # UI only
pnpm build:tauri           # Full desktop app
pnpm build:server          # Express backend

# Type checking
pnpm typecheck             # All packages

# Linting
pnpm lint                  # ESLint across all packages
pnpm lint:architecture     # Custom architectural boundary linter

# Testing
pnpm test                  # All package tests
pnpm test:server           # Server tests (Jest)
pnpm --filter shared test  # Shared package tests (Vitest)

# Sandbox / verification
pnpm sandbox:verify        # AXI UI verification via agent-browser
pnpm sandbox:check         # Full build check (typecheck → lint → arch lint → test → build)
```

### Special Notes
- `scripts/run-tauri.cjs` ensures `~/.cargo/bin` is on PATH before invoking Tauri CLI.
- `scripts/run-ui-dev.cjs` checks if port 3000 is already occupied and reuses the running dev server.
- `scripts/rebuild-sqlite.bat` rebuilds the `better-sqlite3` native module on Windows.
- `packages/server/dist/` is **committed to git** so the Tauri build can consume it without a separate compilation step.

## Testing Strategy

| Package | Framework | Location | Status |
|---------|-----------|----------|--------|
| `shared` | Vitest + v8 coverage | `src/**/*.test.ts` | Active (1+ test files) |
| `server` | Jest + ts-jest (ESM) | `src/__tests__/` | Active (DB, dispatch, services, integration) |
| `middleware` | None | — | Not started |
| `ui` | None | — | Not started |
| `desktop` | None | — | Not started |

### Integration & Live Tests
- `scripts/live-reasoning-check.ts` — Creates a live OpenClaw session and verifies reasoning events.
- `scripts/raw-gateway-reasoning-check.ts` — Subscribes to raw Gateway events for validation.
- `scripts/sandbox/verify-ui.sh` — Uses AXI (chrome-devtools-axi) to open the dev server, take DOM snapshots + screenshots, and capture console errors.
- `scripts/sandbox/check-build.sh` — Full CI-like pipeline: TypeScript → ESLint → Architecture lint → Unit tests → Build.

## Code Style & Linting

### Prettier Configuration (`packages/ui/.prettierrc`)
- `semi: false`
- `singleQuote: false`
- `tabWidth: 2`
- `printWidth: 80`
- Plugin: `prettier-plugin-tailwindcss`

### ESLint
- `packages/ui` uses `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.
- Root `pnpm lint` runs `pnpm -r lint`.

### Custom Architecture Linter (`scripts/lint-architecture.ts`)
Run via `pnpm lint:architecture`. Enforces:
- Layer dependency direction
- Domain isolation
- 300-line file limit
- Naming conventions (PascalCase components, `use*` hooks, `*.service.ts`)
- No `any` type usage

## Security Considerations

- **Tauri CSP is currently `null`** (`tauri.conf.json`). Content Security Policy needs to be defined before production.
- Gateway authentication uses **Ed25519 signed challenges** (device identity + challenge-response).
- Keychain token storage is planned but not yet implemented.
- Sensitive files (`.env`, `.env.local`, `*.log`) are `.gitignore`d.
- No secrets or credentials should be committed.

## Domain Status

All domains are currently at grade **F** (Not started or skeleton only). See `docs/QUALITY.md` for the canonical status table. The backend middleware and local server are substantially implemented; the **frontend UI implementation is the primary gap**.

## Key Documentation

| Document | What it covers |
|----------|----------------|
| `SPEC.md` | Full feature spec (137 items, P0–P2) |
| `docs/ARCHITECTURE.md` | Domain map, 6-layer model, dependency rules, data flow diagrams |
| `docs/QUALITY.md` | Per-domain quality grades and gap tracking |
| `docs/DECISIONS.md` | ADRs: Tauri 2.0, Jotai, pnpm workspaces, SQLite, agent-first dev, AXI testing, shadcn/ui |
| `docs/GATEWAY-PROTOCOL.md` | Reverse-engineered OpenClaw Gateway WebSocket protocol (93 methods) |
| `docs/backend/*.md` | Domain contract docs for implemented Tauri middleware commands |
| `docs/JARVIS-STATUS-SNAPSHOT.md` | Current reality check: backend strong, frontend is the gap |
| `docs/journal/*.md` | Day-by-day build journal |

## Agent Instructions

1. **Read `docs/ARCHITECTURE.md`** before touching any code.
2. **Respect layer boundaries** — `pnpm lint:architecture` will catch violations.
3. **One domain at a time** — do not cross-contaminate.
4. **Test first** (TDD) — write a failing test, implement, verify.
5. **Small PRs** — one concern per PR, short-lived.
6. **Check `docs/QUALITY.md`** — know the current state before changing a domain.
7. **Update docs/** — if you change architecture, update the docs in the same PR.
8. **Lint error messages are instructions** — read them; they tell you what to do.
9. **Do not assume** `tests/` or `.github/` exist at root — they do not yet.
10. **UI code lives directly under `packages/ui/`** — there is no `src/` folder inside the UI package.

## Philosophy

Humans steer. Agents execute. Every line of code is agent-generated.
Enforce invariants, not implementations. Corrections are cheap, waiting is expensive.
