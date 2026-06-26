# System Audit — Master Inventory

> Date: 2026-06-26. Branch `fix-master`. Scope: full desktop app, end-to-end.
> Method: direct source audit (file:line verified) + live repro evidence from
> `tests/repro/` runs (`docs/CHAT_ISSUE_INVENTORY.md`). Sub-agent audits were
> attempted but terminated early on this RAM-constrained host (no fake-green); all
> findings below were personally verified against source.
> Companion docs: `docs/CHAT_ISSUE_INVENTORY.md`, `docs/I2_MULTIWRITER_MAP.md`,
> `docs/ISSUE_2_HANDOFF.md`, `docs/CHAT_REFACTOR_AUDIT.md`.

## Stack architecture (verified)

- **Desktop shell: Tauri** (Rust, `packages/desktop/src-tauri`) — NOT Electron. UI runs in a Tauri webview; native focus/blur via `@tauri-apps/api`.
- **UI: Next.js 16** (`packages/ui`, App Router, Turbopack dev). Also exposes server route handlers under `app/api/*` (stream proxies for chat + pty).
- **Middleware: Fastify** (`apps/middleware`, :8787) → talks to **gateway** (:18789). Owns the **sqlite** DB (`better-sqlite3`, `apps/middleware/src/db`) and the **patch bus** (`apps/middleware/src/features/patches.ts`).
- **Patch bus:** global append-only patch log in sqlite; a `PatchHub` broadcasts new patches to all connected WS clients; clients catch up via REST `listPatchesAfter(afterCursor)`.
- **Second sync system:** `packages/server/src/sync/{anchor,outbox,pull}.ts` — a separate local-first sync layer that overlaps the middleware DB responsibilities (see ARCH-02).
- **Data flow:** UI ⇄ middleware(:8787) ⇄ gateway(:18789) ⇄ DB ⇄ patch bus ⇄ UI (WS stream).

---

## MASTER INDEX (severity-sorted)

| ID | Severity | Area | Title | Status |
|----|----------|------|-------|--------|
| I2 | Critical | chat-core | Multi-writer two-sources-of-truth (store + ChatView) | **Part 1 fixed** (`bc820b0d`); collapse blocked on prod env |
| I3 | Critical | chat-core | Typewriter re-animation on session switch | Open (repro'd) |
| BE-01 | High | patch-bus | Broadcast has no backpressure (`bufferedAmount`) | Open |
| BE-02 | High | patch-bus | Server broadcasts every session's patches to every client (I6 root) | Open |
| I4 | High | chat-core | Startup connection race (`Middleware connection not configured`) | Open (partly mitigated by I1) |
| I5 | High | chat-core | Bootstrap-recovery re-fires `afterCursor:0` full replay per switch | Open |
| FE-01 | High | frontend | `useAppFocus` async-cleanup race → Tauri listener leak | Open (verified) |
| ARCH-01 | High | architecture | Two windowing modules (160 vs 200) — virtualization fork | Open |
| ARCH-02 | High | architecture | Two persistence/sync systems (middleware DB vs server/sync) | Open |
| I1 | High | chat-core | Redundant global WebSockets 3→1 | **Fixed** (`30a490a1`) |
| BE-03 | Medium | backend | `compat/routes.ts` god-file: 4,861 LOC / 90 handlers | Open |
| FE-02 | Medium | frontend | `AppPage.tsx` 3,530 LOC + repeats async-unlisten race | Open |
| I6 | Medium | chat-core | Global-stream cross-talk (client applies foreign sessions) | Open (BE-02 is root) |
| I8 | Medium | chat-core | Infinite-scroll viewport-jump + double-resolve | Open |
| I7 | Medium | frontend | Hydration error `<div>` inside `<p>` (MarkdownContent) | Open |
| FE-03 | Medium | frontend | Global listeners never removed (`cacheRealtime`, `clientLogs`, `ipc`) | Open |
| PERF-01 | Medium | perf | `afterCursor:0` replays up to 1000–5000 patches per recovery | Open (ties I5) |
| PERF-02 | Low | perf | Hot-path client logging (every patch logs several lines) | Open (I10) |
| ARCH-03 | Low | repo | Duplicated build artifacts committed under `src-tauri/target/**` | Open |
| FE-04 | Low | frontend | Raw `console.log` in `useAppFocus` on every focus change | Open |
| PERF-03 | Low | perf | Middleware TTFT / `/api/chat/bootstrap` latency unmeasured | Open (I9) |

20 issues (2 fixed). Severity: 2 Critical · 7 High · 7 Medium · 4 Low.

---

## DETAILED FINDINGS

### Chat-core (I1–I10) — see `docs/CHAT_ISSUE_INVENTORY.md` for raw repro evidence

#### I1 — Redundant global WebSockets — **FIXED** (`30a490a1`)
Collapsed 3 `openPatchStreamV2` openers into one shared multiplexer (`subscribeChatPatches`) in `client.ts`. Verified live (3→1).

#### I2 — Multi-writer / double-apply — **Part 1 FIXED** (`bc820b0d`), collapse pending
- Severity: Critical. Reproduction: stream a message → `assistant-delta.render-state` logged 2×/cursor (pre-fix). Now 1×.
- Root cause: ChatView applied patches inside an impure `setState` updater (logs + nested `setWindowState`), React double-invokes updaters. **Remaining:** ChatView keeps a 2nd message copy (local `HistoryState`) applying the same patches the store applies.
- Affected: `components/ChatView/index.tsx` (patch effect 1087+), `lib/chat-engine-v2/store.ts`.
- Risk: the architectural collapse touches the most flicker-prone component + cross-consumers; needs prod-build verification (see `docs/ISSUE_2_HANDOFF.md`).
- Fix path: route 4 history writers through `seedGlobalChatSession`; ChatView renders a windowed mirror of the store. **Blocked on prod-capable env (B4).**

#### I3 — Typewriter re-animation on session switch
- Severity: Critical (headline user-visible bug). Reproduction: `scenarios.py stream_switch` — toggling B↔A during a stream produced 8 text-reset events (live row reset 443→26, 988→26 chars; `26 ≈ slice(0,24)`). Confirmed: re-animation fires ONLY on remount, not straight streaming (`reanim:0` on plain stream).
- Root cause: switch-back REMOUNTS `ChatView` → `useStreamingText` re-inits `initialDisplay` to a ~24-char prefix and re-reveals from scratch (`components/streaming/useStreamingText.ts:49–51`). Amplified by I2 + I5.
- Affected: `useStreamingText.ts`, `ChatView/index.tsx` mount/key, parent `key={chatId:sessionKey}` remount.
- Risk: High — primary "feels broken" complaint.
- Fix path: DOM-owned streaming text with a monotonic prefix that survives remount (persist displayed length per messageId in the store, not local component state); don't reseed on remount.

#### I4 — Startup connection race
- Severity: High. Reproduction: cold load → 2× `unhandledrejection: "Middleware connection is not configured"` + `ws.connect.fail` + `ws.disconnect 1006` while another stream connects.
- Root cause: multiple consumers read the middleware URL / open the stream before connection config is hydrated; one path throws while others succeed → abnormal-close churn + reconnect. (I1's deferred-teardown reduced startup error count in measured runs.)
- Affected: `lib/chat-engine-v2/client.ts`, `lib/middleware-client.ts`, store/runWatcher init order.
- Fix path: single connection-config gate (a ready promise) all stream consumers await before connecting; no throw-on-unconfigured during boot.

#### I5 — Bootstrap-recovery re-fires per session switch
- Severity: High. Reproduction: each session switch logs `patch-stream.bootstrap-recovery` at `afterCursor:0` (full replay).
- Root cause: recovery decision keyed on blind `afterCursor:0` rather than an epoch/coverage check; switching triggers a re-bootstrap even when data is fresh.
- Affected: `client.ts` (bootstrap-recovery handler), `ChatView` recovery event handling (`lastBootstrapCompletedAtRef` is a partial guard).
- Fix path: gate recovery by epoch + last-bootstrap timestamp + existing coverage; never replay from 0 if window already covers the live tail.

#### I6 — Global-stream cross-talk — root is **BE-02**
- Severity: Medium. Reproduction: viewing DreamHour chats, 36 patch frames for an unrelated telegram session were received/applied client-side.
- Root cause: server `PatchHub.broadcast` fans EVERY patch to EVERY client (no session filter); client must filter. (BE-02.)
- Fix path: server-side per-session subscription (client sends interested sessionKeys; hub routes). Reduces client CPU + leak risk.

#### I7 — Hydration error `<div>` inside `<p>`
- Severity: Medium. Reproduction: console `"<div> cannot be a descendant of <p>"` when markdown messages render. Root cause: MarkdownContent emits block elements inside a `<p>`. Fix: render markdown blocks outside paragraph wrappers (use `div`/fragment, not `p`, for block-capable content).

#### I8 — Infinite-scroll viewport-jump + double-resolve
- Severity: Medium. Reproduction: each upward load grew scrollHeight ~12k px; `older-fetch-resolved` double-fired. Root cause: hand-rolled windowing + StrictMode effect double-fire in pagination resolve + scroll-anchor race. Fix: consolidate to one virtualization owner (candidate: react-virtuoso) with stable anchoring; idempotent page-resolve.

#### I9 / I10 — see PERF-03 / PERF-02.

---

### Backend / patch bus

#### BE-01 — Patch broadcast has no backpressure
- Severity: High. Reproduction: static — `PatchHub.broadcast` (`apps/middleware/src/features/patches.ts:40`) calls `client.socket.send(frame)` for every OPEN client with no `bufferedAmount` check. A slow-but-open client (laptop sleep, network stall) buffers frames unboundedly in the WS send queue → middleware memory growth, head-of-line latency for others.
- Root cause: fire-and-forget send loop; only closed/throwing clients are evicted, not slow ones.
- Affected: `apps/middleware/src/features/patches.ts:40-58`.
- Risk: Medium-High blast radius (process memory; affects all clients).
- Fix path: check `socket.bufferedAmount` against a threshold; on exceed, drop the client to REST-catchup (close + let it reconnect with `afterCursor`) or coalesce. Consider per-client send queue with high-water mark.

#### BE-02 — Broadcast-to-all (no server-side session routing) — root of I6
- Severity: High. Reproduction: static + I6 evidence. `broadcast` sends every session's patches to every connected client.
- Root cause: hub has no per-client session interest set; routing is delegated to the client filter.
- Affected: `apps/middleware/src/features/patches.ts` (`PatchHub`, `broadcast`, client registration ~line 18-50).
- Risk: O(clients × patches) fan-out; cross-session CPU; state-leak risk if a client filter bug ever lands.
- Fix path: register `Set<sessionKey>` per client (subscribe/unsubscribe frames); `broadcast` only sends to interested clients. Pairs with the I2 single-writer (store filters once, server filters too).

#### BE-03 — `compat/routes.ts` god-file (4,861 LOC, 90 handlers)
- Severity: Medium. Reproduction: static. One file owns 90 route handlers + direct DB access, overlapping `chat/routes.ts` (1,786 LOC) responsibilities.
- Root cause: organic growth; "compat" became a catch-all.
- Affected: `apps/middleware/src/features/compat/routes.ts`.
- Risk: change-fragility, merge conflicts, hard to reason about; bug surface.
- Fix path: split by resource (sessions/messages/runs/tools/skills) into feature modules; extract DB access into repos (pattern already exists: `repo.messages.ts`, `repo.runs.ts`). Staged, non-behavioral.

#### PERF-01 — `afterCursor:0` recovery replays 1000–5000 patches
- Severity: Medium. `listPatchesAfter` (`patches.ts:71`) returns up to `limit` (default 1000, cap 5000). I5's `afterCursor:0` recovery on every switch can pull a large replay → bandwidth + client re-apply churn. Fix: tie to I5 (don't replay from 0); add a coverage-aware lower bound.

---

### Frontend (non-chat-core)

#### FE-01 — `useAppFocus` async-cleanup race → Tauri listener leak (VERIFIED)
- Severity: High. Reproduction: static — `packages/ui/hooks/useAppFocus.ts`. `setupTauriListeners()` registers `tauri://focus`/`blur` listeners and returns an unlisten fn assigned via `.then((cleanup) => { cleanupTauri = cleanup })`. The effect's cleanup closure references `cleanupTauri`, but it's assigned ASYNC — if the effect unmounts/re-runs before the promise resolves, `cleanupTauri` is `undefined` and the Tauri listeners are never removed.
- Root cause: synchronous cleanup closure over an asynchronously-assigned unlisten handle (no `cancelled` guard, no await in cleanup).
- Affected: `packages/ui/hooks/useAppFocus.ts:60-66` (the `.then` assignment + return cleanup).
- Risk: accumulating duplicate focus/blur listeners across remounts → `updateState` fires N×/event → extra renders; slow leak.
- Fix path: capture a `cancelled` flag; in cleanup, if the promise hasn't resolved, set a flag the `.then` checks and immediately calls unlisten; or store the promise and `promise.then(u => u())` in cleanup.

#### FE-02 — `AppPage.tsx` 3,530 LOC + repeats async-unlisten race
- Severity: Medium. `components/AppPage.tsx:344-365` uses the same `unlisten = await ...listen(...)` pattern; it has a `cancelled` guard (better than FE-01) but still leaks the listener if unmount precedes `await listen` resolution (cleanup runs with `unlisten` still undefined). Also a 3,530-LOC top-level component = complexity hotspot. Fix: same async-unlisten hardening; decompose AppPage.

#### FE-03 — Global listeners registered without removal
- Severity: Medium. `lib/cacheRealtime.ts` adds 5 window/document listeners (focus/online/visibilitychange/MIDDLEWARE_CONNECTION_CHANGED/storage) with no `removeEventListener`; `lib/clientLogs.ts` (9), `lib/ipc.ts` (3) similar. If `initCacheRealtime` is ever invoked more than once (fast-refresh, multi-window, re-init), listeners accumulate → duplicate revalidations/log handlers.
- Root cause: module-init listeners with no idempotency guard / teardown.
- Affected: `packages/ui/lib/cacheRealtime.ts:41-51`, `lib/clientLogs.ts`, `lib/ipc.ts`.
- Fix path: guard init with a module-level `initialized` flag, or return a disposer and register listeners once; verify single-init.

#### FE-04 — Raw `console.log` on every focus change
- Severity: Low. `useAppFocus.ts:13` logs `[AppFocus] state:` on every transition. Hot-ish path noise in prod. Fix: gate behind debug flag / `frontendLog`.

---

### Architecture

#### ARCH-01 — Two windowing modules (virtualization fork)
- Severity: High. `components/ChatView/messageWindow.ts` (`MAX_LOADED=160`) vs `lib/chat-engine-v2/messageWindow.ts` (`WINDOW_SIZE=200`); store's `trimSessionMessageWindow` (`store.ts:2195`) has no ChatView caller. Two virtualization implementations with different constants = the substrate for I8 scroll jumps and a blocker to the I2 collapse. Fix: one virtualization owner (Stage 6 / Issue #6).

#### ARCH-02 — Two persistence/sync systems
- Severity: High. `apps/middleware/src/db` (sqlite + `repo.messages`/`repo.runs`) AND `packages/server/src/sync/{anchor,outbox,pull}.ts` (local-first outbox/pull). Overlapping responsibility for durable message/run state → divergence + double-maintenance risk. Fix: confirm which is authoritative; collapse or formally layer them; document the contract.

#### ARCH-03 — Build artifacts committed under `src-tauri/target/**`
- Severity: Low (hygiene). `packages/desktop/src-tauri/target/release/bundle/**` contains 4 duplicate copies of a 4,276-LOC middleware file (and the whole bundled middleware). These are build outputs polluting the repo + grep + diff. Fix: gitignore `src-tauri/target/`; confirm nothing source depends on them.

---

## Verification status & what needs the prod box

- **Verified here (dev + static):** all root causes above (file:line). Chat-core I1–I10 empirically reproduced via `tests/repro/`. I1 + I2-part-1 fixes proven with before/after runtime runs.
- **Needs prod-capable env (16GB/4-core/4GB swap):** the I2 single-writer collapse verification, and any change touching streaming-under-load heap/concurrent-mode (I3 DOM-owned text, ARCH-01 virtualization swap, BE-01/02 under realistic client counts). Production build OOMs on this host.

## Recommended execution order (when env ready)

1. **I2 collapse** (single-writer) — unblocks I3/I5/I8 reasoning; per `docs/ISSUE_2_HANDOFF.md`.
2. **I3 re-animation** — DOM-owned monotonic text (highest user-visible win).
3. **I4 + I5** — connection-config gate + epoch-gated recovery (kills startup churn + replay).
4. **BE-02 + BE-01** — server-side session routing + backpressure (kills I6 + memory risk).
5. **ARCH-01 + I8** — single virtualization owner.
6. **I7** — markdown nesting fix (cheap, can do anytime).
7. **BE-03 + FE-02/FE-01/FE-03** — decomposition + leak hardening.
8. **ARCH-02** — persistence consolidation (largest architectural item; design first).
9. **PERF-01/02/03** — measure TTFT/bootstrap, throttle hot-path logging.

> Each issue executes under the 6-criteria sign-off: root cause fixed · implemented · no regressions · targeted tests · real runtime verified · clean/production-safe.
