# DECISIONS.md — Architecture Decision Records

> Every significant architectural choice, with context and trade-offs.

---

## ADR-001: Tauri 2.0 over Electron

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Need a cross-platform desktop shell (macOS, Windows, Linux).

**Decision:** Tauri 2.0 with Rust backend.

**Rationale:**
- Smaller binary size (~10MB vs ~150MB Electron)
- Lower memory footprint (uses OS webview, not bundled Chromium)
- Rust for performance-critical features (SQLite, IPC, file ops)
- Tauri 2.0 is stable, supports all target platforms
- Security: Rust's memory safety, explicit IPC permission model

**Trade-offs:**
- Smaller ecosystem than Electron
- WebView differences across platforms (webkit on macOS, webview2 on Windows)
- Rust learning curve for contributors
- Some web APIs not available in system webview

---

## ADR-002: Jotai for State Management

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Need global state management for a complex multi-panel desktop app.

**Decision:** Jotai (atomic state).

**Rationale:**
- Already used in ampere-sh (team familiarity)
- Bottom-up atomic model fits domain isolation (atoms per domain)
- No boilerplate (vs Redux)
- Excellent TypeScript support
- Fine-grained re-renders (each atom subscribes independently)

**Trade-offs:**
- Less structured than Redux (no enforced patterns) — mitigated by our layer model
- Debugging tools less mature than Redux DevTools

---

## ADR-003: Monorepo with pnpm Workspaces

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Project has distinct concerns: Tauri/Rust, Next.js UI, shared types.

**Decision:** pnpm workspaces monorepo with 3 packages: `desktop`, `ui`, `shared`.

**Rationale:**
- Clear separation of concerns
- Shared types used by both UI and Tauri IPC
- Single `pnpm install`, unified tooling
- Each package can have its own build/test pipeline

---

## ADR-004: SQLite via Tauri for Local State

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Need local persistence for cached chat history, settings, layout preferences.

**Decision:** SQLite through Tauri's built-in plugin (`tauri-plugin-sql`).

**Rationale:**
- No external database dependency
- Fast, reliable, well-understood
- Tauri has native SQLite plugin
- Data stays local (privacy)
- Sync via Gateway for multi-device (sessions stored server-side, local cache for offline)

---

## ADR-005: Agent-First Development (Harness Engineering)

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Building with tight timeline (5 days to MVP). Team of 1 human + agents.

**Decision:** Follow OpenAI's "harness engineering" approach. Zero hand-written code.
Humans steer (design, review, specify). Agents execute (write all code).

**Rationale:**
- 10x throughput demonstrated in OpenAI's internal experiment
- Forces good documentation and mechanical enforcement
- Repository becomes self-documenting (everything in-repo)
- Corrections are cheap with high agent throughput

**Key practices adopted:**
- AGENTS.md as table of contents, not encyclopedia
- Structured docs/ as system of record
- Rigid architectural layers with linter enforcement
- Agent-to-agent review loops
- Git worktrees for parallel agent work
- chrome-devtools-axi for agent UI verification

---

## ADR-006: AXI (chrome-devtools-axi) for Agent Browser Testing

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Agents need to verify UI changes visually. Options: Playwright, Puppeteer, agent-browser, AXI.

**Decision:** chrome-devtools-axi as primary agent testing tool. Playwright for E2E test suite.

**Rationale:**
- AXI benchmarks: cheapest ($0.074/task), fastest (21.5s), 100% success
- Token-efficient output (TOON format, ~40% savings over JSON)
- Designed for agent ergonomics (contextual disclosure, minimal schemas)
- Playwright complements for headless CI E2E tests

---

## ADR-007: shadcn/ui Preset for Design System

**Date:** 2026-04-16
**Status:** Accepted

**Context:** Need a design system. Custom vs. library.

**Decision:** shadcn/ui with preset `bd1gAd56`. Dark + light themes. Avoid "typical AI" color palettes.

**Rationale:**
- shadcn/ui components are copy-pasted (own the code, not a dependency)
- Preset provides consistent design tokens, fonts, colors
- Tailwind for utility-first styling
- Easy for agents to work with (well-documented, composable)

**Constraint:** No colors that "look like every other AI product" — differentiate visually.
