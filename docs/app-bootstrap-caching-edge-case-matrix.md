# App Bootstrap Caching — Edge Case Matrix

## Current State
- `/api/bootstrap` calls `syncGatewaySessions()` → `sessions.list` (800ms) → sync/project (2-4s) → return
- `/api/chats` calls the same `syncGatewaySessions()` independently
- `syncGatewaySessions` already has a 5s dedupe cache (`SYNC_GATEWAY_CACHE_TTL_MS`) that coalesces concurrent calls
- But the sync itself + response building still takes 3-5s total

## Proposed Change
Cache the **response** of `/api/bootstrap` and `/api/chats` (not just the sync).
- Serve cached response immediately on subsequent requests within TTL
- Refresh from Gateway in background
- Invalidate on mutations (create/delete/rename/archive chat/space)

## Edge Cases

### 1. Stale Chat List

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Chat created from Telegram → sidebar doesn't show it | Missing new chat | Low | Patch stream broadcasts `chat.bootstrap` for new sessions; sidebar refresh on TTL expiry (5-10s) |
| Chat deleted from another client → ghost in sidebar | Phantom chat | Low | Next sync removes it; clicking ghost chat shows empty (recoverable) |
| Chat renamed from another client → old name shown | Stale name | Cosmetic | Auto-corrects on TTL expiry; patch stream may deliver name change |
| Chat archived from another client → still visible | Wrong visibility | Low | Next sync fixes; no data loss |
| Chat reordered by activity from another client → wrong order | Stale sort | Cosmetic | Next sync re-sorts |

**Overall risk: LOW** — all auto-correct within TTL. No data loss possible.

### 2. Stale Session Metadata

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Session status changed (idle→running) | Shows old status | Low | Patch stream delivers `chat.status` in real-time; sidebar status is already live via patch stream |
| Session's last message updated | Shows old preview | Cosmetic | Next sync updates; not critical for functionality |
| Session model changed | Shows old model | Cosmetic | Individual chat bootstrap gets current model |
| New session created (desktop UI) | Not in cached list | None | Desktop creates locally first, cache invalidated by mutation |

**Overall risk: NONE to LOW** — session status is already driven by patch stream, not by /api/bootstrap polling.

### 3. Stale Space Data

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Space created from another client | Not visible | Low | Rare multi-client scenario; TTL expiry fixes |
| Space renamed from another client | Old name | Cosmetic | TTL expiry fixes |
| Active space switched from another client | Wrong space shown | Low | Desktop tracks its own active space locally |

**Overall risk: NEGLIGIBLE** — spaces are almost never modified from multiple clients.

### 4. Cache Invalidation on Mutations

| Mutation | Needs invalidation? | Where |
|----------|---------------------|-------|
| `POST /api/chats` (create) | Yes | `/api/chats` + `/api/bootstrap` |
| `DELETE /api/chats/:id` | Yes | `/api/chats` + `/api/bootstrap` |
| `POST /api/chats/:id/rename` | Yes | `/api/chats` + `/api/bootstrap` |
| `POST /api/chats/:id/archive` | Yes | `/api/chats` + `/api/bootstrap` |
| `POST /api/spaces` (create) | Yes | `/api/bootstrap` |
| `DELETE /api/spaces/:id` | Yes | `/api/bootstrap` |
| `POST /api/spaces/:id/switch` | Yes | `/api/bootstrap` |
| `POST /api/chat/send` | No | Send doesn't change chat list |
| `GET /api/chat/bootstrap` | No | Individual chat, not list |

### 5. Startup / First Load

| Scenario | Risk | Mitigation |
|----------|------|------------|
| First load after middleware restart | No cache, must sync | Same as today — first load always syncs. Cache only helps subsequent requests |
| First load after >TTL idle | Cache expired, must sync | Same as today. Could keep stale cache + serve, sync in background |
| App refreshed within TTL | Serve cached immediately | **This is the win** — repeat loads within 5-10s are instant |
| Multiple browser tabs refresh simultaneously | Concurrent `/api/bootstrap` calls | `syncGatewaySessions` dedupe already handles this |

### 6. Gateway Disconnect / Reconnect

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Gateway disconnects while cache is valid | Serve stale cache (good!) | Better than failing; shows last known state |
| Gateway reconnects after disconnect | Cache should be invalidated | Clear cache on Gateway reconnect event |
| Gateway disconnected on first load | No cache + no sync = empty | Already handled: returns local SQLite data only |

### 7. Concurrent Mutation + Cache Read

| Scenario | Risk | Mitigation |
|----------|------|------------|
| User creates chat while cached bootstrap is being served | New chat not in cached response | Cache invalidated by POST /api/chats; next request gets fresh data |
| User deletes chat while another tab reads cache | Deleted chat still in response | Next request after TTL/invalidation removes it |
| Background sync changes data while cache is active | Cache has pre-sync data | Acceptable — cache TTL is short enough (5-10s) |

### 8. Data Consistency Between Endpoints

| Scenario | Risk | Mitigation |
|----------|------|------------|
| `/api/bootstrap` cached, `/api/chats` not (or vice versa) | Different chat lists | Both should share same cache invalidation |
| Bootstrap has old projects list, chats has new chat | Minor inconsistency | Both derived from same `compatState`; invalidation clears both |
| Spaces from bootstrap vs spaces from `/api/spaces` | Mismatch possible | `/api/spaces` reads directly from `compatState` (no sync needed); safe |

### 9. Memory / Performance

| Concern | Assessment |
|---------|------------|
| Cached response size | ~10-40KB per response. Negligible |
| Cache entries count | 2 (bootstrap + chats per space). Negligible |
| CPU overhead of caching | Avoids 800ms+ Gateway round-trip. Net positive |
| Stale data lifetime | 5-10s max (TTL). Acceptable |

## Implementation Plan

### Option A: Cache syncGatewaySessions result only (extend existing)
- Already has 5s TTL cache
- Just increase TTL or make the response building faster
- **Pro:** Minimal code change
- **Con:** Response building (sorting, projecting) still runs every time

### Option B: Cache full response objects
- Cache the entire JSON response of `/api/bootstrap` and `/api/chats`
- Invalidate on any mutation to chats/spaces
- **Pro:** Zero work on cache hit — just return the cached JSON
- **Con:** More invalidation points to track

### Option C: Serve local-first from SQLite (like chat bootstrap)
- `/api/bootstrap` and `/api/chats` read from `compatState` (already in memory)
- Skip `syncGatewaySessions()` if last sync was <30s ago
- Sync in background
- **Pro:** Consistent with chat bootstrap approach
- **Con:** `compatState` must be kept up-to-date by background sync

### Recommendation: Option C
Most consistent with the local-first pattern already established. `compatState` is already an in-memory cache of the compat layer state. The only blocking call is `syncGatewaySessions()` — skip it when recent, sync in background.

## Must Solve Before Shipping
1. **Invalidate on Gateway reconnect** — clear sync timestamp on reconnect
2. **Invalidate on mutations** — clear sync timestamp after create/delete/rename/archive
3. **First load always syncs** — no cache on cold start
4. **Background sync must not block response** — fire-and-forget with error handling

## Can Defer
5. Per-space cache (currently all spaces share one sync)
6. Incremental sync (only sync changed sessions, not full list)
7. Push-based invalidation from Gateway events
