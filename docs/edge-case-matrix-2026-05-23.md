# Edge Case Matrix — 2026-05-23 Fixes

## 1. Delete All Chats — Timeout + Cache Wipe (`a6bbfd4`)
### ✅ Handled:
- Bulk delete takes >8s → 60s timeout prevents abort
- Frontend caches (localSync + persistentCache) cleared in `finally` block
- sidebar:refresh always fires even on timeout
- Server-side deletion succeeds even if frontend times out

### ⚠️ Edge cases:
- Timeout at exactly 60s on very large chat count → message says "Chats deleted (server cleanup still finishing)". Acceptable.

---

## 2. Delete All — Local Only, No Gateway Destruction (`9b7ff93`)
### ✅ Handled:
- Only clears compat state + SQLite projections
- Gateway sessions (including Telegram) stay intact
- Re-import of Telegram chats works after delete

### ⚠️ Edge cases:
- Gateway still has session data → sidebar won't show deleted chats (compat state cleared). If user re-bootstraps from Gateway, old sessions could reappear. Acceptable — that's expected behavior for "clear local data".

---

## 3. Stale Thinking from Bootstrap Metadata (`521932b`)
### ✅ Handled:
- `chat.bootstrap` patch with active runStatus ignored when session has 0 local messages
- Prevents idle sessions from being resurrected to "thinking" during WS reconnect replay

### ⚠️ Edge cases:
- Session genuinely starts a new run with 0 messages → blocked by this guard. BUT: new runs arrive via `chat.status`/`chat.message.upsert` patches (not `chat.bootstrap`), so this guard never fires for real new activity. Safe.

---

## 4. Autonaming — Skip for Named Chats (`c9b318d`)
### ✅ Handled:
- `handleFirstMessageSent` checks `isWeakChatName(chat.name)` before autonaming
- Migrated Telegram chats with proper names won't be overwritten

### ⚠️ Edge cases:
- Chat named "New Chat" (weak name) → autonaming still fires. Correct.
- Chat with raw ID as name → autonaming fires. Correct.

---

## 5. Autonaming — Race Condition Across Windows (`cb9fed5`)
### ✅ Handled:
- After async autonaming, checks `activeChatRef.current?.id === chat.id`
- `setActiveChat` uses `prev?.id === chat.id` guard
- `setActiveSessionTitle` only updates if chat is still active
- `replaceState` only fires if still active

### ⚠️ Edge cases:
- User switches back to original chat before autonaming completes → `stillActive` is true, name updates correctly.
- Two chats autonaming simultaneously → each captures its own `chat` object, rename API targets correct chat ID. UI update only applies to whichever is active when async resolves.

---

## 6. P0-2: historyCoverage Windowed (`f10ebd8`)
### ✅ Handled:
- `countMessages()` returns total in SQLite, compared with returned count
- `historyCoverage: "windowed"` when returned < total
- `hasOlder`, `knownTotalMessages`, `oldestLoadedSeq` in response
- Frontend uses server-side `hasOlder` for pagination
- Warm cache + global store accept "windowed" coverage
- Patch store handles "windowed" in `applyHistoryCoverageFromPatch`

### ⚠️ Edge cases:
- Empty chat (0 messages) → `historyCoverage: "full"`, `hasOlder: false`. Correct.
- Chat with exactly 160 messages → `returned === total` → "full". Correct.
- Chat with 161+ → "windowed", `hasOlder: true`. Correct.
- Load older until seq 1 → transitions to "full". Correct.
- Switch between windowed and full chats → no stale "load older" on full chat.

---

## 7. Stale Run Finalization — Aggressive Timeouts (`bbee789`)
### ✅ Handled:
- `STALE_BOOTSTRAP_RUN_MS`: 5min → 2min
- `DEFAULT_STALE_ACTIVE_RUN_MS`: 10min → 3min
- `hasAssistantResponseAfterLastUser()` — finalizes even when last message isn't assistant text
- Stale finalization triggers on EITHER `lastMessageIsAssistantText` OR `hasAssistantResponseAfterLastUser`

### ⚠️ Edge cases:
- Run <2min that's actually done → live event finalizes instantly. 2min is fallback only.
- Assistant message arrives but `findLatestPendingRun` returns null → idempotent, safe.
- New message before old run finalized → 3min global sweep cleans old run.
- Chat with ONLY tool calls → 3min global cleanup handles it.
- Genuinely long-running run (>3min, no tools, no streaming) → extremely rare for OCPlatform. Risk: premature finalization. Acceptable.

---

## 8. chat.final Backfill + Run Finalization (`39278b7`)
### ✅ Handled:
- `chat.final` triggers `scheduleHistoryBackfill` (300ms delay) instead of silently returning
- After backfill: checks assistant response + no running tools → finalizes to "done"
- Broadcasts `chat.run.done`

### ⚠️ Edge cases:
- `session.message` arrives before backfill (300ms) → normal finalization handles it, backfill is no-op.
- `session.message` never arrives → backfill fetches from Gateway, finds text, finalizes.
- Tool still running when `chat.final` arrives → `hasRunningTools` prevents premature finalization.
- Multiple `chat.final` events → debounced via `historyBackfillTimers` (one per session).
- Backfill fails (network) → stale 2-3min timeout is safety net.

---

## 9. P1-1: Memoize MessageBubble/ToolCallSteps/ThinkingBlock (`5c766bb`)
### ✅ Handled:
- Status changes (thinking→streaming→done) → only last message re-renders
- Popover open/close → only that specific message
- Pin/reaction → only affected message
- New message → new item, existing untouched
- Branch switch → `branches.length` and `activeBranch` in comparator
- Tool calls added/removed → `toolCalls.length` comparison

### ⚠️ Edge cases:
- Tool call STATUS change (running→success) → ToolCallSteps separately memoized, gets new array reference → re-renders correctly.
- Streaming text updates → `message.text` changes → comparator returns false → re-renders. Correct.
- Message object mutation → store creates new objects on update. Safe.
- `referencedTexts` not in comparator → low impact, catches up on next status change.
- Callback identity changes → ignored (all stable useCallback). Intentional.
- Attachments not in comparator → immutable after creation. Safe.

---

## 10. P1-2: Patch Stream Batching — 16ms Coalescing (`d8e5603`)
### ✅ Handled:
- 20-40 `chat.tool.update` patches in 50ms → 1 notification instead of 40
- `seedGlobalChatSession` → `notifySync` (not batched)
- `sweepStaleGlobalChatSessions` → `notifySync`
- Subagent status sync → `notifySync`
- Multiple sessions in same frame → each gets own notification with correct latest frame
- Sidebar events accumulated across batch → all emitted on flush
- SSR/test (no rAF) → synchronous fallback
- `clearGlobalChatEngineForTests` cleans batch state + cancels pending rAF

### ⚠️ Edge cases:
- Status change in same batch as tool updates → listener gets final state (done). Correct.
- User sends while patches batching → `notifySync` flushes pending batch first. No race.
- Rapid chat switch during batch → old session has no listeners on flush. No-op. Safe.
- 100-patch burst → all batch into one notification. State always correct. Acceptable.
- rAF starvation → state is current, notification delayed. Status bar lags but messages correct.

---

## 11. Instant Chat Switch — Warm Cache Preload (`d3eeeca`)
### ✅ Handled:
- In-memory Map preloaded from IndexedDB on boot
- `getWarmChatCacheSync()` for instant sync reads (0ms)
- `setWarmChatCache` writes to memory immediately + IndexedDB async
- `deleteWarmChatCache` clears both layers
- `useChatMessages` uses `getWarmChatCacheSync` for initial state

### ⚠️ Edge cases:
- First app load → preload runs async (~100ms). If chat opens before preload, falls through to async IndexedDB. No regression.
- 30+ chats → only top 30 preloaded (LRU). Older chats fall through to IndexedDB.
- IndexedDB unavailable → preload catches error, memory empty, existing async path works.
- Memory pressure → 30 chats × 500KB = 15MB max. Same as IndexedDB budget.
- Multiple windows → each has own memory Map. IndexedDB shared. Writes don't cross windows until refresh.
- Partial save guard → still works (reads memory first now).

---

## 12. Proactive Stale Run Repair on Startup (`107bf56`)
### ✅ Handled:
- After subscribing to recent sessions, scans SQLite for pending run status
- Triggers immediate history backfill from Gateway for stuck sessions
- Runs `finalizeStaleActivity()` on startup to clean run store

### ⚠️ Edge cases:
- Session genuinely still running on Gateway → backfill fetches current state, sees no assistant text yet, doesn't finalize. Safe.
- Many sessions with pending status → sequential backfill. May take a few seconds for 9+ sessions. Acceptable.
- Gateway unreachable on startup → backfill fails, logged as warning. 2-3min timeout is fallback.

---

## 13. P1-3: Branch List Dedupe TTL 30s→60s (`24b62c1`)
### ✅ Handled:
- Reduced redundant fetches on rapid chat switching
- Double-mount (StrictMode) reuses deduped request
- Per-session dedupe keys preserved (each chat has its own branches)

### ⚠️ Edge cases:
- User edits message (creates branch) → `invalidateDedupe` clears cache immediately. No stale data.
- Branch created by another client → won't show for up to 60s. Acceptable (single-user desktop feature).

---

## 14. Warm Cache Partial Save Guard (`bbee789`)
### ✅ Handled:
- Before writing warm cache, reads existing cache
- Skips write if existing has MORE messages than new data
- Prevents partial load from overwriting complete cache

### ⚠️ Edge cases:
- Branch switch with fewer messages → guard blocks save. Full bootstrap on branch switch saves correct data.
- Race between read and write (another tab) → worst case skips one valid save, next debounce corrects.
