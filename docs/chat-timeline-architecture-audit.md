# Chat Timeline Architecture Audit

## Scope

This audit covers the current Desktop chat timeline failures visible in the May 22 production logs:

- wrong/buggy history while scrolling up,
- slow loading when multiple chat tabs/sessions are switched rapidly,
- heavy migrated Telegram chats lagging or rendering late,
- patch-stream replay and archive-import recovery causing visible state churn.

This is an audit, not an implementation patch. The goal is to define the architecture so the next build does not create another chain of guards.

## Executive Finding

The current design lets **three different systems mutate the visible chat timeline**:

1. `/api/chat/bootstrap` and `/api/chat/messages` return authoritative projected history.
2. `/api/stream/ws` replay/live patches mutate global session state.
3. warm/global/query caches can seed visible messages during mount/switch.

That creates ambiguous ownership. When histories are small and switching is slow, it mostly works. With imported Telegram chats, rapid switching, and replay windows, the ownership breaks:

- replay can arrive before/after bootstrap,
- side metadata requests pile up,
- old bootstrap responses finish late,
- pagination expands the visible window while global metadata still says the bootstrap window is full,
- archive recovery can reload unrelated active chats.

The correct architecture is a **single ChatTimelineStore with explicit history-window metadata and stream lifecycle states**.

## Evidence From Logs

### Log A: scroll-up / replay pollution

File: `/root/.openclaw/media/inbound/message---76ec6401-b8d4-4c96-973d-ddc8574a103f.txt`

Observed:

- Active bootstrap succeeds:
  - session `agent:main:desktop:migrated-telegram-df601fcb-769b-43f5-9555-e5dae8793fc5`
  - `messageCount:160`
  - `cursor:2476`
- Immediately after, patch stream connects with `afterCursor:0` and replays `1000` old patches.
- Scrolling up then repeatedly loads older pages:
  - `beforeSeq:2998`, `2918`, `2838`, `2758`, etc.
- Visible message count increases:
  - `195 -> 198 -> 203 -> 206 -> 209 -> 212 -> 215`
- But global seed logs continue to show:
  - `authoritativeMessageCount:160`
  - `historyCoverage:"full"`

Diagnosis:

- The system is mixing a **latest bootstrap window** with an **expanded local paginated window** without a proper window model.
- `historyCoverage:"full"` is incorrect unless the oldest projected seq has been loaded.
- `messageCount:160` is only the latest bootstrap page size, not the total/authoritative loaded timeline after pagination.

### Log B: rapid switching / heavy chat lag

File: `/root/.openclaw/media/inbound/message_73---95ef7856-c706-4e99-84c7-8490885a64b8.txt`

Observed by script:

- `31` chat mounts.
- `31` chat bootstrap starts.
- Only `18` bootstrap loads complete in the captured window.
- `100` AbortError log entries.
- High side-command churn:
  - `middleware_pins_list`: `100` log hits.
  - `middleware_branch_list`: `68` log hits.
  - `middleware_models_list`: `22` log hits.
- Heavy bootstrap durations include:
  - `9475ms`, `34202ms`, `39499ms`, `69893ms`, `102179ms`, `128322ms`, `131501ms`.
- Same sessions complete bootstraps multiple times after switching away.
- Archive import recovery for one session causes `chat.bootstrap-recovery.reload` in a different active hook.

Diagnosis:

- Chat switching starts new bootstraps and side metadata calls faster than old work is cancelled/deduped.
- Late bootstrap results are not treated as stale work at the architecture level.
- Side metadata is still coupled too closely to active chat rendering.
- Archive recovery is global rather than session-scoped.

## Current Code Findings

### Middleware bootstrap reports a full snapshot even when it is a page

`apps/middleware/src/features/chat/routes.ts:1205-1226` returns latest projected messages with a limit.

`apps/middleware/src/features/chat/projection.ts:110-154` builds the response with:

- `historyCoverage: "full"`
- `fullMessagesIncluded: true`
- `messageCount: params.messageCount`

But `params.messageCount` is the number of messages returned in the current bootstrap page, not necessarily the total session history. For a heavy imported session, `160` means “latest 160 messages returned,” not “the complete timeline is 160 messages.”

This is a primary architecture bug.

Correct contract:

- Bootstrap should normally return `historyCoverage:"windowed"`, not `full`, when limited latest history is returned.
- It should include `loadedOldestSeq`, `loadedNewestSeq`, `hasOlder`, and optionally `knownTotalMessages`.
- `full` is only valid if there are no older messages before `loadedOldestSeq`.

### Pagination response lacks enough metadata

`apps/middleware/src/features/chat/routes.ts:1229-1261` returns messages and `messageCount: messages.length`.

It does not return:

- `loadedOldestSeq`,
- `loadedNewestSeq`,
- `hasOlder`,
- `hasNewer`,
- total/known projected count.

The UI therefore infers coverage from page size and local refs, which is fragile around merged messages/tool rows.

Correct contract:

- `/api/chat/messages` must return page-window metadata so UI does not guess.

### Global stream can connect before active timeline has established authority

`packages/ui/hooks/useChatMessages.ts:1459` calls `ensureGlobalChatEngine(queryClient)` during mount.

`packages/ui/lib/chat-engine-v2/store.ts:1329-1344` restores global cursor and opens `/api/stream/ws`.

When restored cursor is absent or wrong, stream opens with `afterCursor:0` and replay frames can mutate visible global state.

Correct contract:

- Stream starts only after a valid cursor is known, or starts in recovery mode that cannot mutate visible history.

### Recovery event is global, not session-scoped

`packages/ui/lib/chat-engine-v2/store.ts:1301-1307` dispatches:

```ts
window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery"))
```

`packages/ui/hooks/useChatMessages.ts:1548-1553` reloads any mounted hook that hears it.

Correct contract:

- Recovery event must carry `{ sessionKey }`.
- Hooks must ignore recovery for other sessions.

### Side metadata is not isolated from chat switching

The logs show rapid repeated calls to pins, branch list, and model list during chat switching. These requests hit 8s aborts and create congestion/noise.

Correct contract:

- Chat render path cannot depend on side metadata.
- Side metadata must be cached, deduped, cancellable, and lower priority.

## Required Architecture

### 1. Single owner: `ChatTimelineStore`

The UI should have one state object per session/window timeline:

```ts
type HistoryCoverage = "metadata" | "windowed" | "full"

type TimelineSource =
  | "warm-cache"
  | "bootstrap"
  | "pagination"
  | "live-patch"
  | "recovery-metadata"

type ChatTimelineState = {
  sessionKey: string
  messages: ChatMessage[]
  cursor: number
  loadedOldestSeq: number | null
  loadedNewestSeq: number | null
  knownTotalMessages: number | null
  loadedMessageCount: number
  hasOlder: boolean
  hasNewer: boolean
  historyCoverage: HistoryCoverage
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  source: TimelineSource
}
```

Ownership rules:

- `bootstrap` initializes/replaces the authoritative visible window.
- `pagination` expands the window.
- `live-patch` appends/merges only after cursor authority is valid.
- `recovery-metadata` can update cursor/status/count hints, but cannot replace active messages.
- `warm-cache` can paint quickly, but must be marked `windowed` or `metadata` unless it proves full coverage.

### 2. Explicit stream lifecycle

The global stream runtime should have states:

- `uninitialized`: no cursor authority yet.
- `waiting-for-bootstrap`: active bootstrap in progress, do not replay from 0 into visible state.
- `ready`: cursor is valid; live patches can apply.
- `recovery-required`: cursor is missing/too old; refetch bootstrap/session metadata before applying patches.
- `closed`: teardown.

Rules:

- `afterCursor:0` is not allowed for normal visible replay after an active chat bootstrap is pending or known.
- If stream replay reports `replayHasMore`, do not apply all replay frames as normal visible history. Enter recovery.
- Live patches received while recovery is active are buffered by cursor, then applied after bootstrap catches up.

### 3. Middleware history-window contract

`GET /api/chat/bootstrap` must return:

```ts
{
  messages,
  cursor,
  loadedOldestSeq,
  loadedNewestSeq,
  returnedMessageCount,
  knownTotalMessages,
  hasOlder,
  hasNewer: false,
  historyCoverage: "windowed" | "full",
  fullMessagesIncluded: boolean
}
```

`GET /api/chat/messages` must return the same window metadata for that page.

Rules:

- `historyCoverage:"full"` only when no older messages exist.
- `messageCount` should not ambiguously mean both returned page count and known total. Use distinct names.
- `knownTotalMessages` may be null if expensive, but `hasOlder` must be reliable.

### 4. Request scheduler for chat switching

The UI needs a lightweight scheduler:

- Active chat bootstrap: high priority, one active per visible chat pane.
- Previous active bootstrap: aborted on switch unless already needed by another pane.
- Side metadata: low priority, deduped by key and cached.
- Heavy background refresh: low priority, never blocks initial visible paint.

Each bootstrap request gets:

- `loadId`,
- `sessionKey`,
- `AbortController`,
- `startedAtMs`.

Apply rule:

- A bootstrap/pagination result may update state only if `loadId` and `sessionKey` still match the mounted timeline.

### 5. Heavy-history rendering

For heavy migrated chats:

- render a virtual/windowed list, not every loaded message/tool payload on every switch.
- collapsed/offscreen tool outputs should not fully hydrate until visible/expanded.
- pagination prepends must preserve scroll anchor by seq/message id, not only `scrollHeight` delta.

## Edge Cases To Cover

### Cursor and replay edge cases

- Fresh install: no persisted cursor, no warm cache, active chat has messages.
- Middleware DB reset: persisted UI cursor is higher than middleware cursor range.
- Middleware restart: cursor sequence restarts or patch table is truncated.
- Two windows open: one has a newer cursor than the other.
- Stream connects, receives `replayHasMore:true`.
- Stream reconnects while bootstrap is in flight.
- Live user sends while recovery is in progress.
- Patch for inactive session arrives before that session has ever bootstrapped.
- Patch for active session arrives with cursor lower than bootstrap cursor.
- Patch has status/tool metadata but no message payload.
- `chat.bootstrap` replay contains `messageCount` but no messages.
- `chat.bootstrap` replay is from background archive import.

### Bootstrap/history edge cases

- Empty new chat: no messages, authoritative empty state is valid.
- Non-empty chat but metadata-only replay says zero messages.
- Bootstrap returns fewer than requested because session has fewer messages.
- Bootstrap returns exactly the page limit but there may be older messages.
- `chat.history` returns 66 Gateway messages but projection has 160 imported messages.
- Archive import adds older messages after bootstrap.
- Archive import resequences messages while user is viewing the chat.
- `knownTotalMessages` is unavailable or expensive.
- Message rows include tool calls/results that parse into fewer UI messages than raw rows.
- Consecutive assistant rows merge in parser, changing displayed count.
- Attachments and marker text are normalized during parsing.

### Pagination/scroll edge cases

- User scrolls up repeatedly while older page request is in flight.
- User switches chat while older page request is in flight.
- Older page overlaps already-loaded messages.
- Older page returns zero messages.
- Older page returns exactly page limit but no older messages remain.
- `beforeSeq` points into a merged assistant group.
- New live message arrives while user is paginating older history.
- User is not at bottom; live update must not force scroll.
- First open should still scroll to bottom.
- Background split pane must not steal scroll.

### Rapid switching edge cases

- User clicks 10 chats in 10 seconds.
- User returns to a chat whose previous bootstrap is still in flight.
- Bootstrap A completes after chat B is active.
- Same session has duplicate bootstrap requests in flight.
- Pins/branches/models side calls are slow or timeout.
- Side metadata finishes after chat is unmounted.
- Query cache has old bootstrap data but warm cache has newer cursor.
- Warm cache exists but only contains metadata/no messages.
- Multiple windows mount same session simultaneously.

### Archive recovery edge cases

- Archive import for inactive session should not reload active session.
- Archive import for active session should refetch only that session.
- Multiple archive imports complete close together.
- Archive import emits `messageCount:1000` but no full messages.
- Recovery arrives while user is sending a message.
- Recovery arrives while user is paginating older history.

### Live run/tool edge cases

- Assistant/tool patches arrive before final bootstrap.
- Tool started patch replay is stale.
- Tool result arrives without tool started.
- Running tool from old run should not appear in new run.
- Assistant final text arrives without separate done status.
- Gateway `chat.send` returns done before assistant appears.
- Send optimistic user is confirmed by live event before post-send history.
- Duplicate Gateway user echo arrives later.

### Data/source edge cases

- Imported Telegram group topics with duplicate names.
- Direct Telegram sessions and desktop sessions use different key shapes.
- Gateway session file rotation changes segments.
- Timestamp ordering conflicts with `openclaw_seq` ordering.
- Large attachments/tool outputs make payload > 1MB.
- Middleware body/log limits are hit.

## Non-Negotiable Invariants

- Visible chat history is ordered by `openclaw_seq`, not timestamp.
- Bootstrap/pagination own history; patch stream owns live deltas after valid cursor.
- Metadata-only replay cannot make a non-empty chat look empty.
- A latest-window bootstrap is `windowed`, not `full`, unless no older messages exist.
- `messageCount` must not be ambiguous; separate returned count from known total.
- Stale async results must not mutate current active session.
- Side metadata must not block chat render.
- Recovery events must be session-scoped.
- Scroll position must be preserved on pagination and user scroll-up.
- First open must still scroll to latest.
- Multi-window isolation must hold.

## Proposed Build Phases

### Phase 1: Correct middleware history contract

- Add window metadata to `/api/chat/bootstrap` and `/api/chat/messages`.
- Stop returning `historyCoverage:"full"` for limited latest windows unless no older messages exist.
- Rename/augment counts to remove ambiguity:
  - `returnedMessageCount`,
  - `knownTotalMessages`,
  - `loadedOldestSeq`,
  - `loadedNewestSeq`,
  - `hasOlder`,
  - `hasNewer`.

Why first:

- UI cannot be architecturally correct while the API labels latest pages as full history.

### Phase 2: Timeline store and cursor lifecycle

- Add timeline state fields to `chat-engine-v2`.
- Gate stream startup behind valid cursor or recovery mode.
- Treat replay overflow as recovery, not normal visible patch application.
- Keep live patches buffered until bootstrap establishes cursor authority.

Why second:

- This removes the need for many patch-specific defensive guards.

### Phase 3: Rapid-switch scheduler and stale-result guards

- Add per-session `loadId` and `AbortController` for bootstrap/pagination.
- Ignore stale results.
- Deduplicate active bootstrap per session.
- Cache/dedupe side metadata separately.
- Make side metadata non-blocking.

Why third:

- Fixes the 31 mounts / 31 bootstraps / 100 AbortError failure mode.

### Phase 4: Session-scoped recovery

- Include `sessionKey` in recovery events.
- Hooks ignore recovery for other sessions.
- Recovery updates timeline state without remount loops.

Why fourth:

- Prevents archive import from causing unrelated active chat reloads.

### Phase 5: Heavy rendering performance

- Virtualize/window message rendering.
- Lazy-hydrate heavy tool outputs and attachments.
- Preserve scroll anchor by message seq/id.

Why fifth:

- Once data ownership is correct, optimize rendering without masking state bugs.

## Tests Required Before Shipping

### Middleware tests

- Bootstrap limited page returns `windowed`, not `full`, when older messages exist.
- Bootstrap empty chat returns authoritative `full` with `hasOlder:false`.
- Messages pagination returns reliable `loadedOldestSeq`, `loadedNewestSeq`, `hasOlder`.
- Archive recovery patch includes `sessionKey` and metadata-only marker.

### UI store tests

- Stream does not normal-connect from `afterCursor:0` when bootstrap is pending.
- Replay overflow enters recovery state.
- Replayed metadata bootstrap cannot replace active messages.
- Live patch after valid cursor appends/merges correctly.
- Lower-cursor patch is skipped or metadata-only.
- Pagination expands timeline and keeps coverage `windowed` until oldest seq reached.

### Hook tests

- Bootstrap result for old session is ignored after switching.
- Duplicate bootstrap for same session is deduped or latest-only.
- Side metadata timeout does not keep `loading:true`.
- Recovery for session A does not reload session B.
- Recovery for active session refetches once, not loop.

### Scroll/render tests

- First open scrolls bottom.
- Scroll-up pagination preserves anchor.
- Live update does not jump when user is reading older messages.
- Heavy chat renders without mounting every large tool output synchronously.

### Production verification

- Rapidly switch 10+ migrated Telegram chats.
- Open two windows on same heavy chat.
- Scroll up through 300+ messages.
- Trigger archive import recovery and confirm only matching session reloads.
- Confirm no normal `/api/stream/ws?afterCursor=0` after bootstrap cursor exists.

## What Not To Do

- Do not add another frontend-only filter for `chat.bootstrap` patches.
- Do not hide loading spinners without fixing request lifecycle.
- Do not mark latest 160 messages as `full` history.
- Do not let side metadata be part of chat readiness.
- Do not globally reload all chat hooks on archive recovery.
- Do not solve heavy chats only by increasing limits.
- Do not merge patch replay and full history into one undifferentiated message array.

## Recommended Next Step

Use `feature-build` only after agreeing to this phased architecture. Phase 1 and Phase 2 should be implemented together or behind a compatibility adapter, because changing middleware coverage semantics without updating the UI store could expose more loading states temporarily.
