# Day 1 — Middleware Contracts, Live Gateway Proof, and Desktop Bridge

**Date:** 2026-04-17
**Author:** Darling (AI) + Dixit (Human)
**Time spent:** multiple focused iterations across contracts, live testing, and desktop bridge wiring

---

## What We Built

We built the Jarvis middleware layer in three parts:

1. **Shared API contracts** in `packages/shared/src/api/*`
2. **Runtime-safe middleware package** in `packages/middleware/src/index.ts`
3. **Real Tauri desktop bridge** in `packages/desktop/src-tauri/src/middleware.rs`

The main technical question for the day was whether OpenClaw actually returns tool output in a way the desktop app can use.

We verified that live against the Gateway.

### Key finding

OpenClaw does emit tool lifecycle events, but raw tool result bodies are only available when the session is set to:

- `verboseLevel: "full"`

At:

- `verboseLevel: "on"`

we still receive tool metadata like name, phase, and args, but not the raw tool result body.

That became the desktop rule:

- always show tool name + phase
- only show raw tool output when visibility is `full`

---

## How We Test The Middleware

We use three levels of validation.

### 1. Shared contract tests

These verify request/response validation and registry integrity.

Run:

```bash
pnpm --dir packages/shared test
```

Current scope includes representative payload validation across the middleware endpoint groups plus operation registry coverage.

### 2. Middleware package typecheck

This validates the runtime-safe TypeScript middleware package.

Run:

```bash
./packages/shared/node_modules/.bin/tsc -p packages/middleware/tsconfig.json --noEmit
```

### 3. Live OpenClaw Gateway verification

This is the most important test because it proves real behavior, not assumptions.

Run:

```bash
node --experimental-strip-types tmp/chat-streaming-reference/test-middleware-package.mjs
```

What this script does:

- creates a real session through the middleware package
- tests both `verboseLevel: "on"` and `verboseLevel: "full"`
- sends a prompt that forces a tool call
- listens to live middleware events
- confirms whether tool result payloads are actually present

Expected behavior:

- `on` → tool metadata only
- `full` → tool result body available

### 4. Desktop bridge compile check

This validates the Rust/Tauri bridge compiles cleanly.

Run:

```bash
cd packages/desktop/src-tauri
cargo check
```

### 5. UI typecheck after cleanup

The production frontend should remain clean even when temp reference UIs are moved to `tmp/`.

Run:

```bash
pnpm --dir packages/ui typecheck
```

If Next route files were removed and `.next` still has stale validator output, clear it first:

```bash
rm -rf packages/ui/.next
pnpm --dir packages/ui typecheck
```

---

## How We Build The Middleware

### Shared contracts

Contracts live in:

- `packages/shared/src/api/common.ts`
- `packages/shared/src/api/registry.ts`
- per-domain files in `packages/shared/src/api/*`

The goal is contract-first development:

- define request/response/event schemas first
- expose inferred types from the shared package
- keep operation IDs mapped to exact contracts

### Runtime middleware package

The real reusable middleware runtime lives in:

- `packages/middleware/src/index.ts`

It exposes:

- `createChatSession`
- `deleteChatSession`
- `getChatHistory`
- `sendChatMessage`
- `openChatEventStream`

This package is the production-safe TypeScript implementation for Jarvis middleware behavior.

### Desktop bridge

The desktop shell uses:

- `packages/desktop/src-tauri/src/middleware.rs`

This bridge:

- connects to the local OpenClaw Gateway
- performs the real device-auth challenge flow
- creates/sends/subscribes to sessions
- emits normalized desktop chat events

Registered commands:

- `middleware_chat_create_session`
- `middleware_chat_delete_session`
- `middleware_chat_history`
- `middleware_chat_send`
- `middleware_chat_stream_start`
- `middleware_chat_stream_stop`

---

## Important Lessons From The Day

### 1. Source reading is not enough

Gateway tests and source code were useful, but the final answer still required live execution.

### 2. Production middleware should not live in the exported Next app

`packages/ui` uses `output: "export"`, so app routes there are not a valid production middleware host.

That is why the real runtime moved into `packages/middleware` and the desktop bridge into Tauri.

### 3. Temp UI work must stay temp

Reference UI and route experiments belong in `tmp/`, not in production frontend paths.

That cleanup mattered before pushing the repo.

---

## Verification Snapshot

Validated during this build cycle:

- shared tests passing
- middleware package typecheck passing
- UI typecheck passing
- Rust `cargo check` passing
- live Gateway proof for tool output visibility behavior completed

---

## What’s Next

- wire the desktop bridge into the real production Jarvis chat UI
- replace temp demo affordances with proper desktop screens
- keep middleware verification scripts in sync with real Gateway behavior as OpenClaw evolves
