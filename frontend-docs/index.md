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

## Live-verification note (2026-06-03)
The production middleware at `oc-234eeeae.tail094d3a.ts.net` became **app-level wedged**
mid-session (TLS connects, host pings, but `/health` + `/api/chats` hang indefinitely)
— consistent with the backfill/event-loop pressure 0007/0008 address, likely triggered
by large (5MB) concurrent bootstrap fetches while probing for tool-rich sessions. No SSH
to that host to restart it. Commits 0009–0010 were therefore live-verified in real
Firefox DOM against a **local mock** (`webwright-runs/chat-v5-polish/mock-mw.cjs`) that
serves contract-accurate `/api/chats`, `/api/chat/bootstrap` (tools in running/success/
error), `/api/chat/messages` (older pages), and `/api/chat/tool-result`. This verifies
the **UI layer** (the task scope); re-run against the live middleware once it recovers.

## Phase status
- [x] **Phase 1 — Headless store** (reducer, bootstrap, selectors, tests)
- [x] **Phase 2 — ChatSyncClient** (WS lifecycle + gap/reconnect recovery)
- [x] **Phase 3a — Store runtime bridge** (RAF store + provider/hook + older-merge)
- [x] **Phase 3b — Timeline UI** (virtual history + live tail + tool cards + composer; build green)
- [ ] Phase 4 — Live streaming (live tail, buffered reveal, RAF batching)
- [ ] Phase 5 — Tools & approvals
- [ ] Phase 6 — Smoothness + composer parity
- [ ] Phase 7 — Hardening + cutover (remove @assistant-ui, flip flag)

## Commit log
| # | Doc | Summary |
|---|-----|---------|
| 0001 | [0001-phase1-headless-chat-store.md](commits/0001-phase1-headless-chat-store.md) | Phase 1 headless store: contract types, reducer, bootstrap, selectors, tests; split all files ≤200 lines |
| 0002 | [0002-toolcall-ui-reference-from-power-dashboard.md](commits/0002-toolcall-ui-reference-from-power-dashboard.md) | Plan update: ported proven Tool/Reasoning/Subagent UX patterns from openclaw-power-dashboard into Approach A §6.1 |
| 0003 | [0003-phase2-chat-sync-client.md](commits/0003-phase2-chat-sync-client.md) | Phase 2: ChatSyncClient (bootstrap→WS, cursor gap + hello recovery re-bootstrap, reconnect backoff) + apiClient + socket; 8 tests |
| 0004 | [0004-phase3a-store-runtime-bridge.md](commits/0004-phase3a-store-runtime-bridge.md) | Phase 3a: RAF-batched store + older-pagination merge + React provider/hook (useSyncExternalStore); 7 new tests |
| 0005 | [0005-phase3b-timeline-ui.md](commits/0005-phase3b-timeline-ui.md) | Phase 3b: visible timeline UI — virtual history + live tail + tool/reasoning cards + composer + /chat-v5 route; production build green |
| 0006 | [0006-session-sidebar-app-shell.md](commits/0006-session-sidebar-app-shell.md) | Session sidebar (/api/chats) + app shell (SessionList + ChatScreen); root / now shows selectable chats + new-chat; build green |
| 0007 | [0007-middleware-archived-history-nonblocking.md](commits/0007-middleware-archived-history-nonblocking.md) | Middleware: fix event-loop freeze on cold-cache archived-history import (bounded line-read + non-blocking chunked scan/import); 175/175 mw tests pass |
| 0008 | [0008-middleware-backfill-nonblocking.md](commits/0008-middleware-backfill-nonblocking.md) | Middleware: non-blocking live history backfill (yield in changedMessages loop) — fixes 12s /health timeout bursts during ~18s backfills |
| 0009 | [0009-scroll-anchor-older-load.md](commits/0009-scroll-anchor-older-load.md) | Scroll-anchor on older-page load (two-way ResizeObserver delta compensation) — older history prepends with no viewport jump; live-verified (3130px grew, 12px row move) |
| 0010 | [0010-toolcard-and-timeline-polish.md](commits/0010-toolcard-and-timeline-polish.md) | UI polish: redesigned ToolCard (status color/pill/dot, labeled args/result, copy + view-full), AI-avatar assistant turns + hover meta, real markdown styling (no typography plugin), auto-grow composer, jump-to-latest; live-verified via mock |
| 0011 | [0011-middleware-cold-bootstrap-dedupe.md](commits/0011-middleware-cold-bootstrap-dedupe.md) | Middleware P1.1: per-session in-flight cold-bootstrap dedupe (`coldBootstrapJobs` single-flight, reject+clear on failure) — collapses K concurrent first-bootstraps into one build; 177/177 mw tests |
| 0012 | [0012-middleware-bootstrap-tools-single-pass.md](commits/0012-middleware-bootstrap-tools-single-pass.md) | Middleware P1.2: async single-pass bootstrap tool inference (precomputed id/stop index, yields every 25) — kills O(n²) forward-scan over 600+ tools; 179/179 mw tests |
| 0013 | [0013-middleware-bootstrap-yields-and-gating.md](commits/0013-middleware-bootstrap-yields-and-gating.md) | Middleware P1.3/P1.4: yield between normalize/upsert/prune stages, chunked serialize (every 200), gated `messageFactorSummary` (>1500 msgs); window-bound deferred (frontend-visible); 179/179 |
| 0014 | [0014-middleware-archived-import-tool-projection.md](commits/0014-middleware-archived-import-tool-projection.md) | Middleware P2.5: project tool calls during archived-history import (`projectArchivedSegmentToolCalls`, paired by toolCallId, run-detached, idempotent) — fixes empty tools on historical sessions; 181/181 |
| 0015 | [0015-middleware-archived-tool-backfill.md](commits/0015-middleware-archived-tool-backfill.md) | Middleware P2.6: idempotent `backfillArchivedToolCalls` (two paged passes, cross-page pairing) + lazy trigger from background job when `countToolCalls==0`, refresh broadcast on backfill; 182/182 |
| 0016 | [0016-middleware-snapshot-tool-scoping.md](commits/0016-middleware-snapshot-tool-scoping.md) | Middleware P2.7: scope snapshot tools to `activeRun` (not terminal `latestRun`) — historical run-detached (runId NULL) tool cards render on terminal sessions; live run-scoping preserved; 184/184, build green |
| 0017 | [0017-transport-duplicate-content-type-415-fix.md](commits/0017-transport-duplicate-content-type-415-fix.md) | Fix duplicate Content-Type header (transport.ts set a 2nd lowercase `content-type` on top of middlewareFetch's → fetch merged to `application/json, application/json` → Fastify 415 on every POST: send/abort/createChat/resolveApproval). Drop redundant header; 26/26 + typecheck + build green |

> Note: the table above is the only place a markdown table is acceptable (docs file,
> not a chat surface).
