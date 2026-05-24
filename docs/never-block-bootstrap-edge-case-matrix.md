# Never-Block Bootstrap — Edge Case Matrix

## Change
After the first successful sync, `/api/bootstrap`, `/api/chats`, and `/api/sessions` never block on `syncGatewaySessions()`. They serve from in-memory `compatState` immediately and sync in background. Stale window: up to 5 minutes.

## API Dependents

### Frontend endpoints that depend on `/api/bootstrap`:
1. **AppPage.tsx** — `loadMiddlewareStartupBootstrap()` → sidebar, spaces, projects, sessions
2. **Route resolution** — `route.chat.resolved` needs chat list to map `chatId` → `sessionKey`
3. **Workspace restore** — tab layout uses chat list from bootstrap

### Frontend endpoints that depend on `/api/chats`:
1. **ChatsSection** sidebar — `fetchChatsForSpace()` → renders sidebar chat list
2. **Quick-send** — `invalidateChatListCache()` after create → refreshes sidebar
3. **Chat create/delete/rename/archive** — all call `invalidateChatListCache()`

### Frontend endpoints that depend on `/api/sessions`:
1. **Topics** — session list for topic-based navigation
2. **Inspector** — session metadata for agent activity view

## Edge Cases

### 1. Route Resolution with Stale Chat List

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| User refreshes on `/chat_xyz` but `chat_xyz` was deleted from another client | Route resolves to deleted chat → empty content | Low | Bootstrap returns stale list with the chat → UI shows it. Next background sync removes it |
| User refreshes on `/chat_xyz` but chat was created from Telegram after last sync | Route can't find `chat_xyz` → falls back to home | Medium | This is a new chat from another client — unlikely to have a desktop URL for it |
| Chat renamed → stale name shown in sidebar | Cosmetic only | None | Background sync updates within seconds |

**Verdict: SAFE** — route resolution uses `chatId` which is stable. Stale metadata doesn't break routing.

### 2. Workspace Tab Restore

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Tabs restored from localStorage with stale bootstrap | Tab shows old chat name | None | Name updates when background sync completes |
| Tab for deleted chat restored | Tab exists but chat is gone | Low | Opening the tab shows empty → user closes it |
| New tabs from another client not restored | Expected — other client's tabs aren't in localStorage | None | Not a regression |

**Verdict: SAFE** — tab restore reads from localStorage, not from `/api/bootstrap` directly.

### 3. Sidebar Chat Order

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Chat activity from Telegram changes order | Sidebar shows old order | Cosmetic | Background sync re-sorts; patch stream updates activity timestamps |
| New chat from desktop appears immediately | Must work | Critical | `POST /api/chats` adds to `compatState` + calls `saveCompatState()` which invalidates cache. Next GET serves the new chat immediately since it's in `compatState` |
| New chat from Telegram doesn't appear | Expected delay | Low | Background sync picks it up |

**Verdict: SAFE** — desktop mutations update `compatState` synchronously before responding. Only cross-client changes are delayed.

### 4. Space Switching

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Switch space → stale chat list for new space | Shows chats from last sync | Low | Background sync updates; `switchSpace` calls `saveCompatState()` which invalidates |
| Create space from another client → not visible | Not in `compatState` | Low | Background sync adds it |

**Verdict: SAFE** — space mutations invalidate cache.

### 5. Session Status in Sidebar

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Session starts running → sidebar doesn't show running indicator | Patch stream delivers status independently | None | Sidebar running indicators come from patch stream, not from `/api/bootstrap` |
| Session error → sidebar doesn't update | Patch stream delivers error | None | Same — patch stream is the real-time source |

**Verdict: SAFE** — session status is driven by patch stream, not by bootstrap polling.

### 6. Projects and Topics

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Project created from another client → not visible | Not in stale `compatState` | Low | Background sync adds it |
| Topic deleted → still visible | In stale `compatState` | Low | Background sync removes it; clicking shows empty |
| Project rename → old name | Cosmetic | None | Background sync updates |

**Verdict: SAFE** — projects/topics rarely change from multiple clients simultaneously.

### 7. Concurrent Requests During Background Sync

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Request A serves stale, background sync runs, Request B arrives before sync completes | Request B also serves stale | None | Both get same `compatState` snapshot — consistent |
| Background sync updates `compatState` while response is being built | Race condition on in-memory object | Low | JavaScript is single-threaded — sync completes atomically before next request handler runs |
| Background sync fails silently | `compatState` stays stale | Low | Next request tries background sync again; `catch(() => {})` swallows error gracefully |

**Verdict: SAFE** — JavaScript single-threaded execution prevents races.

### 8. Gateway Disconnect During Stale Window

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Gateway disconnects → all requests serve stale | Users see last known state | Good | Better than failing with error; stale data is functional |
| Gateway reconnects → cache should refresh | Background sync runs on next request | OK | `syncGatewaySessions` already checks `connected` status |
| Gateway disconnected for >5min → cache expires | Next request blocks on sync → sync fails → error | Medium | `syncGatewaySessionsUncached` returns early when disconnected; `compatState` is preserved |

**Verdict: SAFE** — stale serving during disconnect is better than errors.

### 9. Mutation During Stale Serve

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| User creates chat → `saveCompatState()` adds to `compatState` → cache invalidated | Next GET sees new chat | None | `invalidateBootstrapCache()` sets `lastFullSyncAtMs = 0`, BUT `compatState` already has the new chat. Even with invalidation, since `lastFullSyncAtMs > 0` is now false, the next request would block on sync. **Wait — this is a problem.** |

**⚠️ ISSUE FOUND:** After mutation, `invalidateBootstrapCache()` sets `lastFullSyncAtMs = 0`. The next request sees `lastFullSyncAtMs === 0` → blocks on full sync (3-5s). But `compatState` already has the mutation applied. The blocking sync is unnecessary.

**Fix needed:** After mutation, set `lastFullSyncAtMs = Date.now()` instead of `0`. The mutation already updated `compatState` in-memory. The background sync will reconcile later.

### 10. First Load After Middleware Restart

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Middleware restarts → `compatState` loaded from SQLite → `lastFullSyncAtMs = 0` | First request blocks on sync | Expected | Can't serve without at least one sync; SQLite `compatState` might be stale |
| Middleware restarts → SQLite has recent data | Could serve from SQLite immediately | Optimization | Set `lastFullSyncAtMs` to SQLite's `updated_at_ms` on boot → skip first blocking sync if data is <5min old |

**Verdict: ACCEPTABLE** — first load after restart must sync. Could optimize later.

## Issue Found: Fix Needed

**`invalidateBootstrapCache()` should NOT set `lastFullSyncAtMs = 0` after mutations.**

Current:
```typescript
export function invalidateBootstrapCache() { lastFullSyncAtMs = 0; }
```

Should be:
```typescript
export function invalidateBootstrapCache() {
  // Don't reset to 0 — compatState already has the mutation applied.
  // Setting to 0 would force the next request to block on a full sync
  // even though the in-memory state is already correct.
  // Instead, keep serving from compatState and let background sync reconcile.
  // Only reset to 0 on Gateway reconnect or explicit full-refresh.
}
```

Or simpler: just remove the invalidation entirely. Mutations update `compatState` directly and `saveCompatState()` persists to SQLite. The next GET reads from `compatState` which is already up-to-date.

## Summary

| Category | Safe? | Notes |
|----------|-------|-------|
| Route resolution | ✅ | chatId is stable |
| Tab restore | ✅ | Reads from localStorage |
| Sidebar order | ✅ | Desktop mutations are synchronous |
| Space switching | ✅ | Mutation invalidates |
| Session status | ✅ | Patch stream is real-time source |
| Projects/topics | ✅ | Rarely concurrent |
| Concurrent requests | ✅ | JS single-threaded |
| Gateway disconnect | ✅ | Stale > error |
| Mutation during stale | ⚠️ | Fix: don't reset lastFullSyncAtMs to 0 |
| First load | ✅ | Must block once |
