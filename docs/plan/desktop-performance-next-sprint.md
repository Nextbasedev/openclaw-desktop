# Desktop Performance — Next Sprint Plan

## Sprint Goal
Fix P0 bugs, ship P1 improvements, close high-impact unchecked edge cases.

---

## Phase 1: P0 Fixes (Day 1)

### Task 1.1: Fix cross-session message contamination
**Priority:** P0-1
**Time:** 3-4 hours
**Steps:**
1. Add mount delay guard to Virtuoso `atTopStateChange` — don't fire `loadOlderMessages` within 500ms of mount
2. Verify `loadOlderMessages` checks `sessionKey === currentSessionKey` before applying
3. Verify `seedGlobalChatSession` is session-isolated during archive-import recovery
4. Reset `oldestLoadedSeqRef` on session change
5. Test: rapid switch 5+ chats including short (13 msg) and heavy (160 msg) chats
6. Test: trigger archive-import during switch by visiting a chat with archived transcripts

**Edge cases to verify during fix:**
- [ ] Virtuoso `atTopStateChange` fires for short chats — guarded
- [ ] Windowed render + pagination two sources of prepend — no conflict
- [ ] Archive-import recovery doesn't contaminate other sessions

### Task 1.2: Fix historyCoverage metadata
**Priority:** P0-2
**Time:** 1-2 hours
**Steps:**
1. In `buildChatBootstrapSnapshot`, compare `messages.length` vs total message count in SQLite
2. If `messages.length < totalInSqlite`, return `historyCoverage:"windowed"` + `hasOlder:true`
3. Add `knownTotalMessages` and `loadedOldestSeq` to response
4. Test: chat with >160 messages returns correct metadata
5. Test: chat with <160 messages returns `historyCoverage:"full"`

---

## Phase 2: P1 Performance (Day 2)

### Task 2.1: Memoize message components
**Priority:** P1-1
**Time:** 2-3 hours
**Steps:**
1. Wrap `MessageBubble` with `React.memo` + custom comparator (check messageId, text, toolCalls, sendStatus, isPinned, reaction)
2. Wrap `ToolCallSteps` with `React.memo` (check tools array identity)
3. Wrap `ThinkingBlock` with `React.memo` (check text)
4. Wrap `MarkdownContent` with `React.memo` (check content string)
5. Move `activePopoverId` state into MessageBubble to isolate re-renders
6. Test: toggle status → verify only last message re-renders, not all

### Task 2.2: Batch patch stream updates
**Priority:** P1-2
**Time:** 2-3 hours
**Steps:**
1. In `store.ts`, collect patches in a buffer
2. Flush buffer every 16ms (one animation frame) using `requestAnimationFrame`
3. Coalesce multiple `chat.tool.update` for same toolCallId into one state update
4. Test: active Telegram session with rapid tool calls → verify no UI lag in desktop

### Task 2.3: Quick P1 fixes
**Priority:** P1-3 through P1-6
**Time:** 2 hours total
**Steps:**
1. **Branch list dedupe (P1-3):** Increase TTL to 60s, scope by connection key
2. **Pin scroll with Virtuoso (P1-4):** Use `virtuosoRef.scrollToIndex()` with index lookup from `renderedMessages`
3. **atTop guard (P1-5):** Add `bootstrapSettled` check in `atTopStateChange` callback
4. **Stale ghost tools (P1-6):** Clear `pendingTools` from warm cache when `runStatus === "done"` and cache age > 2min

---

## Phase 3: Edge Case Verification (Day 3)

### Task 3.1: Cross-layer cache verification
**Time:** 2-3 hours
**Steps:**
1. Test: disconnect middleware → verify all caches cleared (IndexedDB, localStorage, memory)
2. Test: reconnect to same middleware → verify fresh data loaded
3. Test: reconnect to DIFFERENT middleware → verify no stale data from old connection
4. Test: Gateway disconnect/reconnect → verify middleware serves correctly from SQLite during disconnect, refreshes on reconnect
5. Test: create chat from Telegram → verify it appears in desktop sidebar within 30s

### Task 3.2: Warm cache edge cases
**Time:** 1-2 hours
**Steps:**
1. Test: refresh page after 2+ hours → warm cache shows stale data briefly, bootstrap corrects
2. Test: warm cache has `thinking` status but run finished → patch stream corrects within 2s
3. Test: warm cache has truncated tool output → bootstrap loads full output
4. Test: 30+ chats cached → oldest evicted correctly

### Task 3.3: SQLite local-first edge cases
**Time:** 1-2 hours
**Steps:**
1. Test: restart middleware → first chat click uses SQLite (not Gateway) when Gateway connected
2. Test: disconnect Gateway → chat click falls through to Gateway round-trip (should fail gracefully)
3. Test: new message arrives during local-first serve → background sync catches it
4. Test: brand new chat with no SQLite data → falls through to Gateway correctly

---

## Phase 4: P2 Polish (Day 4-5)

### Task 4.1: Middleware window metadata
**Priority:** P2-1
**Time:** 3-4 hours
- Add `hasOlder`, `knownTotalMessages`, `loadedOldestSeq`, `loadedNewestSeq` to bootstrap response
- Frontend uses these instead of guessing from message count

### Task 4.2: Large tool output truncation
**Priority:** P2-2
**Time:** 2 hours
- Collapse tool results >10KB with expand button
- Show first 500 chars + "Show full output (X KB)"

### Task 4.3: Cursor jump detection
**Priority:** P2-3
**Time:** 2-3 hours
- Detect cursor gap between local-first cursor and patch stream cursor
- Trigger patch stream reconnect if gap > 10 cursors

### Task 4.4: Gateway reconnect cache refresh
**Priority:** P2-6
**Time:** 30 minutes
- Clear `lastFullSyncAtMs` on Gateway reconnect event
- Ensure first request after reconnect does a full sync

---

## Success Criteria

### After Phase 1:
- [ ] No cross-session messages during rapid switching
- [ ] Correct `historyCoverage` for all chats

### After Phase 2:
- [ ] Chat switch renders in <100ms (memoized)
- [ ] No UI lag during active Telegram tool calls
- [ ] Pin scroll works with Virtuoso
- [ ] No ghost tool cards on refresh

### After Phase 3:
- [ ] All disconnect/reconnect scenarios verified
- [ ] All warm cache staleness scenarios verified
- [ ] All SQLite local-first scenarios verified

### After Phase 4:
- [ ] Frontend knows when older messages exist
- [ ] Large tool outputs don't bloat DOM
- [ ] Cursor gaps detected and recovered

---

## Branch Strategy
- Continue on `fix/send-under-request-storm` for P0 fixes
- Create `fix/message-memoization` for P1-1
- Create `fix/patch-stream-batching` for P1-2
- P2 items on separate branches from `dev-2-temp`

## Total Estimated Effort
- Phase 1: 5-6 hours (Day 1)
- Phase 2: 6-8 hours (Day 2)
- Phase 3: 4-7 hours (Day 3)
- Phase 4: 8-10 hours (Day 4-5)
- **Total: ~25-30 hours across 5 working days**
