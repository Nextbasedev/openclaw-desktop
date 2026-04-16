# AGENTS.md — Jarvis (OpenClaw Desktop)

> This file is a **map**, not a manual. ~100 lines. Points to deeper sources of truth.

## What Is This?

Jarvis is the official OpenClaw Desktop app — a Tauri 2.0 + Next.js 16 native desktop client
for interacting with OpenClaw agents. Two UI modes: Simple (clean chat) and Mission Control
(full observability dashboard). Open source.

## Repository Layout

```
├── AGENTS.md              ← You are here (table of contents)
├── SPEC.md                ← Full feature spec (137 items, prioritized P0-P2)
├── docs/
│   ├── ARCHITECTURE.md    ← Domain map, layer model, dependency rules
│   ├── QUALITY.md         ← Per-domain quality grades and gap tracking
│   ├── DECISIONS.md       ← Architecture Decision Records (ADRs)
│   ├── GATEWAY-PROTOCOL.md ← WebSocket protocol reference (reverse-engineered)
│   ├── designs/           ← Feature design docs (one per feature/domain)
│   ├── plans/             ← Execution plans (ephemeral + complex)
│   └── journal/           ← Build journal (for open source — steps, problems, lessons)
├── packages/
│   ├── desktop/           ← Tauri (Rust) — window management, IPC, native APIs
│   ├── ui/                ← Next.js 16 + React 19 — all UI code
│   └── shared/            ← Shared types, utils, constants
├── scripts/               ← Dev tooling, linters, sandbox helpers
├── tests/                 ← E2E tests (Playwright), integration tests
└── .github/               ← CI/CD (later)
```

## Architecture (→ docs/ARCHITECTURE.md)

Rigid layer model per domain. Code flows **one direction only**:

```
Types → Config → Store → Service → Runtime → UI
```

Cross-cutting concerns (auth, WebSocket, IPC) enter through **Providers**.
Custom linters enforce these boundaries mechanically.

## Domains

| Domain        | Description                              | Status      |
|---------------|------------------------------------------|-------------|
| Chat          | WebSocket messaging, streaming, markdown | Not started |
| Observability | Tool calls, sub-agents, context inspect  | Not started |
| Intervention  | Pause/resume, kill, approve/deny         | Not started |
| FileManager   | Server filesystem browse, edit, diff     | Not started |
| Terminal       | PTY shell access via Gateway             | Not started |
| Skills        | ClawHub install, manage, browse          | Not started |
| Memory        | View/edit memory files, semantic search  | Not started |
| Cron          | View/manage cron jobs                    | Not started |
| Settings      | Connections, config, theme, shortcuts    | Not started |
| Sidebar       | Projects, topics, agent list, switching  | Not started |
| Notifications | Inbox, alerts, desktop notifications     | Not started |
| Shell         | Tauri window, frameless, IPC bridge      | Not started |
| Install       | Auto-install OpenClaw, onboarding        | Not started |

## Tech Stack

- **Desktop:** Tauri 2.0 (Rust) — performance-critical features, window management, IPC, SQLite
- **UI:** Next.js 16 + React 19 + TypeScript + shadcn/ui + Tailwind
- **State:** Jotai (atoms)
- **Local DB:** SQLite via Tauri
- **Package Manager:** pnpm
- **Monorepo:** pnpm workspaces

## Key Docs

- Feature spec → `SPEC.md`
- Architecture & layers → `docs/ARCHITECTURE.md`
- Quality grades → `docs/QUALITY.md`
- Gateway protocol → `docs/GATEWAY-PROTOCOL.md`
- Design docs → `docs/designs/`
- Build journal → `docs/journal/`

## Development

```bash
# Setup
pnpm install

# Dev (Next.js only — fast iteration)
pnpm --filter ui dev

# Dev (full Tauri app)
pnpm --filter desktop tauri dev

# Test
pnpm test

# Lint (includes architectural boundary checks)
pnpm lint

# Sandbox: verify UI via agent-browser
pnpm sandbox:verify
```

## Agent Instructions

1. **Read ARCHITECTURE.md** before touching any code
2. **Respect layer boundaries** — linters will catch violations
3. **One domain at a time** — don't cross-contaminate
4. **Test first** (TDD) — write failing test, implement, verify
5. **Small PRs** — one concern per PR, short-lived
6. **Check QUALITY.md** — know current state before changing a domain
7. **Update docs/** — if you change architecture, update the docs in the same PR
8. **Lint error messages are instructions** — read them, they tell you what to do

## Philosophy

Humans steer. Agents execute. Every line of code is agent-generated.
Enforce invariants, not implementations. Corrections are cheap, waiting is expensive.
