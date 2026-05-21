# Day 0 — Foundation & Philosophy

**Date:** 2026-04-16
**Author:** Darling (AI) + Dixit (Human)
**Time spent:** ~2 hours brainstorming, 0 lines of code

---

## What We Did

Before writing a single line of code, we spent the entire first session on **understanding and planning**. This was inspired by OpenAI's "harness engineering" blog post, which describes building a product with zero hand-written code.

### The Blog That Shaped Everything

We read [Harness Engineering: Leveraging Codex in an Agent-First World](https://openai.com/index/harness-engineering/). Key takeaways that directly shaped our approach:

1. **"Give agents a map, not a 1,000-page manual"** — We created a ~90-line AGENTS.md that serves as a table of contents, pointing to deeper docs. Not a monolith.

2. **"The primary job became enabling agents to do useful work"** — Before writing code, we built the documentation, architecture rules, and testing infrastructure that agents need.

3. **"Enforce invariants, not implementations"** — We defined a rigid layer model (Types → Config → Store → Service → Runtime → UI) with mechanical enforcement via linters, but let agents choose how to implement within those boundaries.

4. **"Corrections are cheap, waiting is expensive"** — We chose minimal blocking merge gates and short-lived PRs.

5. **"Repository-local knowledge is the only knowledge that exists"** — Everything goes in the repo. No Slack threads, no Google Docs, no tribal knowledge.

### 50 Questions Before Code

We asked 50 brainstorming questions covering:
- Vision & priorities (who's this for, timeline, open source strategy)
- Architecture & tech stack (Tauri, Jotai, monorepo, pnpm)
- UI & design (shadcn preset, themes, sidebar style, frameless window)
- Gateway protocol (WebSocket, auth, sessions, cancellation)
- Chat behavior (interrupt/merge, branching, history storage)
- Observability (sub-agent events, system stats, context inspector)
- Intervention (pause/resume, supervised mode, kill)
- Files & terminal (workspace scope, Monaco editor, PTY)
- Installation (auto-install, URL scheme, code signing)
- Data & state (multi-device sync, offline behavior)
- Extensibility (ClawHub, slash commands)
- Scope & process (team size, CI, platforms, timeline)

This prevented us from building the wrong thing. Every architectural decision was captured in `docs/DECISIONS.md`.

### The 5-Day Deadline

Yes, we gave ourselves 5 days to build an MVP. This constraint is the point — it forces us to:
- Lean heavily on agent parallelism (multiple agents working simultaneously)
- Keep scope tight (P0 features only for MVP)
- Use proven patterns (Jotai, shadcn, Tauri plugins)
- Skip perfectionism (ship, then fix)

## Problems We Anticipated

### 1. Agent Context Limits
Large codebases overwhelm agent context windows. Our mitigation:
- Strict file size limits (300 lines max)
- Domain isolation (agents only need to understand one domain at a time)
- Progressive disclosure (AGENTS.md → ARCHITECTURE.md → domain docs)

### 2. Architectural Drift
Without enforcement, multiple agents writing code simultaneously will create inconsistencies. Our mitigation:
- Custom linters checking layer boundaries
- Naming conventions enforced mechanically
- Agent-to-agent code review after each task

### 3. WebView Differences Across Platforms
Tauri uses the OS webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux). This means CSS and behavior can differ. Our mitigation:
- Test on all three platforms in CI (later)
- Stick to well-supported CSS features
- Use shadcn/ui components (already cross-browser tested)

### 4. Gateway Protocol Is Undocumented
The OpenClaw Gateway's WebSocket API isn't officially documented. We need to reverse-engineer it from:
- The power-dashboard reference project (reads sessions.json + JSONL)
- The OpenClaw source code
- Live testing against a running Gateway

### 5. Memory Pressure
This server has 8GB RAM. Running multiple dev servers, headless Chrome, builds, and agents simultaneously will push limits. Our mitigation:
- Git worktrees instead of full clones
- Kill idle dev servers
- Stagger agent work when memory is tight

## Decisions Made

See `docs/DECISIONS.md` for the full list. Key choices:
- Tauri 2.0 over Electron (smaller, faster, Rust)
- Jotai for state management (atomic, familiar from ampere-sh)
- pnpm monorepo (desktop + ui + shared packages)
- SQLite via Tauri for local state
- AXI (chrome-devtools-axi) for agent browser testing
- shadcn/ui preset bd1gAd56 for design system

## What's Next

Day 1: Sandbox tooling + project scaffold
- Install and configure chrome-devtools-axi
- Set up git worktree scripts for parallel agents
- Scaffold Tauri + Next.js monorepo
- Create architectural linters
- Write first design docs for P0 features

---

*This is the first entry in our build journal. We'll document every day — the wins, the failures, and the lessons. When this project goes open source, this journal is how people will learn not just what we built, but how and why.*
