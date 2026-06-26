# Chat Issue Inventory — EMPIRICAL (live repro, 2026-06-26)

Method: ran middleware (:8787, connected to gateway :18789) + UI (`next dev` :3000),
drove headless Chromium (Playwright) against real sessions, captured console +
WebSocket frames + page errors + an in-page MutationObserver tracking assistant
text-length resets. Harness + raw logs: `tests/repro/` (driver.py, scenarios.py,
runs/*/events.jsonl + screenshots). Every issue below is observed, not inferred.

---

## P0 — confirmed root causes

### I1. Redundant global WebSockets (2–3 per view)
- Evidence: on load with NO chat open, **2** connections to
  `ws://127.0.0.1:8787/api/stream/ws` (smoke run `ws_open_count` minus HMR socket).
  Opening a chat adds a 3rd.
- Cause: `openPatchStreamV2` opened by 3 call sites — `store.ts:1991`,
  `runWatcher.ts:172`, `ChatView/index.tsx:1079`. Each receives the full global
  patch stream independently.
- Impact: 2–3× network + 2–3× patch processing; reconnect storms.

### I2. Multi-writer DOUBLE-APPLY (the core defect)
- Evidence: during streaming, `chat-rebuild.assistant-delta.render-state` logs
  **twice per cursor** (every cursor 117888…117944 appears 2×). During scroll,
  `chat-rebuild.window.older-fetch-resolved` fires **32×** for **16**
  `older-fetch-start` — every fetch resolved twice.
- Cause: `applyChatPatch` called in 3 places — `store.ts:1804`,
  `runWatcher.ts:112`, `ChatView/index.tsx:1138` — all processing the same frames.
- Impact: duplicate state computation, the substrate for re-animation, dupes,
  ordering churn, wasted renders.

### I3. Typewriter RE-ANIMATION on session switch (headline bug) — REPRODUCED
- Evidence (scenario `stream_switch`): while a message streamed in chat A, toggling
  B↔A four times produced **8 text-reset events**. The live assistant row reset
  **443→26** then **988→26** characters. `26 ≈ slice(0, 24)` prefix reseed.
- Cause chain: switch-back REMOUNTS `ChatView` → `useStreamingText` re-inits with
  `initialDisplay` reseeded to a ~24-char prefix (`useStreamingText.ts:49–51`) →
  re-reveals from scratch. Amplified by I2 (double-apply) and I5 (recovery).
- Matches the report exactly ("same response re-animated 5–6×").

### I4. Startup connection race
- Evidence: 2× `unhandledrejection: "Middleware connection is not configured"` +
  `ws.connect.fail` + `patch-stream.error` + `ws.disconnect code 1006` on load —
  WHILE another stream connects and receives frames.
- Cause: multiple consumers call the stream/middleware-URL before config is
  hydrated; one path throws, others succeed → abnormal-close churn + reconnect.

### I5. Bootstrap-recovery re-fires on every session switch
- Evidence: `chat.stream.recovery-decision` (6×), `patch-stream.bootstrap-recovery`
  at `afterCursor:0` (full replay attempt) and at older cursors, on each switch.
- Impact: redundant re-bootstrap/replay → flicker + re-animation trigger + load.

## P1 — correctness / rendering

### I6. Global-stream cross-talk
- Evidence: while viewing DreamHour chats, 36 patch frames for an unrelated
  telegram session were received and applied (`global-chat-session.patch-applied`).
- Impact: every view processes every session's patches (CPU + log noise); raises
  risk of state leakage if keying is ever wrong.

### I7. Hydration error: `<div>` inside `<p>`
- Evidence: console `"In HTML, <div> cannot be a descendant of <p>. This will
  cause a hydration error."` Concrete invalid nesting in a message renderer
  (likely MarkdownContent block element inside a paragraph).

### I8. Infinite-scroll viewport-jump risk + double-resolve
- Evidence: each upward load grew scrollHeight ~12k px (43,881→56,159→61,334);
  `older-fetch-resolved` double-fired (see I2). Hand-rolled window
  (`ChatView/messageWindow.ts` + `chat-engine-v2/messageWindow.ts`, two of them).
- Impact: scroll-anchor races → jumps; candidate for react-virtuoso replacement.

## P2 — performance (middleware + client)
- I9. Middleware TTFT/bootstrap latency: capture before/after (UI first compile
  26s is dev-only; measure `/api/chat/bootstrap` + first-token timing).
- I10. Excessive client logging on the hot path (every patch logs multiple lines)
  — fine for repro, throttle/gate for production.

---

## Issue → stage mapping (feeds SPEC §9)
- I4 startup race → Stage 2 (single writer/owner) + connection-config guard.
- I1 redundant WS → Stage 3 (one ref-counted stream in the store).
- I2 double-apply → Stage 2 (store is the only `applyChatPatch` caller).
- I6 cross-talk, ordering → Stage 4 (seq/epoch reducer; per-session routing).
- I3 re-animation, I5 recovery → Stage 5 (DOM-owned text, no reseed on remount;
  monotonic prefix; recovery gated by epoch not blind afterCursor:0).
- I8 scroll, I7 hydration → Stage 6 (virtualization consolidation + valid DOM).
- I9/I10 perf → Stage 7.

## Verification assets (reusable)
- `tests/repro/scenarios.py {switch|scroll|stream|stream_switch}` — re-runnable
  before/after each stage to PROVE the fix (e.g., re-animation count must go 8→0;
  ws_open_count 3→1; double-apply 2×→1×).
