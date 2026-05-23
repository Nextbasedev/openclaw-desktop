# Infrastructure Edge Case Checklist

Generated from actual code audit on 2026-05-23.
Apply this checklist to every feature that touches messaging, connections, or state.

---

## 1. WebSocket Patch Stream (`client.ts`)

**What exists:**
- `socket.onclose` → auto-reconnect with exponential backoff (500ms → 10s)
- `afterCursor` tracked per connection, replays missed patches on reconnect
- `replayHasMore` → backlog replay for large gaps

**Gaps found:**
- [ ] No ping/pong heartbeat — if OS kills socket silently (no `onclose`), WS stays dead forever
- [ ] No WS health check on app focus — `cacheRealtime.ts` revalidates bootstrap on focus but never checks WS
- [ ] `reconnectTimer` uses `window.setTimeout` — suspended by OS when app is backgrounded, may never fire
- [ ] No maximum reconnect attempts — will retry forever (acceptable but unmonitored)
- [ ] `clients:0` on patch broadcast = patches permanently lost for that client until reconnect + replay

---

## 2. App Focus/Background (`useAppFocus.ts`, `cacheRealtime.ts`)

**What exists:**
- `useAppFocus` tracks focused/blurred/background via `visibilitychange` + Tauri events
- `cacheRealtime.ts` calls `revalidateSoon()` on focus → refreshes bootstrap
- Throttled to 2s between revalidations

**Gaps found:**
- [ ] Focus revalidation refreshes bootstrap but NOT WebSocket connection
- [ ] No reconnect-WS-on-focus logic anywhere in the codebase
- [ ] `isBackgrounded` state exists but is only used for notification suppression, not for connection management
- [ ] Long background (>30min) → WS dead, warm cache stale, no automatic recovery until user manually refreshes

---

## 3. Send Flow (`useChatMessages.ts` handleSend)

**What exists:**
- `sendingGuardRef` prevents double-send
- Optimistic message created locally with `isOptimistic: true, sendStatus: "sending"`
- `flushSync` ensures immediate render of optimistic message
- `seedGlobalChatSession` sets status to "thinking"
- `sendChatV2` is HTTP (not WS) — works even if WS is dead

**Gaps found:**
- [ ] No check if WS is connected before sending — optimistic shows locally but if WS is dead, no patches arrive to confirm/update
- [ ] `seedGlobalChatSession` with `status: "thinking"` may overwrite messages if global store has stale data from another session
- [ ] If HTTP send succeeds but WS is dead → user sees "thinking" forever (no patch stream to deliver response)
- [ ] No fallback: if WS is dead after send, should poll `/api/chat/bootstrap` to get the response

---

## 4. IndexedDB / Persistent Cache (`persistentCache.ts`)

**What exists:**
- Try/catch around all IndexedDB operations
- Falls back to localStorage on IndexedDB failure
- `persistentCacheClearAll()` available

**Gaps found:**
- [ ] Quota exceeded → `catch {}` swallows error silently, no user notification
- [ ] No monitoring of storage usage — can't warn before quota is hit
- [ ] localStorage fallback has ~5MB limit vs IndexedDB's ~100MB+
- [ ] `db?.close()` in cleanup may leave orphaned connections

---

## 5. requestAnimationFrame (`store.ts`, `timelineStore.ts`)

**What exists:**
- Batch notifications use `requestAnimationFrame` for coalescing
- Sync fallback when `rAF` unavailable (SSR/tests)

**Gaps found:**
- [ ] `rAF` does NOT fire when tab/app is backgrounded — batched notifications stuck until foreground
- [ ] If app backgrounded with pending patches → `pendingNotifications` Map grows, flushed all at once on foreground (burst of updates)
- [ ] `cancelAnimationFrame` in cleanup may miss if cleanup races with frame callback

---

## 6. Middleware HTTP Client (`middleware-client.ts`)

**What exists:**
- `DEFAULT_MIDDLEWARE_FETCH_TIMEOUT_MS = 8000`
- `timeoutMs` override per request
- `AbortSignal` support
- `getMiddlewareConnection()` reads from localStorage

**Gaps found:**
- [ ] No retry logic — single attempt, if it fails user sees error
- [ ] Connection URL from localStorage could be stale (changed from another window)
- [ ] No offline detection — `fetch` will hang until timeout if network is down
- [ ] Health check (`/health`) runs on connect but not periodically

---

## 7. Gateway WebSocket (Middleware `gateway/client.ts`)

**What exists:**
- `onReconnect` callback system (added today)
- Auto-reconnect on `connect()` call
- `hasConnectedBefore` flag distinguishes initial connect from reconnect

**Gaps found:**
- [ ] Gateway WS has no ping/pong either — same silent disconnect risk as frontend WS
- [ ] `pending` requests map can grow if Gateway is unreachable but requests keep queuing
- [ ] No circuit breaker — will keep trying to connect forever

---

## 8. State Transitions (verified from code)

| From | To | Trigger | Verified? |
|------|----|---------|-----------|
| idle → thinking | User sends message | ✅ `handleSend` sets status |
| thinking → streaming | First assistant token | ✅ via patch stream |
| thinking → done | Assistant final text | ✅ via `chat.final` + backfill |
| thinking → error | Send fails | ✅ catch in `handleSend` |
| done → thinking | New user message | ✅ `handleSend` |
| any → idle | Chat unmount | ❌ Status persists in global store |
| background → focused | App focus | ✅ `useAppFocus` detects |
| focused → background | App blur | ✅ `visibilitychange` |
| WS connected → disconnected | Network drop | ⚠️ `onclose` fires but may be delayed |
| WS disconnected → connected | Auto-reconnect | ⚠️ Only via `onclose` timer, not on focus |
| sending → thinking | Optimistic + status seed | ✅ `flushSync` in `handleSend` |
| sending → error | HTTP request fails | ✅ catch block sets sendStatus |

---

## 9. State Store Method Interaction Matrix

Every pair of store methods that modify the same state must be tested:

| First call | Second call | Data loss risk? | Tested? |
|-----------|-------------|-----------------|----------|
| applyWarmCache | applyBootstrap | Warm cache replaced | ✅ |
| applyBootstrap | applyPatchMessage | Patch adds on top | ✅ |
| applyOptimistic | applyBootstrap | **Optimistic dropped** | ✅ Fixed (84bc7d4) |
| applyOptimistic | confirmOptimistic | Optimistic replaced | ✅ |
| applyPatchMessage | applyBootstrap | Patch data cleared | ✅ (by design) |
| applyWarmCache | applyOptimistic | Both preserved | ✅ |
| applyBootstrap | applyOptimistic | Optimistic added | ✅ |
| applyOptimistic | removeMessage | Optimistic removed | ✅ |
| applyPatchMessage | removeMessage | Message removed | ✅ |

**Rule: For every new store method, test it paired with EVERY existing method.**

---

## Summary: Critical gaps to fix

**P0 (causes visible bugs):**
1. WS not reconnected on app focus → user sends, patches never arrive
2. No fallback polling when WS is dead → "thinking" stuck forever after send

**P1 (degrades experience):**
3. No WS ping/heartbeat → silent disconnect undetected
4. `rAF` batching paused in background → burst of updates on foreground
5. IndexedDB quota silent failure → warm cache stops working

**P2 (robustness):**
6. No periodic health check for middleware connection
7. No circuit breaker on Gateway reconnect
8. No offline detection before HTTP requests
