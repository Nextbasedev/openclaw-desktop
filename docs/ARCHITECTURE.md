# ARCHITECTURE.md — Jarvis System Architecture

> The authoritative map of domains, layers, and dependency rules.
> If the code disagrees with this doc, the code is wrong.

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Shell                        │
│  (Rust: window mgmt, IPC bridge, SQLite, keychain)  │
├─────────────────────────────────────────────────────┤
│                   Next.js 16 UI                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │  Chat   │ │Observable│ │FileManager│ │Settings│  │
│  │ Domain  │ │  Domain  │ │  Domain   │ │ Domain │  │
│  └────┬────┘ └────┬─────┘ └────┬──────┘ └───┬────┘  │
│       │           │            │             │       │
│  ┌────┴───────────┴────────────┴─────────────┴────┐  │
│  │              Providers (cross-cutting)          │  │
│  │  Auth │ WebSocket │ IPC │ Theme │ Navigation   │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│              OpenClaw Gateway (remote)               │
│        WebSocket + REST │ sessions.json + JSONL      │
└─────────────────────────────────────────────────────┘
```

## Layer Model

Every domain is divided into **6 layers**. Dependencies flow strictly forward:

```
Types → Config → Store → Service → Runtime → UI
```

### Layer Definitions

| Layer     | Purpose                                    | Can Import From        |
|-----------|--------------------------------------------|------------------------|
| **Types** | TypeScript types, interfaces, enums, Zod schemas | Nothing (leaf)   |
| **Config**| Constants, defaults, feature flags          | Types                  |
| **Store** | Jotai atoms, derived state, selectors       | Types, Config          |
| **Service**| Business logic, data transforms, API calls | Types, Config, Store   |
| **Runtime**| Side effects, WebSocket handlers, IPC calls| Types, Config, Store, Service |
| **UI**    | React components, hooks, pages              | All layers above       |

### What Each Layer CANNOT Do

- **Types**: No imports from any other layer. No runtime code. Pure declarations.
- **Config**: No state, no side effects, no UI.
- **Store**: No side effects, no direct API calls. Atoms + derived atoms only.
- **Service**: No React, no UI, no side effects. Pure functions + API call wrappers.
- **Runtime**: No React components. Manages subscriptions, WebSocket listeners, IPC.
- **UI**: No direct WebSocket/IPC calls. Goes through Runtime/Service.

### Cross-Cutting: Providers

Some concerns span multiple domains. These enter through **Providers** — React context
providers that wrap the app root:

- **AuthProvider** — Gateway token, connection state
- **WebSocketProvider** — Gateway WS connection, event routing
- **IPCProvider** — Tauri IPC bridge (invoke commands, listen to events)
- **ThemeProvider** — Dark/light mode, design tokens
- **NavigationProvider** — Sidebar state, active project/topic/agent

Providers are the **only** way to share cross-domain state. No direct imports between domains.

## Domain Map

### Chat (`packages/ui/src/domains/chat/`)
- Real-time messaging via WebSocket
- Streaming responses with thinking/tool indicators
- Markdown rendering, code highlighting
- Message actions (copy, reply, pin, branch, regenerate)
- Interrupt & merge (send during generation → restart)

### Observability (`packages/ui/src/domains/observability/`)
- Live activity feed (tool calls streaming)
- Sub-agent tree view (parent-child hierarchy)
- Context window inspector (token usage, what agent sees)
- Running processes panel

### Intervention (`packages/ui/src/domains/intervention/`)
- Pause/resume agent execution
- Kill running tasks / sub-agents
- Approve/deny tool calls (supervised mode)
- Autonomy level selector

### FileManager (`packages/ui/src/domains/file-manager/`)
- Tree view file browser (OpenClaw workspace)
- File viewer with syntax highlighting
- File editor (Monaco-based)
- Diff view (agent changes)

### Terminal (`packages/ui/src/domains/terminal/`)
- PTY shell via Gateway
- Multiple terminal tabs
- Split view alongside chat

### Skills (`packages/ui/src/domains/skills/`)
- ClawHub browse, install, manage
- Skill detail pages
- Update notifications

### Memory (`packages/ui/src/domains/memory/`)
- View/edit memory files
- Semantic search
- Memory management settings

### Cron (`packages/ui/src/domains/cron/`)
- View/manage cron jobs
- Job status and run history

### Settings (`packages/ui/src/domains/settings/`)
- Connection manager (Gateway URL + token)
- Config editor (JSON + validation)
- Theme, shortcuts, autonomy defaults

### Sidebar (`packages/ui/src/domains/sidebar/`)
- Arc-style project/topic navigation
- Agent list with status indicators
- Multi-agent switching
- Split view management

### Notifications (`packages/ui/src/domains/notifications/`)
- Unified inbox
- Unread indicators
- Desktop notifications (via Tauri)

### Shell (`packages/desktop/src/`)
- Tauri window management (frameless)
- IPC command handlers
- SQLite database
- System keychain (token storage)
- Auto-updater
- URL scheme handler (`openclaw://`)
- System tray

### Install (`packages/ui/src/domains/install/`)
- First-run onboarding wizard
- OpenClaw detection and auto-install
- Connection setup

## File Naming Conventions

```
domains/<domain>/
  types/           ← index.ts (all types for the domain)
  config/          ← index.ts (constants, defaults)
  store/           ← atoms.ts, selectors.ts
  service/         ← <name>.service.ts
  runtime/         ← <name>.runtime.ts
  ui/
    components/    ← <Name>.tsx (PascalCase)
    hooks/         ← use<Name>.ts
    pages/         ← <Name>Page.tsx
```

## Enforced Invariants

These are checked by custom linters (not just documented):

1. **Layer direction**: No backward imports (UI → Types ✅, Types → UI ❌)
2. **Domain isolation**: No direct imports between domains (use Providers)
3. **Parse at boundary**: All external data (WebSocket, IPC, API) validated with Zod at entry
4. **File size**: No file exceeds 300 lines (split if it does)
5. **Naming**: Files match conventions above
6. **No `any`**: TypeScript strict mode, no `any` types
7. **Test coverage**: Every service function has at least one test

## Data Flow

### Chat Message (send)
```
UI (ChatInput) → Store (update optimistic) → Service (format message)
  → Runtime (WebSocket send) → Gateway
```

### Chat Message (receive)
```
Gateway → Runtime (WebSocket event) → Service (parse, validate)
  → Store (update atoms) → UI (re-render)
```

### File Operations
```
UI (FileTree click) → Service (build request) → Runtime (IPC invoke)
  → Tauri (Rust) → Gateway API → Response back through same chain
```

### Sub-Agent Events
```
Gateway WS event → Runtime (route by session) → Service (parse tree)
  → Store (update sub-agent atoms) → UI (tree view re-render)
```
