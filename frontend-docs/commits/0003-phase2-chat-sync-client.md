# 0003 — Phase 2: ChatSyncClient (WS lifecycle + gap/reconnect recovery)

**Branch:** `v5`
**Scope:** `packages/ui/components/chat/sync/**` (new)
**Status:** complete — 19/19 tests pass (8 new), UI typecheck clean
**Depends on:** 0001 (store reducer), Approach A plan §3

---

## 1. Summary

The network/sync layer that feeds the Phase 1 reducer: bootstrap → subscribe the
WebSocket patch stream → forward patches in cursor order, with **gap / replay-window
recovery (re-bootstrap)** and **reconnect backoff**. Pure state machine — no DOM, no
store, fully dependency-injected so it's unit-tested in node with a fake socket.

## 2. What was added

- `sync/socket.ts` — `SyncSocket` interface + `SocketFactory`, `streamUrl()`
  (http→ws + `?afterCursor=`), and a browser `WebSocket` adapter.
- `sync/apiClient.ts` — `ChatApiClient` + `ChatTransport` seam. Typed wrappers over
  the REST surface: `bootstrap`, `fetchMessages` (older via `beforeSeq`), `send`,
  `abort`, `toolResult`, `search`, `resolveApproval`, `patchesAfter`. No logic.
- `sync/ChatSyncClient.ts` — the state machine (135 lines). DI: `{ bootstrap,
  openSocket, schedule }`; handlers: `{ onBootstrap, onPatch, onConn }`.
- `sync/__tests__/fakeSocket.ts` — `FakeSocket` + snapshot/patch/hello frame factories.
- `sync/__tests__/chatSyncClient.test.ts` — 8 tests.

## 3. State machine (why it's shaped this way)

`start()` → `doBootstrap("connecting")`:
1. bootstrap → `onBootstrap(snapshot)`, `lastCursor = snapshot.cursor`, `openSocket(lastCursor)`.
2. WS `open` → `attempt=0`, conn `live`.
3. WS `hello` → if `recovery === "bootstrap"` or `replayWindowExceeded`, **re-bootstrap**
   (partial replay would apply old running/user patches without their later canonical
   ones — an inconsistent transcript, exactly the kind of thing that bit v4).
4. WS `patch`:
   - `cursor <= lastCursor` → drop (duplicate).
   - `cursor > lastCursor + 1` (hole) → **re-bootstrap** (never partial-apply a gap).
   - else → `onPatch(patch)`, advance `lastCursor`.
5. WS `close`/`error` → `scheduleRetry(openSocket)` with backoff; resubscribe at
   `lastCursor` (no lost/duplicated patches across reconnect).

Backoff: `250ms · 2^attempt`, capped 5s, + jitter; `attempt` resets on a successful
open or bootstrap.

The cursor guard is intentionally duplicated here (frame level) and in the reducer
(`applyPatch`): the client avoids handing a known-bad stream to the store, and the
reducer stays independently safe if used without the client.

## 4. Workarounds / gotchas

- **Bootstrap-failure ≠ socket-drop.** First cut routed a failed bootstrap into the
  socket-reconnect path, which would `openSocket(0)` with no snapshot. Fixed: a failed
  bootstrap schedules a **bootstrap retry**; only a dropped socket reopens the socket.
  Both share one `scheduleRetry(action)` backoff wrapper.
- **Async re-bootstrap timing in tests.** `doBootstrap` is async; `lastCursor`/new
  socket update only after the bootstrap promise resolves (a microtask). Tests assert
  those after an explicit `await flush()` (`setTimeout(0)`); synchronous side effects
  (conn emit, dup-drop, `bootstrapCalls`) are checked without waiting.
- **DI over globals.** `schedule` is injected (default `setTimeout`) so reconnect/backoff
  is testable without fake timers; `openSocket`/`bootstrap` injected so no real network.
  The app wires these to `streamUrl` + `createWebSocketFactory` and
  `lib/middleware-client.middlewareFetch` in Phase 3.

## 5. What improved

- Reliable session sync with first-class recovery — the replay-window-exceeded case
  (already signaled by the middleware's `recovery:"bootstrap"`) is handled correctly.
- Reconnects never drop or double-apply patches (resubscribe at `lastCursor`).
- Reuses existing `middleware-client` for transport instead of a new fetch stack.
- Layer stays headless → the same reducer + client can be tested and reused outside
  React.

## 6. What to test

Automated (this commit) — `pnpm --filter ui vitest run components/chat` (19 tests):
1. bootstrap → WS subscribed at the snapshot cursor; `open` → conn `live`.
2. patch frames forwarded in order; cursor advances.
3. duplicate/old cursors ignored.
4. cursor gap → re-bootstrap (no partial apply), new socket at the new cursor.
5. `hello` recovery → re-bootstrap.
6. socket drop → backoff reconnect, resubscribe at `lastCursor`.
7. `stop()` closes the socket and ignores further frames (conn → `idle`).
8. bootstrap failure → backoff retry (not a socket open).

`pnpm --filter ui typecheck` → clean.

Manual: none yet (wired to UI in Phase 3).

## 7. Follow-ups
- Phase 3: `store.ts` (Jotai bridge + RAF batching) + `ChatSyncProvider` wiring
  `ChatApiClient`(over `middlewareFetch`) + `createWebSocketFactory` into
  `ChatSyncClient`, applying `onBootstrap`/`onPatch` to the reducer; then the static
  timeline UI.
- Add a REST `patchesAfter` poll fallback after N failed WS reconnects (apiClient
  method already exists).
