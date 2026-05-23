# Remaining Bugs & Tasks — Priority List

Last updated: 2026-05-23

## P0 — Must Fix (Blocks Usage)

### P0-1: Cross-session message contamination during rapid switching
- **Repro:** Rapid tab switch across multiple chats → go back to chat with few messages → messages from OTHER sessions appear mixed in
- **Root cause:** Archive-import recovery (`messageCount:1000`) contaminates global chat engine store + Virtuoso `atTopStateChange` fires for short chats triggering unwanted pagination
- **Files:** `packages/ui/components/ChatView/index.tsx`, `packages/ui/lib/chat-engine-v2/store.ts`, `packages/ui/hooks/useChatMessages.ts`
- **Fix plan:** 
  1. Guard `atTopStateChange` — don't fire `loadOlderMessages` within 500ms of mount
  2. Verify global engine store session isolation during archive-import recovery
  3. Ensure `loadOlderMessages` validates sessionKey matches current active session
  4. Test: rapid switch 5+ chats, verify no cross-session messages

### P0-2: Middleware `historyCoverage:"full"` is incorrect for limited windows
- **Impact:** Frontend thinks it has all messages when it only has last 160
- **Root cause:** `buildChatBootstrapSnapshot` always returns `historyCoverage:"full"` even when `limit=160` and chat has >160 messages
- **Files:** `apps/middleware/src/features/chat/projection.ts`, `apps/middleware/src/features/chat/routes.ts`
- **Fix plan:** Compare `messageCount` returned vs total messages in SQLite. If less, return `historyCoverage:"windowed"`

## P1 — Should Fix (Degrades Experience)

### P1-1: No memoization on message components
- **Impact:** Every status change re-renders ALL visible messages (60+ components × 136 JSX elements each)
- **Files:** `MessageBubble.tsx`, `ToolCallSteps.tsx`, `ThinkingBlock.tsx`, `MarkdownContent.tsx`
- **Fix:** `React.memo` with custom equality on message props
- **Effort:** 2-3 hours

### P1-2: Patch stream flood from active Telegram sessions
- **Impact:** 20-40 `chat.tool.update` patches per tool call → 20-40 React re-renders in desktop UI
- **Files:** `packages/ui/lib/chat-engine-v2/store.ts`
- **Fix:** Batch patches within 16ms (one frame). Coalesce multiple tool.update for same toolCallId into one state update
- **Effort:** 2-3 hours

### P1-3: Branch list still fires per-chat mount (not deduped)
- **Impact:** `middleware_branch_list` request on every chat switch, takes 350-1000ms
- **Files:** `packages/ui/hooks/useChatMessages.ts`
- **Fix:** Already partially deduped with `requestDedupe`. Extend TTL to 60s or make it a global singleton like models/voice
- **Effort:** 30 minutes

### P1-4: Scroll-to-message (pin click) may fail with Virtuoso
- **Impact:** Clicking a pinned message can't scroll to it if message is outside Virtuoso's rendered range
- **Files:** `packages/ui/components/ChatView/index.tsx`
- **Fix:** Use `virtuosoRef.scrollToIndex()` with message index lookup instead of `document.getElementById`
- **Effort:** 1 hour

### P1-5: Loading-timeout still shows `messageCount:0` briefly for short chats
- **Impact:** Warm cache applied (13 msgs), then Virtuoso `atTopStateChange` fires, then loading-timeout may clear if bootstrap hasn't settled
- **Files:** `packages/ui/hooks/useChatMessages.ts`
- **Fix:** Guard `atTopStateChange` with `bootstrapSettled` flag
- **Effort:** 30 minutes

### P1-6: Stale warm cache ghost tool cards on refresh
- **Impact:** Warm cache has `pendingTools` from hours ago → ghost running tool cards shown briefly until bootstrap replaces
- **Files:** `packages/ui/lib/warmChatCache.ts`, `packages/ui/hooks/useChatMessages.ts`
- **Fix:** Clear `pendingTools` from warm cache if `runStatus === "done"` and cache is stale (>2min)
- **Effort:** 30 minutes

## P2 — Nice to Have (Polish)

### P2-1: Middleware window metadata contract
- **Impact:** Frontend can't distinguish "has all messages" from "has last 160 of 500"
- **Files:** `apps/middleware/src/features/chat/projection.ts`, `apps/middleware/src/features/chat/routes.ts`
- **Fix:** Return `hasOlder`, `knownTotalMessages`, `loadedOldestSeq`, `loadedNewestSeq` in bootstrap response
- **Effort:** 3-4 hours

### P2-2: Large tool output truncation in DOM
- **Impact:** Tool results >100KB rendered fully → DOM bloat, slow rendering
- **Files:** `packages/ui/components/ChatView/ToolCallSteps.tsx`
- **Fix:** Collapse tool results >10KB with "Show full output" button
- **Effort:** 2 hours

### P2-3: Cursor jump detection after background sync
- **Impact:** If background sync produces cursor X+5 but patch stream connected at X, cursors X+1..X+4 may be missed
- **Files:** `packages/ui/hooks/useChatMessages.ts`, `packages/ui/lib/chat-engine-v2/client.ts`
- **Fix:** Detect cursor gap, trigger patch stream reconnect
- **Effort:** 2-3 hours

### P2-4: Visual "syncing" indicator for stale data
- **Impact:** User doesn't know if they're seeing cached data or fresh data
- **Files:** `packages/ui/components/ChatView/index.tsx`
- **Fix:** Show subtle "last synced X ago" when serving from warm cache/SQLite
- **Effort:** 1-2 hours

### P2-5: Search across full message list (not just Virtuoso viewport)
- **Impact:** In-page search (Ctrl+F) only finds messages rendered by Virtuoso (~15 of 160)
- **Fix:** Implement custom search that queries message data, then scrolls Virtuoso to match
- **Effort:** 4-6 hours

### P2-6: Gateway reconnect cache refresh
- **Impact:** After Gateway disconnect/reconnect, cached data may be stale
- **Files:** `apps/middleware/src/features/compat/routes.ts`
- **Fix:** Clear `lastFullSyncAtMs` on Gateway reconnect event
- **Effort:** 30 minutes

### P2-7: Patch stream cursor-0 replay flood
- **Impact:** On patch stream reconnect, replays from cursor 0 → floods UI with old patches
- **Files:** `packages/ui/lib/chat-engine-v2/client.ts`
- **Fix:** Skip replayed patches with cursor <= last known cursor
- **Effort:** 1-2 hours

### P2-8: Three systems mutate visible timeline (architecture debt)
- **Impact:** Bootstrap, patch replay, and warm cache can all modify the message list independently → race conditions
- **Fix:** Single `ChatTimelineStore` that mediates all three sources
- **Effort:** 2-3 days (major refactor)

## Unchecked Edge Cases (from all matrices)

### Fixed on 2026-05-23:
- [x] Virtuoso `atTopStateChange` fires immediately for short chats → 1s delay guard (cdd5219)
- [x] 90 patch stream updates = 90 re-renders → 16ms batching (d8e5603)
- [x] Popover open/close re-renders all messages → MessageBubble memo with popoverOpen (5c766bb)
- [x] Cache says `thinking` but run finished → stale run finalization (bbee789 + 39278b7)
- [x] Cache says `tool_running` with stale tool card → stale tool filter (a3f0865)
- [x] Gateway disconnects then reconnects → missed events → invalidate cache on reconnect (87698b7)
- [x] Middleware restart, SQLite >10min → proactive startup repair (107bf56)
- [x] Warm cache 'done' vs middleware 'thinking' → bootstrap metadata guard (521932b + bbee789)
- [x] Patch stream cursor-0 replay floods UI → phantom session prevention (89869fa)
- [x] Side metadata (branch_list) per-chat → 60s dedupe TTL (24b62c1)
- [x] `historyCoverage:"full"` for limited windows → windowed coverage (f10ebd8)
- [x] No `hasOlder`, `knownTotalMessages` → added to bootstrap response (f10ebd8)
- [x] Heavy content blob storage/preview for tool outputs → collapsible output (d772647)

### Remaining — Real concerns (fix individually or via ChatTimelineStore refactor):
- [ ] Multiple cache layers return different message counts → count jumps 0→60→85
- [ ] requestDedupe TTL prevents fresh bootstrap after rapid session change
- [ ] IndexedDB quota exceeded → write fails silently
- [ ] Warm cache has old message text, bootstrap has cleaned version → text flickers
- [ ] Background sync fails silently → `compatState` stays stale
- [ ] Chat deleted from another client → ghost data in local projection
- [ ] Two windows open, different cursors → state divergence between windows
- [ ] Gateway disconnected for >5min → cache expires, next request blocks

### Remaining — Low risk / by design / acceptable:
- [ ] Windowed render + pagination: two sources of prepended messages interact (Virtuoso handles)
- [ ] Rapid status changes during scroll → layout thrash (mitigated by memo + batching)
- [ ] Warm cache messages different order than bootstrap (ordered by seq, stable)
- [ ] Brand new chat from another client → falls through to Gateway (by design)
- [ ] Session key changed (migration) → wrong session loaded (very rare)
- [ ] Network drops during background sync → partial state (self-heals)
- [ ] Background sync updates cursor → needs re-anchor (P2-3 cursor gap detection handles)
- [ ] Chat renamed from another client → old name until sync (expected multi-client)
- [ ] Chat archived from another client → still visible until sync (expected)
- [ ] New space from another client → not visible until sync (expected)
- [ ] `/api/bootstrap` cached, `/api/chats` not → different chat lists (5min stale max)
- [ ] Tab for deleted chat restored → shows empty (minor)
- [ ] Chat activity from Telegram changes sidebar order → stale (refreshes on focus)
- [ ] Messages cached 2+ hours → very stale (syncing indicator warns user)
- [ ] Tool result text truncated in cache → bootstrap loads full
- [ ] 30 chats × 60 msgs × 500KB = 15MB (within browser limits)
- [ ] Gateway reconnects but session not re-subscribed → brief gap (<1s)
- [ ] New message via live event during local-first build → race (last-write-wins)
- [ ] invalidateBootstrapCache + active sync promise → cached sync (5min max)
- [ ] Three systems mutate timeline independently → ChatTimelineStore refactor planned

## Shipped Today (2026-05-22 / 2026-05-23)

- ✅ Request scheduler with priority lanes
- ✅ Local-first chat bootstrap from SQLite (20.9x speedup)
- ✅ SQLite local-first even after middleware restart (Gateway connected check)
- ✅ App bootstrap/chats caching (never blocks after first sync)
- ✅ Skip `sessions.create` for existing sessions on send
- ✅ Skip health check on refresh
- ✅ React Virtuoso for message rendering
- ✅ Never abort critical requests on session switch
- ✅ Loading-timeout preserves warm cache messages
- ✅ Thinking preserved across dev remount
- ✅ Clear all caches on disconnect
- ✅ Stop invalidating bootstrap cache on every saveCompatState
- ✅ Clarified middleware request logging
- ✅ 7 edge case matrix documents
