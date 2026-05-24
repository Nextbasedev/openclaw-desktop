# Local-First Bootstrap — Edge Case Matrix

## Approach
Serve chat from local SQLite projection immediately on mount. Refresh from Gateway `chat.history` in background. Live patch stream handles real-time updates.

## Edge Cases

### 1. Stale Run Status

| Scenario | Local DB State | Gateway State | Risk | Mitigation |
|----------|---------------|---------------|------|------------|
| Run finished while offline | `thinking` / `tool_running` | `done` | Permanent thinking indicator | Background sync must update status; stale run timer (existing 10s `reconcileIfStale`) catches this |
| Run started from Telegram | `idle` / `done` | `thinking` | User misses active run | Live patch stream delivers `chat.status` immediately; no risk if patch stream is connected |
| Run errored while offline | `thinking` | `error` | Stuck thinking | Background sync updates; existing `STALE_BOOTSTRAP_RUN_MS` (5min) auto-finalizes |
| User aborted from phone | `thinking` | `idle` | Stuck thinking | Same as above |

**Critical gap:** If patch stream disconnects AND background sync hasn't run yet → stale thinking for up to 10s (existing reconcile interval). Acceptable.

### 2. Stale Tool Calls

| Scenario | Local DB State | Gateway State | Risk | Mitigation |
|----------|---------------|---------------|------|------------|
| Tool completed while offline | `running` | `success` | Stuck tool card | Background sync + `STALE_BOOTSTRAP_TOOL_MS` (30min) auto-finalize |
| Tool approval resolved elsewhere | `awaitingResult` | `success` | Approval dialog for completed tool | Patch stream delivers `chat.tool.result`; background sync cleans up |
| New tool started after last visit | not in DB | `running` | Missing tool card | Patch stream delivers `chat.tool.started`; background sync adds it |
| Tool error while offline | `running` | `error` | Stuck running tool | Background sync updates; stale tool timer catches |

**Critical gap:** If a tool needs approval and was already resolved, the user might see the approval dialog for 1-2 frames until patch stream/background sync delivers the result. Use tool `updatedAtMs` to suppress stale approvals.

### 3. Stale Messages

| Scenario | Local DB State | Gateway State | Risk | Mitigation |
|----------|---------------|---------------|------|------------|
| Messages sent from Telegram | missing | present | Incomplete conversation | Background sync appends via `upsertMessages` (UPSERT, not replace) |
| Agent replied after last visit | only user msg | user + assistant | Missing assistant reply | Same — upsert appends |
| Message compacted/edited | old version | new version | Stale text shown briefly | UPSERT updates `data_json`; UI re-renders on state change |
| Bootstrap truncation changed | had 160 msgs | now 200 available | Missing older messages | Background sync re-fetches; `messageCount` metadata updates |
| Message deleted (rare) | present | absent | Ghost message | Gateway history doesn't delete; not a real risk |

**Critical gap:** None significant. UPSERT semantics already handle append + update correctly.

### 4. Missing / Phantom Data

| Scenario | Local DB State | Gateway State | Risk | Mitigation |
|----------|---------------|---------------|------|------------|
| New chat from another client | not in SQLite | exists on Gateway | Chat shows in sidebar (from /api/chats) but bootstrap returns empty from local | Background sync creates projection; first time always hits Gateway |
| Chat deleted from another client | exists in SQLite | gone from Gateway | Ghost chat in sidebar | `/api/chats` sync removes it; local projection doesn't cause harm |
| Session key changed (migration) | old key in cache | new key on Gateway | Wrong session loaded | Session sync updates keys; warm cache keyed by sessionKey |
| Middleware restart (SQLite wiped) | empty DB | full Gateway history | All chats blank until bootstrap | First bootstrap always hits Gateway for each chat; this is current behavior already |

**Critical gap:** Brand new chat created from another client has no local projection → must fall through to Gateway bootstrap. Need: if `sessionKey` not found in local DB, skip local-first and go to Gateway directly.

### 5. Optimistic Send Conflicts

| Scenario | Risk | Mitigation |
|----------|------|------------|
| User sends while background sync running | Sync overwrites optimistic message | Background sync must check for optimistic messages and preserve them (existing `confirmOptimisticUser` handles this) |
| User sends, background sync returns older history | Optimistic user message disappears | UPSERT won't overwrite newer optimistic; dedupe handles |
| Two sends in quick succession | Second send races with first reconcile | Existing `SessionSendQueue` serializes sends; reconcile checks `isSendingRef` |
| Send starts, local-first shows old messages, send uses old context | Agent sees stale context | Not a risk — send goes to Gateway which has current context |

**Critical gap:** None — existing optimistic lifecycle already handles these cases correctly.

### 6. Cursor / Patch Stream Interaction

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Local projection served with old cursor, patch stream connects | Patch stream replays old events, causing duplicate state | Patch stream cursor is global (not per-chat); already handled by cursor comparison |
| Background sync updates cursor after local-first serve | Patch stream was already connected at old cursor | Cursor only moves forward; already-applied patches are idempotent |
| Middleware restart resets cursor to 0 | Patch stream replays everything | Existing bootstrap recovery handles this (`chat.bootstrap-recovery.reload`) |
| Two windows open, different cursors | State divergence between windows | Each window has independent patch stream; per-window isolation already exists |

**Critical gap:** If local-first serves cursor `X` and patch stream connects at `X`, but background sync then produces cursor `X+5`, the patch stream might miss cursors `X+1..X+4`. Mitigation: background sync should trigger patch stream reconnect if cursor jumped.

### 7. Archive Import Race

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Local-first serves from projection, background archive import adds older messages | Message count changes, scroll position shifts | Existing `bootstrap.archived-history.background.broadcast` signals UI to refetch |
| Archive import runs during user scroll-up | Pagination returns different results | Archive import resequences atomically; pagination uses `openclaw_seq` |
| Archive import fails midway | Partial older history | Import is transactional per file; existing `skippedFiles` tracking |

**Critical gap:** None — existing archive import is already background + broadcast-based.

### 8. Multi-Window Interaction

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Window A serves local-first, Window B has live stream | Window A shows stale data | Each window subscribes to patch stream independently; Window A will get patches too |
| Window A sends, Window B still loading | Window B might show old history without the new message | Patch stream delivers the message to Window B |
| Window A focused, Window B in background | Background sync runs in focused window only? | Patch stream delivers to both; `reconcileIfStale` runs on focus |

**Critical gap:** None — per-window isolation already handles this.

### 9. Network / Connection Edge Cases

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Offline mode (no Gateway) | All chats serve from local, no sync possible | Show "offline" indicator; local-first works naturally |
| Slow network (high latency) | Background sync takes 5s+ | Local-first serves immediately; sync updates when ready |
| Network drops during background sync | Partial sync | Sync is atomic per chat (upsert); retry on next mount/focus |
| Tailscale disconnects | Middleware can't reach Gateway | Middleware returns local projection; patch stream disconnects → UI shows stale indicator |

**Critical gap:** Need a visual "syncing" / "last synced X ago" indicator when serving potentially stale local data.

### 10. Data Consistency

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Local projection has 160 msgs, Gateway has 200 | messageCount metadata incorrect until sync | Background sync updates `messageCount`; `hasOlder` based on actual data |
| Local projection newer than Gateway (clock skew) | `updatedAtMs` comparison fails | Use `openclaw_seq` for ordering, not timestamps |
| SQLite corruption | Chat fails to load | Fall through to Gateway bootstrap (existing error handling) |
| Concurrent writes to SQLite (two syncs) | Data race | SQLite WAL mode handles concurrent reads; writes are serialized |

**Critical gap:** None — SQLite + WAL + `openclaw_seq` ordering handles these.

## Implementation Priority

### Must solve before shipping:
1. **Skip local-first for unknown sessions** — if sessionKey not in local DB, go to Gateway directly
2. **Preserve optimistic sends during background sync** — already handled by existing code
3. **Stale status timeout** — existing 10s reconcile + 5min auto-finalize covers this
4. **Patch stream cursor alignment** — reconnect if background sync jumps cursor

### Can defer:
5. Visual "syncing" indicator
6. Offline mode handling
7. Multi-window cursor alignment optimization
8. Stale approval dialog suppression

## Conclusion

Most edge cases are already handled by existing infrastructure:
- `reconcileIfStale` (10s interval)
- `STALE_BOOTSTRAP_RUN_MS` (5min auto-finalize)
- `STALE_BOOTSTRAP_TOOL_MS` (30min auto-finalize)
- UPSERT semantics (append, not replace)
- Patch stream (real-time updates override local state)
- `confirmOptimisticUser` (send lifecycle)

The main new work is:
1. Middleware: serve from local projection when fresh enough, sync in background
2. Frontend: mount chat immediately from local cache, show loading skeleton only for first-ever visit
3. Frontend: handle cursor jump from background sync
