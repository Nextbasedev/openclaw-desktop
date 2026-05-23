# Chat Timeline Store Refactor

## Problem

Three independent systems write to the visible message list:

1. **Bootstrap** — middleware fetch, sets full message list
2. **Patch stream** — live WebSocket, adds/updates/removes individual messages  
3. **Warm cache** — IndexedDB snapshot, applied before bootstrap completes

Each calls `setMessages()` independently → race conditions, flickers, count jumps.

## Bugs This Causes

- Count jumps (0→60→85) — warm cache sets 60, bootstrap overwrites with 85
- Text flicker — warm cache has old text, bootstrap has cleaned version
- Status flicker — warm cache says "done", patch stream says "thinking"
- Ghost tool cards — warm cache has stale tools, bootstrap removes them
- Stale data — background sync updates race with patch stream

## Solution: Single ChatTimelineStore

```
Bootstrap   ─┐
Patch stream ─┼─→ ChatTimelineStore ─→ React state (single render)
Warm cache   ─┘
```

### Architecture

```typescript
class ChatTimelineStore {
  private messages: Map<string, TimestampedMessage>
  private cursor: number
  private source: "warm-cache" | "bootstrap" | "live"
  
  // All three systems call these instead of setMessages() directly
  applyWarmCache(messages, cursor, cachedAt)
  applyBootstrap(messages, cursor, source)  
  applyPatch(patch, cursor)
  
  // Single output
  getSnapshot(): { messages: ChatMessage[], cursor: number, source: string }
  subscribe(listener): unsubscribe
}
```

### Conflict Resolution Rules

1. **Higher cursor always wins** — if bootstrap arrives with cursor 100 but patch stream already applied cursor 105, bootstrap messages are merged but cursor stays at 105
2. **Deduplicate by messageId** — no duplicate messages, latest version wins
3. **Bootstrap replaces warm cache** — when bootstrap arrives, it's the source of truth. Warm cache messages not in bootstrap are dropped
4. **Patches always apply on top** — live patches from WebSocket are the most current data
5. **Single React update** — all three sources write to the store, store batches and emits one snapshot per frame

### Migration Plan

#### Phase 1: Create ChatTimelineStore (Day 1)
- [ ] New file: `packages/ui/lib/chat-engine-v2/timelineStore.ts`
- [ ] Implement `applyWarmCache()`, `applyBootstrap()`, `applyPatch()`
- [ ] Conflict resolution: cursor comparison, messageId dedup
- [ ] Subscribe/snapshot pattern (like Zustand)
- [ ] Unit tests for all conflict scenarios

#### Phase 2: Wire into useChatMessages (Day 2)
- [ ] Replace direct `setMessages()` calls with store methods:
  - `applyPersistedWarmCache()` → `store.applyWarmCache()`
  - Bootstrap applied section → `store.applyBootstrap()`
  - Patch stream subscription → `store.applyPatch()`
- [ ] Replace `messages` state with `useSyncExternalStore(store)`
- [ ] Remove manual dedup logic (store handles it)
- [ ] Keep `status`, `pendingTools`, `spawnedSubagents` separate (not message data)

#### Phase 3: Edge case validation (Day 3)
- [ ] Test: warm cache → bootstrap → patches (normal flow)
- [ ] Test: warm cache → patches arrive before bootstrap
- [ ] Test: bootstrap arrives with older cursor than patches
- [ ] Test: rapid chat switch (store per session key)
- [ ] Test: count stability (no jumps)
- [ ] Test: text stability (no flicker)
- [ ] Test: status consistency across sources
- [ ] Remove old dedup/race-condition guards that store makes unnecessary

### Edge Cases to Handle

| Scenario | Current Behavior | After Refactor |
|----------|-----------------|----------------|
| Warm cache 60 msgs → bootstrap 85 msgs | Count jumps 60→85 | Smooth: store merges, single update with 85 |
| Warm cache "done" → patch "thinking" | Status flicker | Store: patch cursor > cache cursor → patch wins |
| Bootstrap cursor 100 → patch cursor 105 already applied | Bootstrap overwrites patch data | Store: keeps patch data (higher cursor) |
| Rapid switch: chat A → B → A | Race between old and new bootstrap | Store keyed by sessionKey, each independent |
| Warm cache has stale tool cards | Ghost tools shown briefly | Store: bootstrap replaces warm cache tools |
| New message via patch + bootstrap arrive simultaneously | Duplicate message possible | Store: dedup by messageId, latest version wins |

### Files to Change

- `packages/ui/lib/chat-engine-v2/timelineStore.ts` — NEW
- `packages/ui/hooks/useChatMessages.ts` — Major refactor (message state → store)
- `packages/ui/lib/chat-engine-v2/store.ts` — Minor (patch routing)
- `packages/ui/lib/warmChatCache.ts` — Minor (read interface)

### Rollback Plan

- Feature flag: `USE_TIMELINE_STORE` environment variable
- If disabled, falls back to current direct `setMessages()` behavior
- Can be toggled without code change

### Success Criteria

- [ ] Zero count jumps on chat switch
- [ ] Zero text flicker on chat switch
- [ ] Zero status flicker from cache/bootstrap race
- [ ] All existing tests pass
- [ ] No regression in chat switch speed (<100ms with warm cache)
- [ ] Memory usage unchanged (store replaces existing Map, not additive)

### Not In Scope

- Global search across all chats (separate feature)
- Multi-window sync (IndexedDB is shared, memory is per-window)
- Pagination architecture (loadOlderMessages stays as-is)
