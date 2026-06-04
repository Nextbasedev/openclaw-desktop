# Plan: Instant, Flicker-Free First Message (and Session Open)

> Goal for a FRESH implementation session. This doc is self-contained — read it
> top to bottom before touching code. RPI: this is the **Plan**. Do Research
> against the anchors below, then Implement in phases, each phase tested + its
> own commit. Branch base: `v5-dixit` (Nextbasedev/openclaw-desktop).

## 1. The user-visible problem

When opening a session and sending the first message, the desktop app:
1. Shows **blank** for a moment (existing session messages load slowly).
2. User sends a message — it appears.
3. The message then **disappears**, **old messages re-render**, then the user's
   message **re-appears**. (UI flicker / re-seed.)

Hard constraint from product owner (Dixit): **do NOT "solve" this with the naive
"render local cache, then replace it with the server payload" pattern.** That
replace-the-whole-list approach is exactly what causes the flicker. The fix must
be a **stable, keyed merge** where unchanged rows never re-mount and newer local
state is never clobbered by an older/late server payload.

## 2. How it works today (context you need)

### 2.1 Send path
Frontend `useChatMessages` send (`packages/ui/hooks/useChatMessages.ts` ~2330):
- Sets `isSending`, generates `optimisticId`, renders the user's message
  optimistically into the local timeline, then POSTs `/api/chat/send`.
- For a brand-new session it **skips bootstrap** (`chat.bootstrap.skip-initial-optimistic`,
  ~1887) and relies on the patch stream.

Backend `POST /api/chat/send` (`apps/middleware/src/features/chat/routes.ts` ~919):
- **Synchronous (before HTTP 200):**
  1. If session not local → `await gateway sessions.create` (**first-message-only blocking round-trip**).
  2. Optional `await gateway sessions.patch` (execPolicy).
  3. `await ensureSessionSubscribed`.
  4. Insert optimistic user row (`insertOptimisticMessage`, `addOptimisticUser`).
  5. `appendProjectionEvent("chat.message.upsert", semanticType chat.user.created, optimistic)` → `patchBus.broadcast`.
  6. `upsertSession(status running)` → `appendProjectionEvent("chat.status", thinking)` → broadcast.
  7. **HTTP 200.**
- **Async (`sendQueue.run`, ~1115):**
  1. `await gateway chat.send` (the LLM run — long).
  2. `await gateway chat.history (limit 200)`.
  3. `confirmOptimisticUser(sessionKey, clientMessageId, gatewayUserEcho)` → broadcast `chat.user.confirmed`.
  4. Project assistant/history rows → broadcast `chat.history` patches.
  5. `chat.status` done/error.

### 2.2 Bootstrap + seed path
- Open session → `GET /api/chat/bootstrap?sessionKey=…` → `seedGlobalChatSession`.
- `seedGlobalChatSession` (`store.ts` ~1794) decides whether to **preserve** local
  messages/activity vs **replace** with the incoming snapshot, via:
  - `hasNewerCursor = state.cursor > incomingCursor && state.messages.length > 0`
  - `hasSameCursorLiveState`, `incomingPartialDropsLocalMessages`, etc.
  - If none → `state.messages = dedupeChatMessages(params.messages)` (**replace**).

### 2.3 THE ROOT CAUSE — two cursor scales that get compared
- **Bootstrap `cursor`** = `latestProjectionEvent(sessionKey).cursor` … BUT served
  via the local-first fast path it is effectively the session's small projection
  position (observed `cursor: 2`).
- **Live/optimistic patch `cursor`** = `appendProjectionEvent(...).cursor` = the
  **global** `v2_projection_events` autoincrement (observed `55219`).
- `seedGlobalChatSession.hasNewerCursor` compares `state.cursor` (which jumps to
  the **global** value after an optimistic/live patch applies) against
  `incomingCursor` (the **per-session/small** bootstrap cursor). Because the two
  are on different scales, the "is this newer?" decision is unreliable:
  - Observed in logs: `global-chat-session.seed … preservedNewerLiveState:false,
    preservedLocalMessages:false` — i.e. a **late bootstrap clobbered newer state**.
- Compounding: bootstrap is **slow** (gateway/event-loop), so the bootstrap
  response often lands **after** the user already sent → the clobber happens
  right on top of the optimistic message → the exact flicker.
- (Related, already FIXED in `84aa56cf`: stale persisted global cursor after a
  backend redeploy caused `focused-session-behind-global-cursor` recovery loops.
  Keep that fix; this plan is the next layer.)

## 3. Design principles (the bar every phase must meet)
1. **Single source of truth** = the in-memory store, keyed by **stable row keys**:
   `client:<clientMessageId>` (optimistic user), `run:<runId>` (assistant),
   `msg:<id>` (history). NEVER key by array index or content.
2. **Bootstrap/history is a MERGE, never a wholesale replace** when the session
   already holds newer or unconfirmed-local rows.
3. **Cursors must be comparable.** A "newer than" decision may only compare values
   on the same monotonic scale.
4. **Optimistic → confirmed reconciles IN PLACE** on the same row key. No insert
   of a second row, no reorder, no remount.
5. **Stale/late responses self-drop.** A bootstrap/history payload older than the
   store's current state must merge-under or be ignored — never clobber.

## 4. Implementation phases (each = its own commit + tests)

### Phase 1 — Unify the cursor scale (backend) [enables everything else]
Problem: bootstrap returns a per-session-scale cursor; live patches use the global
`v2_projection_events` cursor. Make them the same scale.
- In `routes.ts` bootstrap (both the local-first fast path ~1474 and the cold
  path), set the returned `cursor` to the session's **global** latest projection
  cursor: `SELECT max(cursor) FROM v2_projection_events WHERE session_key = ?`
  (add a repo method `latestSessionCursor(sessionKey)` in `repo.messages.ts`).
- Acceptance: after bootstrap, `state.cursor` is on the same scale as any live
  patch cursor; `hasNewerCursor` becomes meaningful. Existing 184 middleware
  tests stay green; add a test asserting bootstrap cursor == max event cursor for
  the session.
- Failure mode to guard: a session with **no** projection events yet → return 0,
  not NULL.

### Phase 2 — Non-destructive seed (frontend `seedGlobalChatSession`)
- Replace the "replace vs preserve whole list" branch with an **always-merge by
  key** reducer:
  - Build incoming-by-key map; iterate existing rows; for each key, keep the row
    with the higher provenance (confirmed > optimistic; higher per-row cursor
    wins). Append incoming rows not already present, in canonical order.
  - **Never drop** an optimistic/unconfirmed row (`__clientOptimistic`) just
    because the incoming snapshot lacks it.
- Add a **monotonic guard**: if `incomingCursor < state.cursor` AND the incoming
  snapshot is `historyCoverage:"full"` of an *older* epoch, treat it as a
  refresh-merge, not a reseed. (Phase 1 makes this comparison valid.)
- Acceptance tests (extend `store.test.ts`):
  - Late `full` bootstrap with cursor < state.cursor does NOT remove the
    optimistic user row and does NOT change row order.
  - Optimistic row reconciles to confirmed under the same key (no dup).

### Phase 3 — Instant open from warm cache, background reconcile
- On session open, paint synchronously from warm cache (`warmChatCache.ts` /
  `chatListCache.ts`) — already partially present; ensure the subsequent
  bootstrap refresh goes through the Phase-2 **merge** path, never a replace.
- Gate: the loading spinner/`loading:true` must not blank an already-painted
  warm timeline. Open with warm messages → `loading:false` immediately.
- Acceptance: opening a previously-seen session shows messages in the first frame
  (no blank), even if `/api/chat/bootstrap` takes seconds.

### Phase 4 — Cut first-message critical-path latency (backend)
- `sessions.create` for a brand-new session: move OFF the synchronous path. Either
  fire-and-forget before the optimistic broadcast, or rely on `chat.send` to
  create the session lazily. The optimistic broadcast + HTTP 200 must not wait on
  a gateway round-trip.
- `ensureSessionSubscribed`: run in parallel with the optimistic insert, don't
  `await` it before broadcasting the optimistic patch.
- Keep the async `chat.send` / `chat.history` as-is, but see Phase 5 for how their
  results land.
- Acceptance: time from POST `/api/chat/send` received → optimistic patch
  broadcast is independent of gateway latency (measure with the existing
  `elapsedSinceRequestMs` logs).

### Phase 5 — History reload lands as keyed patches, not a reseed
- After `chat.send`, the `chat.history (limit 200)` result currently re-projects
  and can present as a near-full snapshot. Ensure it is emitted as **incremental,
  keyed** `chat.message.upsert` / `chat.user.confirmed` patches that update
  existing rows in place — never as a payload that the frontend treats as a fresh
  full seed.
- The frontend apply path (`applyPatches.ts` / `useChatMessages` apply-decision
  ~2025 `fresh-bootstrap-current-generation`) must route these through the
  in-place reconcile, not `seedGlobalChatSession`.
- Acceptance: sending a message in an existing session produces zero full
  re-renders of prior rows (assert via render-state logs / a store-level test
  counting row-key churn).

## 5. Acceptance / definition of done
- Open existing session: first paint < 1 frame from warm cache, no blank, no flash.
- Send (first or subsequent): user message visible within one frame and **never**
  disappears; reconciles optimistic→confirmed on the same key; no old-history flash.
- Inject a slow/late bootstrap (test + manual with throttled gateway): newer
  optimistic/live state is preserved; no clobber.
- All existing tests green; new tests for Phases 1, 2, 5.
- Backend changes (Phases 1, 4, 5) → middleware redeploy. Frontend changes
  (Phases 2, 3, 5-frontend) → new desktop build.

## 6. Code anchors (start here)
- Backend send: `apps/middleware/src/features/chat/routes.ts` `POST /api/chat/send` ~919; async `sendQueue.run` ~1115.
- Backend bootstrap + cursor: same file, local-first ~1455-1540, `const cursor = latestEvent?.cursor`; `repo.messages.ts` `latestProjectionEvent` ~784, add `latestSessionCursor`.
- Backend stream/hello + epoch reset (already done): `apps/middleware/src/features/patches.ts` `/api/stream/ws`.
- Frontend store: `packages/ui/lib/chat-engine-v2/store.ts` `seedGlobalChatSession` ~1794, `handleFrame` (hello epoch reset), `applyPatch*`.
- Frontend apply: `packages/ui/lib/chat-engine-v2/applyPatches.ts`; `hooks/useChatMessages.ts` send ~2330, apply-decision ~2025, skip-initial-optimistic ~1887.
- Warm cache: `packages/ui/lib/warmChatCache.ts`, `packages/ui/lib/chatListCache.ts`.
- Tests: `apps/middleware/tests/*`, `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`.

## 7. Out of scope / do NOT do
- Do NOT add a "render local then wholesale-replace with server data" path (flicker).
- Do NOT reintroduce per-session-vs-global cursor comparisons before Phase 1.
- Do NOT remove the epoch-reset fix from `84aa56cf`.
