# App Bootstrap Caching — Implementation Plan

## Problem
`/api/bootstrap` takes 3-13s because it synchronously calls `syncGatewaySessions()` which:
1. Calls Gateway `sessions.list` (800ms)
2. Processes/syncs all sessions against local state (2-4s)
3. Builds response from `compatState` (fast, but blocked by step 1-2)

Both `/api/bootstrap` and `/api/chats` call `syncGatewaySessions()` independently. Under concurrent load (5x refresh), all requests queue behind the same sync.

## Current Architecture
```
Browser → /api/bootstrap → syncGatewaySessions() → Gateway sessions.list (800ms)
                                                  → sync/project (2-4s)
                                                  → build response from compatState
                                                  → return JSON (~37KB)

Browser → /api/chats     → syncGatewaySessions() → same Gateway call
                                                  → return JSON (~11KB)
```

`syncGatewaySessions()` already has a 5s dedupe cache that coalesces concurrent calls to share one `sessions.list` round-trip. But the response building + sync processing still runs synchronously.

## Proposed Architecture
```
Browser → /api/bootstrap → is lastSync < 30s ago?
                           YES → return from compatState immediately (0ms)
                                 → fire background sync (fire-and-forget)
                           NO  → syncGatewaySessions() (3-5s, same as today)
                                 → return from compatState
                                 → stamp lastSyncAt

Browser → /api/chats     → same logic, shared lastSyncAt timestamp
```

## Implementation Details

### What to change: `apps/middleware/src/features/compat/routes.ts`

#### Step 1: Add sync timestamp tracking
```typescript
let lastFullSyncAtMs = 0;
const BOOTSTRAP_FRESH_MS = 30_000; // serve from memory if synced within 30s

export function invalidateBootstrapCache() {
  lastFullSyncAtMs = 0;
}
```

#### Step 2: Modify `/api/bootstrap` handler
```typescript
app.get("/api/bootstrap", async () => {
  const gateway = await connectGatewayForStatus(context);
  const syncAge = Date.now() - lastFullSyncAtMs;
  
  if (lastFullSyncAtMs > 0 && syncAge < BOOTSTRAP_FRESH_MS) {
    // Serve from in-memory compatState immediately
    log.info("bootstrap.serve-cached", { syncAgeMs: syncAge });
    // Background sync (fire-and-forget)
    void syncGatewaySessions(context).then(() => {
      lastFullSyncAtMs = Date.now();
      applyProjectedChatActivity(context);
    }).catch(() => {});
  } else {
    // Full sync (blocking)
    await syncGatewaySessions(context);
    lastFullSyncAtMs = Date.now();
    applyProjectedChatActivity(context);
  }
  
  // Build response from compatState (always fast, ~1ms)
  const spaceId = activeSpaceId();
  const projects = listBySpace(compatState.projects, spaceId);
  const projectIds = new Set(projects.map(p => p.id).filter(Boolean));
  return {
    ok: true,
    service: "openclaw-middleware",
    spaces: compatState.spaces.filter(visibleSpace),
    activeSpaceId: spaceId,
    chats: sortedChatsForResponse(spaceId, false),
    projects,
    topics: compatState.topics.filter(t => notDeleted(t) && projectIds.has(t.projectId)),
    sessions: sessionsForSpace(spaceId),
    gateway,
  };
});
```

#### Step 3: Modify `/api/chats` handler (same pattern)
```typescript
app.get("/api/chats", async (request) => {
  const syncAge = Date.now() - lastFullSyncAtMs;
  
  if (lastFullSyncAtMs > 0 && syncAge < BOOTSTRAP_FRESH_MS) {
    log.info("chats.serve-cached", { syncAgeMs: syncAge });
    void syncGatewaySessions(context).then(() => {
      lastFullSyncAtMs = Date.now();
      applyProjectedChatActivity(context);
    }).catch(() => {});
  } else {
    await syncGatewaySessions(context);
    lastFullSyncAtMs = Date.now();
    applyProjectedChatActivity(context);
  }
  
  const query = request.query as CompatRecord;
  const archived = query.archived === "true" || query.archived === true;
  const spaceId = listSpaceId(query);
  return { chats: sortedChatsForResponse(spaceId, archived) };
});
```

#### Step 4: Invalidate on mutations
Add `invalidateBootstrapCache()` calls after each mutation:

```typescript
// POST /api/chats (create)
invalidateBootstrapCache();

// DELETE /api/chats/:id
invalidateBootstrapCache();

// POST /api/chats/:id/rename
invalidateBootstrapCache();

// POST /api/chats/:id/archive
invalidateBootstrapCache();

// POST /api/spaces (create)
invalidateBootstrapCache();

// DELETE /api/spaces/:id
invalidateBootstrapCache();

// POST /api/spaces/:id/switch
invalidateBootstrapCache();

// POST /api/spaces/:id/archive
invalidateBootstrapCache();
```

#### Step 5: Invalidate on Gateway reconnect
In the Gateway connection handler:
```typescript
// When Gateway reconnects after disconnect
invalidateBootstrapCache();
```

#### Step 6: Test cleanup
```typescript
// Export for test isolation
export function clearBootstrapCacheForTests() {
  lastFullSyncAtMs = 0;
}
```

### What NOT to change
- `syncGatewaySessions()` itself — it already has its own 5s dedupe
- `compatState` — it's already an in-memory store, we just skip the blocking sync
- Individual chat bootstrap — already has local-first (separate system)
- Patch stream — unaffected
- Send pipeline — unaffected

### Files to modify
1. `apps/middleware/src/features/compat/routes.ts` — main changes
2. `apps/middleware/tests/app.test.ts` — add `clearBootstrapCacheForTests()` to afterEach
3. `apps/middleware/tests/send.test.ts` — same cleanup

### Expected Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| First load after restart | 3-5s | 3-5s (unchanged) |
| Repeat load within 30s | 3-5s | <100ms |
| 5x concurrent refresh | 13s each | <100ms each (after first) |
| Chat list after create | 3-5s | <100ms (invalidate + serve cached) |
| Load after >30s idle | 3-5s | 3-5s (cache expired) |

### Risks
- **Stale sidebar for up to 30s** — acceptable, auto-corrects
- **Background sync failure** — silently fails, next request retries
- **Race between mutation and background sync** — mutation invalidates cache, next request syncs fresh

### Testing Plan
1. Run existing middleware tests with cache cleanup
2. Stress test: 5x concurrent `/api/bootstrap` — verify <100ms on 2nd+ calls
3. Create chat → verify sidebar updates immediately (cache invalidated)
4. Restart middleware → verify first load still syncs
5. Wait >30s → verify cache expires and re-syncs
