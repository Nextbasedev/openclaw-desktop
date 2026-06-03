# 0004 — Phase 3a: Store runtime bridge (RAF store + React provider/hook)

**Branch:** `v5`
**Scope:** `packages/ui/components/chat/store/{store,applyOlder,messageRow}.ts`,
`components/chat/runtime/**` (new); `applyBootstrap.ts` refactor.
**Status:** complete — 26/26 tests pass (7 new), UI typecheck clean
**Depends on:** 0001 (reducer), 0003 (sync client)

---

## 1. Summary

Connects the Phase 1 reducer and Phase 2 sync client into something React can consume,
without drawing any UI yet. Adds a **framework-agnostic, RAF-batched store**, an
**older-pagination merge**, and the **React runtime** (`ChatSyncProvider` + `useChatSession`)
that wires the middleware transport + WebSocket into the store. Phase 3 is split:
3a = this plumbing (headless-testable); 3b = the visible timeline.

## 2. What was added

Store layer (headless, tested):
- `store/store.ts` — `createChatStore(sessionKey, opts)`: `getState`/`subscribe`
  (useSyncExternalStore-shaped), `bootstrap`, `enqueuePatch` (**RAF-coalesced** — one
  commit per frame), `mergeOlder`, `setLoadingOlder`, `setConn`, `flush`, `destroy`.
  Gap from the reducer → `opts.onNeedBootstrap()`.
- `store/applyOlder.ts` — `applyOlderMessages`: merge an older page into history,
  idempotent, updates `oldestLoadedSeq`/`hasOlder`. Never touches cursor or live tail.
- `store/messageRow.ts` — shared `rowFromMessage` / `chooseKey` / `toolRowFromProjection`,
  extracted so bootstrap and older-pagination build rows identically.
- `applyBootstrap.ts` — refactored to use `messageRow` (now 60 lines, was 130).

React runtime (typecheck-gated; no DOM tests):
- `runtime/transport.ts` — `ChatTransport` over `lib/middleware-client.middlewareFetch`
  (auth + base URL reused, not rebuilt) + `currentMiddlewareBaseUrl()`.
- `runtime/ChatSyncProvider.tsx` — per-session: builds `ChatApiClient` + `ChatSyncClient`
  (WS via `createWebSocketFactory`+`streamUrl`), pipes `onBootstrap/onPatch/onConn` into
  the store; provides `{ store, api }` via context; cleans up on unmount/sessionKey change.
- `runtime/useChatSession.ts` — `useSyncExternalStore` binding exposing
  `history`/`live`/`activeRun`/`conn`/`generating`/`thinking`/`pagination` + `send`/`abort`/`loadOlder`.
- Added `ChatSyncClient.resync()` (public re-bootstrap, used by `onNeedBootstrap`).

## 3. Why these choices

- **RAF batching:** the middleware coalesces deltas at ~16ms; the client mirrors that so
  a burst of patches in one frame becomes a single React commit — directly prevents the
  v4 "20–40 re-renders per tool.update burst" storm.
- **`useSyncExternalStore` over Jotai:** simpler, React-19-native, and keeps the store
  framework-agnostic + headless-testable. `getState` returns a stable reference until a
  commit replaces it, satisfying the hook's snapshot contract. (Jotai remains available
  if per-atom selectors are needed in 3b for finer re-render isolation.)
- **Shared `rowFromMessage`:** bootstrap and older-load must produce identical row
  identity/keys; one builder guarantees that and shrank `applyBootstrap`.
- **Reuse `middlewareFetch`:** don't rebuild auth/base-url/fetch — wrap the existing
  client behind the `ChatTransport` seam.

## 4. Workarounds / gotchas

- **TS contextual typing on a generic transport method.** Implementing
  `request<T>(path, init)` inside an object literal did NOT inherit param types from the
  `ChatTransport` interface (generic method ⇒ no contextual inference) → TS7006. Fix:
  annotate the params explicitly in the implementation. Not a hack — just TS's rule.
- **Bootstrap supersedes the queue.** `store.bootstrap()` clears any queued patches and
  cancels a pending flush, because a fresh snapshot makes older queued deltas stale
  (important on re-bootstrap/gap recovery).
- **No jsdom in this package** (`vitest` env = node), so the React files are verified by
  `typecheck` + (later) `build`, not unit tests. The *logic* under them (store, merge,
  reducer, sync) is fully unit-tested headlessly — which is where the bugs live.

## 5. What improved

- A single, RAF-batched source of truth React can subscribe to, with re-render-friendly
  stable snapshots.
- Older-message pagination is a tested, idempotent merge (no viewport-corrupting dupes).
- Provider reuses existing middleware auth/transport; gap recovery is wired end-to-end
  (reducer → store.onNeedBootstrap → client.resync).

## 6. What to test

Automated (this commit) — `pnpm --filter ui vitest run components/chat` (26 tests):
1. Store coalesces N queued patches into ONE commit (no emit until flush).
2. `bootstrap` resets state and drops stale queued patches.
3. Cursor gap in a batch → `onNeedBootstrap` fired.
4. subscribe/unsubscribe gates notifications.
5. `applyOlderMessages` prepends in seq order, updates `oldestLoadedSeq`, idempotent,
   clears `hasOlder` when all known messages are loaded.

`pnpm --filter ui typecheck` → clean (incl. the React runtime files).

Manual (deferred to 3b, once UI exists): live send/stream/scroll against a real session.

## 7. Follow-ups (Phase 3b)
- Install `@tanstack/react-virtual`; vendor AI Elements.
- Build `ChatScreen`/`ChatViewport`/`VirtualHistory`/`LiveTail`/rows/`Composer`, reading
  `useChatSession()`; wire `loadOlder` to a top sentinel with scroll anchoring.
- Gate behind `NEXT_PUBLIC_CHAT_V5`; verify with `build` + a real session.
