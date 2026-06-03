# Frontend Docs — Chat v5 Rebuild

Living index of the v5 chat frontend rebuild. **Every commit gets its own standalone
doc** in `commits/` describing: what changed, why, workarounds, what improved, and
exactly what to test. This file is the table of contents.

## Working method
See [WORKFLOW.md](WORKFLOW.md) — RPI (Research → Plan → Implement) in isolated steps,
compaction to avoid the context "dumb zone", and sub-agents used for context
protection (not roles).

## Conventions
- One file per commit: `commits/NNNN-short-slug.md` (zero-padded, incrementing).
- Each commit doc is self-contained — readable without reading the others.
- Keep source files ≤ 200 lines; isolate concerns into small modules.
- Plans live at repo root: `CHAT_FRONTEND_PLAN_V5.md`,
  `CHAT_FRONTEND_PLAN_V5_APPROACH_A.md`.

## Architecture (one-liner)
Middleware is the single source of truth. The UI is a **cursor-ordered projection**:
bootstrap snapshot → WebSocket patch stream → pure reducer → normalized store →
virtualized history + non-virtualized live tail. Identity comes from the server
(never content); run status has one owner; the streaming turn renders outside the
virtualizer.

## Phase status
- [x] **Phase 1 — Headless store** (reducer, bootstrap, selectors, tests)
- [ ] Phase 2 — ChatSyncClient (WS lifecycle + gap/reconnect recovery)
- [ ] Phase 3 — Static timeline (bootstrap render + virtualization + older load)
- [ ] Phase 4 — Live streaming (live tail, buffered reveal, RAF batching)
- [ ] Phase 5 — Tools & approvals
- [ ] Phase 6 — Smoothness + composer parity
- [ ] Phase 7 — Hardening + cutover (remove @assistant-ui, flip flag)

## Commit log
| # | Doc | Summary |
|---|-----|---------|
| 0001 | [0001-phase1-headless-chat-store.md](commits/0001-phase1-headless-chat-store.md) | Phase 1 headless store: contract types, reducer, bootstrap, selectors, tests; split all files ≤200 lines |
| 0002 | [0002-toolcall-ui-reference-from-power-dashboard.md](commits/0002-toolcall-ui-reference-from-power-dashboard.md) | Plan update: ported proven Tool/Reasoning/Subagent UX patterns from openclaw-power-dashboard into Approach A §6.1 |

> Note: the table above is the only place a markdown table is acceptable (docs file,
> not a chat surface).
