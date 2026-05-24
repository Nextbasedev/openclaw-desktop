# Desktop Chat / Inspector / New Window Edge Cases

Date: 2026-05-24
Branch: `refactor-chat-timeline-store`
Scope: OpenClaw Desktop chat UI, inspector tabs, notification activity, focused/new chat windows, subagent rendering, warm cache/bootstrap/patch replay.

## Executive Summary

Two patterns explain most observed bugs:

1. **Each surface owns separate async state** — Chat, Activity, Workspace, Git, Terminal, Cron, and Focused Chat all fetch/cache/stream independently.
2. **Focused/new chat windows start in a fresh JS realm** — they do not share the main window's in-memory chat/session/timeline state, so they rebuild from warm cache, bootstrap, patch cursor replay, localStorage, and IndexedDB.

This creates visible divergence:

- Chat can show live activity immediately while Activity tab still loads.
- Main chat can show correct current-turn subagent count while focused window reconstructs historical session-wide subagents.
- Replayed/cached user messages can appear again after assistant replies.
- Inspector tabs can retain stale session/project/window state.

---

## A. Chat / Activity Tab Edge Cases

### A1. Activity tab blocks first paint on history load

- **Files:**
  - `packages/ui/components/inspector/ActivityTab.tsx`
  - `packages/ui/hooks/useAgentActivity.ts`
- **Trigger:** Open Activity tab while chat already has live tool/subagent state.
- **Failure mode:** Activity shows skeleton/loading for 3-4 seconds even though chat already shows activity.
- **Cause:** `ActivityTab` gates UI on `historyLoaded`; `useAgentActivity.loadHistory()` fetches `middleware_chat_history` before rendering.
- **Why it matters:** User sees contradictory state: chat is active, Activity tab says loading.
- **Fix:** First paint from `getGlobalChatSession(sessionKey)` immediately, then backfill history in background.
- **Metrics:**
  - `activity.open_to_first_paint_ms`
  - `activity.used_global_cache`
  - `activity.history_request_count`

### A2. Subagent history waterfall

- **Files:**
  - `packages/ui/hooks/useAgentActivity.ts`
  - `apps/middleware/src/features/compat/routes.ts`
- **Trigger:** Open Activity tab for a chat with multiple subagents.
- **Failure mode:** Many `middleware_chat_history` requests; logs showed ~19 calls in one flow.
- **Cause:** Main history fetch discovers child session keys, then each child fetches its own history/bootstrap. Reopens/remounts can repeat the batch.
- **Fix:** Request dedupe per sessionKey, cap child fetch concurrency, never block parent Activity UI on child history.
- **Metrics:**
  - `activity.subagent_history_count`
  - `activity.subagent_waterfall_ms`
  - `activity.history_dedupe_hit`

### A3. Live stream + history race

- **Files:**
  - `packages/ui/hooks/useAgentActivity.ts`
  - `packages/ui/lib/chat-engine-v2/store.ts`
- **Trigger:** History load and live patches arrive at the same time.
- **Failure mode:** Old history can overwrite or downgrade live state.
- **Cause:** History parsing and stream patches both mutate Activity projections.
- **Fix:** Use monotonic source priority and request sequence guards. Live patch with higher cursor should win over older history.
- **Metrics:**
  - `activity.history_stale_drop`
  - `activity.live_vs_history_conflict`

### A4. Metadata vs full history mismatch

- **Files:**
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/hooks/useAgentActivity.ts`
- **Trigger:** Chat has `historyCoverage: metadata` but Activity expects full parsed tool history.
- **Failure mode:** Chat renders, Activity waits.
- **Fix:** Activity should render metadata/live projection first and progressively hydrate full details.
- **Metrics:**
  - `activity.historyCoverage_at_open`
  - `activity.progressive_hydration_ms`

### A5. Stale running tools/subagents

- **Files:**
  - `packages/ui/hooks/useAgentActivity.ts`
  - `packages/ui/lib/chat-engine-v2/store.ts`
  - `apps/middleware/src/features/chat/repo.runs.ts`
- **Trigger:** Terminal status, delayed done patch, or missed child completion.
- **Failure mode:** Tool/subagent remains running after chat is done, or finalizes too early.
- **Fix:** Single authoritative run/activity lifecycle, with stale finalization only after backend session status confirms non-running.
- **Metrics:**
  - `activity.stale_running_tool_age_ms`
  - `activity.finalize_stale_activity_count`

### A6. Incomplete subagent mapping

- **Files:**
  - `packages/ui/hooks/useAgentActivity.ts`
  - `packages/ui/components/inspector/activity-types.ts`
- **Trigger:** `sessions_spawn` result/link event order changes.
- **Failure mode:** Child tools appear as ungrouped, wrong parent, or duplicate agent.
- **Fix:** Store explicit `triggerUserMessageId`, `parentToolCallId`, and `childSessionKey` from middleware.
- **Metrics:**
  - `activity.unanchored_subagent_count`
  - `activity.spawn_link_missing_count`

---

## B. Chat Subagent Count / Message Replay Edge Cases

### B1. Floating subagent bar shows session-global count instead of current-turn count

- **Files:**
  - `packages/ui/components/ChatView/index.tsx`
  - `packages/ui/components/ChatView/SubagentBar.tsx`
  - `packages/ui/lib/chat-engine-v2/store.ts`
- **Observed:** Inline card shows 4 subagents, floating bottom bar shows 8.
- **Trigger:** Reopen/open focused window for chat with historical subagents.
- **Failure mode:** Bottom bar shows all session subagents, not current assistant turn.
- **Cause:** `SubagentBar` receives full `spawnedSubagents`; inline message card derives subagents from current message tool calls.
- **Specific problematic logic:**
  - `ChatView/index.tsx`: `<SubagentBar subagents={spawnedSubagents} ... />`
  - `store.ts resetDetachedActivityForNewTurn()` preserves linked old subagents with `Boolean(spawn.sessionKey)`.
- **Why main window can look correct:** It may still hold live current-turn state.
- **Why focused/new window fails:** It reconstructs historical `spawnedSubagents` from bootstrap/backlog.
- **Fix:** Floating bar should show latest/current-turn active agents only. Keep historical completed agents anchored in message history.
- **Metrics:**
  - `subagents.global_count`
  - `subagents.current_turn_count`
  - `subagents.active_count`
  - `subagents.duplicates_by_sessionKey`

### B2. Duplicate/reordered user message after assistant reply

- **Files:**
  - `packages/ui/lib/chatMessageDedupe.ts`
  - `packages/ui/lib/chat-engine-v2/applyPatches.ts`
  - `packages/ui/hooks/useChatMessages.ts`
- **Trigger:** Focused/new window loads warm cache optimistic row, then receives canonical/bootstrap/replay user message.
- **Failure mode:** Same user message appears again after assistant has replied.
- **Cause:** Optimistic/cached and canonical user messages may not dedupe if IDs/text/attachments differ; timeline sort can prefer timestamps over gateway sequence.
- **Fix:**
  - Dedupe optimistic rows against canonical bootstrap using normalized text, attachments, clientMessageId, and gateway index.
  - Prefer gateway sequence / `__openclaw.seq` over `createdAt` when ordering replayed messages.
- **Metrics:**
  - `chat.duplicate_user_text_hash_count`
  - `chat.optimistic_after_bootstrap_count`
  - `chat.reordered_by_timestamp_count`

---

## C. Focused / New Chat Window Edge Cases

### C1. Fresh JS realm loses main-window in-memory state

- **Files:**
  - `packages/ui/components/AppPage.tsx` (`FocusedChatWindowPage`)
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/chat-engine-v2/store.ts`
- **Trigger:** Open chat as focused/new window.
- **Failure mode:** Subagent counts/status/message ordering differs from main window.
- **Cause:** New window does not share in-memory `states`, listeners, timeline store, pending optimistic rows, or live subagent state.
- **Fix:** Focused window bootstrap must be authoritative for active run/tools/subagents, not dependent on what patches happen to replay.
- **Metrics:**
  - `focused.bootstrap.spawnedSubagentCount`
  - `focused.global_state_empty_on_boot`

### C2. Global patch cursor skips active session backlog

- **Files:**
  - `packages/ui/lib/chat-engine-v2/store.ts`
  - `packages/ui/lib/chat-engine-v2/client.ts`
- **Trigger:** Another chat/window advances global patch cursor, then focused window opens an older/busy chat.
- **Failure mode:** Focused window misses older patches needed to reconstruct status/tools/subagents.
- **Cause:** `openPatchStreamV2(globalCursor)` uses a global cursor from localStorage; new window has no per-session in-memory state.
- **Fix:** Persist per-session cursors or start focused stream from `min(globalCursor, bootstrap.cursor)` for active session.
- **Metrics:**
  - `patch_stream.start_after_cursor`
  - `chat.bootstrap.cursor`
  - warning when `streamCursor > bootstrapCursor && localStateEmpty`

### C3. Bootstrap metadata/windowed history loses subagent anchoring

- **Files:**
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/chatHistoryParser.ts`
  - `packages/ui/components/ChatView/index.tsx`
- **Trigger:** Bootstrap returns recent/windowed metadata without the assistant tool-call message that spawned child agents.
- **Failure mode:** Subagents exist globally but do not anchor to correct user message.
- **Fix:** Include `triggerUserMessageId` / `parentMessageId` directly in bootstrap `SpawnedSubagent` projection.
- **Metrics:**
  - `subagents.spawned_count`
  - `subagents.rendered_anchored_count`
  - `subagents.unanchored_count`

### C4. Warm cache races bootstrap

- **Files:**
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/warmChatCache.ts`
  - `packages/ui/lib/chat-engine-v2/timelineStore.ts`
- **Trigger:** Focused window starts from disk warm cache, then fresh bootstrap arrives.
- **Failure mode:** Flicker, message count jumps, stale optimistic rows, reorder.
- **Fix:** Source priority: live/bootstrap > warm cache. Warm cache must never re-add lower-priority optimistic/stale rows after bootstrap.
- **Metrics:**
  - `chat.source_transition`
  - `warm_cache.age_ms`
  - `warm_cache.active_subagents_present`

### C5. Existing focused Tauri window reuse can preserve stale session/title

- **Files:**
  - `packages/ui/lib/openRouteWindow.ts`
  - `packages/ui/components/AppPage.tsx` (`FocusedChatWindowPage`)
- **Trigger:** Reopen/focus an existing focused chat window with payload missing sessionKey/title.
- **Failure mode:** Window preserves old resolved session/title.
- **Fix:** When payload lacks sessionKey, always resolve from `middleware_chats_list`; do not preserve previous session if chatId meaningfully changes.
- **Metrics:**
  - `focused.reuse.payload_session_missing`
  - `focused.resolved_session_changed`

### C6. Cross-window warm cache invalidation incomplete

- **Files:**
  - `packages/ui/lib/cacheRealtime.ts`
  - `packages/ui/lib/warmChatCache.ts`
  - `packages/ui/lib/middleware-client.ts`
- **Trigger:** Main window updates chat while focused window later opens from persisted cache.
- **Failure mode:** Focused window renders stale cached tools/subagents/messages before bootstrap corrects it.
- **Fix:** BroadcastChannel/storage events for warm chat writes, or ignore warm cache for active tools/subagents in focused windows.
- **Metrics:**
  - `warm_cache.stale_active_state_used`
  - `warm_cache.cross_window_invalidated`

### C7. Focused windows lack inspector plumbing

- **Files:**
  - `packages/ui/components/AppPage.tsx` (`FocusedChatWindowPage`)
- **Trigger:** User tries to inspect subagent/activity/git/workspace from focused window.
- **Failure mode:** Inspector unavailable or subagent open path behaves differently from main shell.
- **Fix:** Either intentionally hide inspector actions in focused windows, or add a focused inspector shell.
- **Metrics:**
  - `focused.inspector_action_attempted`

---

## D. Workspace / Git / Inspector Multi-Window Edge Cases

### D1. Workspace stays bound to old session

- **Files:**
  - `packages/ui/components/inspector/WorkspaceTab.tsx`
- **Trigger:** Switch chats while inspector stays mounted under same project key.
- **Failure mode:** Workspace reads/writes/refreshes previous session workspace.
- **Cause:** Once `workspaceSessionKey` is set, effect exits early and ignores new `sessionKey`.
- **Fix:** Reset workspace session key on meaningful `sessionKey` change.
- **Metrics:**
  - `workspace.effectiveSessionKey`
  - `workspace.activeChatSessionKey`
  - mismatch warning

### D2. Workspace/Git inspector keys are not session-scoped

- **Files:**
  - `packages/ui/components/inspector/InspectorView.tsx`
- **Trigger:** Direct chats with `projectId=null`.
- **Failure mode:** Multiple chats share `key="global"` inspector state.
- **Fix:** Key Workspace/Git by `projectId:sessionKey`, not project only.
- **Metrics:**
  - `inspector.key_scope`
  - `inspector.session_mismatch`

### D3. Git repo selection leaks across windows

- **Files:**
  - `packages/ui/components/inspector/GitTab.tsx`
- **Trigger:** One window selects repo in non-project Git tab; another opens Git with `projectId=null`.
- **Failure mode:** New window silently adopts previous repo via localStorage.
- **Fix:** Scope persisted Git selection by windowId/project/session.
- **Metrics:**
  - `git.selection_source`
  - `git.selection_window_scope`

### D4. Subagent open can target Activity while inspector remains on another tab

- **Files:**
  - `packages/ui/components/AppPage.tsx`
- **Trigger:** User opens subagent while inspector is on Git/Workspace/Terminal.
- **Failure mode:** `activeAgentId` is set, but user sees unrelated tab.
- **Fix:** Switch inspector tab to Activity on subagent open.
- **Metrics:**
  - `subagent.open.inspector_tab_before`

---

## E. Git Tab Edge Cases

### E1. Git load failures are swallowed

- **Files:**
  - `packages/ui/components/inspector/GitTab.tsx`
- **Trigger:** Git status/branch call fails.
- **Failure mode:** UI shows misleading empty state instead of error.
- **Fix:** Add `gitError` state and retry/details UI.
- **Metrics:**
  - `git.load.fail_visible`

### E2. Duplicate Git status calls

- **Files:**
  - `packages/ui/components/inspector/GitTab.tsx`
- **Trigger:** Repo selection updates state and explicitly calls load.
- **Failure mode:** Auto-load effect and manual load both run.
- **Fix:** Set skip flag before selection update or use one state-machine load.
- **Metrics:**
  - `git.load.duplicate_suppressed`

### E3. Expensive backend Git status

- **Files:**
  - `apps/middleware/src/features/compat/routes.ts`
- **Trigger:** Passive Git tab status load.
- **Failure mode:** Backend runs `git fetch --prune` and multiple commands.
- **Fix:** No-fetch by default; explicit refresh-fetch action.
- **Metrics:**
  - `git.fetch.duration_ms`
  - `git.status.duration_ms`
  - backend command timing per command

---

## F. Workspace Tab Edge Cases

### F1. Recursive refresh burst

- **Files:**
  - `packages/ui/components/inspector/WorkspaceTab.tsx`
- **Trigger:** Focus/SSE/manual refresh with many expanded directories.
- **Failure mode:** Root plus every expanded dir fetches recursively.
- **Fix:** Debounce/dedupe refreshes; cap concurrency; refresh only changed paths when possible.
- **Metrics:**
  - `workspace.load.request_count`
  - `workspace.expanded_dir_count`
  - `workspace.refresh.reason`

### F2. Tree errors hidden as empty folders

- **Files:**
  - `apps/middleware/src/features/compat/routes.ts`
- **Trigger:** Backend tree read fails.
- **Failure mode:** Backend returns `{ entries: [] }`; UI cannot distinguish empty from error.
- **Fix:** Return 404/error for path failures.
- **Metrics:**
  - `workspace.tree_empty_due_to_error`

### F3. Capabilities stale race

- **Files:**
  - `packages/ui/components/inspector/WorkspaceTab.tsx`
- **Trigger:** Project/session switch during slow capabilities fetch.
- **Failure mode:** Old capabilities enable wrong buttons.
- **Fix:** Request sequence guard / AbortController.
- **Metrics:**
  - `workspace.capabilities_stale_drop`

### F4. Save overwrite race

- **Files:**
  - `packages/ui/components/inspector/WorkspaceTab.tsx`
- **Trigger:** Save while switching file/project.
- **Failure mode:** Slow save marks wrong editor clean.
- **Fix:** Snapshot filePath/project/session before save and verify before applying clean state.
- **Metrics:**
  - `workspace.save_file_changed_race`

---

## G. Terminal Tab Edge Cases

### G1. Hidden terminal tabs keep PTYs alive

- **Files:**
  - `packages/ui/components/inspector/InspectorView.tsx`
  - `packages/ui/components/terminal/XTerminal.tsx`
- **Trigger:** Open multiple terminal tabs.
- **Failure mode:** Hidden tabs remain mounted and PTYs stay alive.
- **Fix:** Add tab cap, status, and explicit background process warning.
- **Metrics:**
  - `terminal.active_pty_count`
  - `terminal.hidden_pty_count`

### G2. Dropped keystrokes before PTY spawn ready

- **Files:**
  - `packages/ui/components/terminal/usePty.ts`
- **Trigger:** User types before `ptyIdRef.current` exists.
- **Failure mode:** Input silently dropped.
- **Fix:** Queue writes until spawn ready.
- **Metrics:**
  - `terminal.dropped_write_count`

### G3. WebSocket stream error has no real fallback

- **Files:**
  - `packages/ui/components/terminal/usePty.ts`
- **Trigger:** WS terminal stream fails.
- **Failure mode:** UI prints fallback message but does not actually fallback to SSE.
- **Fix:** Implement WS-to-SSE fallback.
- **Metrics:**
  - `terminal.ws_error_count`
  - `terminal.fallback_used`

### G4. Middleware restart breaks terminals

- **Files:**
  - `apps/middleware/src/features/compat/routes.ts`
- **Trigger:** Middleware restarts.
- **Failure mode:** PTY registry is in-memory; existing UI streams/writes become invalid.
- **Fix:** UI detects 404/restart and shows terminal disconnected state.
- **Metrics:**
  - `terminal.pty_missing_after_restart`

---

## H. Cron / Notification Activity Edge Cases

### H1. Cron Activity polls every 1 second

- **Files:**
  - `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- **Trigger:** Notification Activity tab open.
- **Failure mode:** Aggressive polling overlaps remote middleware requests.
- **Fix:** SSE-first, slower backoff polling fallback.
- **Metrics:**
  - `cron.activity.poll_interval_ms`
  - `cron.activity.overlap_count`

### H2. Poll overwrites newer SSE state

- **Files:**
  - `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- **Trigger:** SSE event arrives, then stale poll response returns.
- **Failure mode:** Older event list overwrites newer live event.
- **Fix:** Request sequence guard and event timestamp/runId merge.
- **Metrics:**
  - `cron.activity.stale_poll_drop`
  - `cron.sse_lag_ms`

### H3. Concurrent runs collapse by jobId

- **Files:**
  - `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- **Trigger:** Same cron job runs concurrently/manually.
- **Failure mode:** Only latest event per job remains; other run disappears.
- **Fix:** Key activity by `runId`, not jobId only.
- **Metrics:**
  - `cron.concurrent_run_collision`

### H4. Index-based expansion shows wrong run

- **Files:**
  - `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- **Trigger:** Events reorder after SSE/poll.
- **Failure mode:** `expandedIdx` points to wrong event.
- **Fix:** Store `expandedRunId`.
- **Metrics:**
  - `cron.expanded_event_reordered`

### H5. Cron navigation ignores runId

- **Files:**
  - `packages/ui/components/AppPage.tsx`
- **Trigger:** Navigate from cron activity event with `cronRunId`.
- **Failure mode:** Opens job/chat, not exact run.
- **Fix:** Support run-specific navigation.
- **Metrics:**
  - `cron.navigation.mode`
  - `cron.navigation.runId_ignored`

---

## Recommended Fix Order

1. **Current-turn subagent model**
   - Add `triggerUserMessageId` / `turnId` to `SpawnedSubagent`.
   - Bottom `SubagentBar` shows latest/current turn only.

2. **Focused window bootstrap correctness**
   - Bootstrap must return authoritative messages, tools, subagents, anchors, cursor.
   - Start patch stream from session-safe cursor.

3. **Optimistic/canonical user dedupe**
   - Drop persisted optimistic rows once canonical bootstrap confirms same user text/client id.
   - Sort by gateway/openclaw sequence before timestamp.

4. **Activity first paint from global state**
   - No skeleton if live global state exists.
   - Backfill subagent histories in background.

5. **Session-scoped inspector state**
   - Workspace/Git keys include `sessionKey` for direct chats.
   - Workspace resets on active session change.

6. **Cron polling cleanup**
   - SSE-first; slower poll fallback; request sequence guard.

7. **Terminal lifecycle hardening**
   - Queue input before spawn ready, real WS fallback, PTY caps/orphan cleanup.

---

## Minimum Diagnostic Logs To Add

- `focused.bootstrap.applied`
  - `windowId`, `sessionKey`, `bootstrapCursor`, `streamCursor`, `messageCount`, `spawnedSubagentCount`, `historyCoverage`
- `subagents.render.scope`
  - `globalCount`, `currentTurnCount`, `anchoredCount`, `activeCount`
- `chat.duplicate_user_candidate`
  - `messageId`, `gatewayIndex`, `createdAt`, `textHash`, `isOptimistic`
- `activity.open`
  - `usedGlobalCache`, `historyRequestCount`, `subagentHistoryCount`, `firstPaintMs`
- `inspector.session_mismatch`
  - `tab`, `effectiveSessionKey`, `activeSessionKey`, `projectId`
- `workspace.refresh`
  - `reason`, `expandedDirCount`, `requestCount`, `durationMs`
- `cron.activity.hydrate`
  - `durationMs`, `overlap`, `eventCount`, `source`
- `terminal.spawn`
  - `projectId`, `ptyId`, `spawnLatencyMs`, `streamConnectMs`, `firstByteMs`
