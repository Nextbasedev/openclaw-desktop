# Fix Chat Timeline Authority and Switching Performance

## Problem

Recent production logs show the chat UI is still behaving like a collection of defensive patches instead of one coherent timeline system.

There are three related failure modes:

1. **Patch replay can still outrun authoritative history.**
   - In `message---76ec6401-b8d4-4c96-973d-ddc8574a103f.txt`, `/api/chat/bootstrap` returns the active chat correctly with `messageCount:160` and `cursor:2476` for `agent:main:desktop:migrated-telegram-df601fcb-769b-43f5-9555-e5dae8793fc5`.
   - Immediately after, `/api/stream/ws` connects with `afterCursor:0` and replays `1000` old patches.
   - This violates `docs/constraints/chat-engine.md`: warm/global/bootstrap cursor must seed before the patch stream opens.

2. **Older-history pagination mutates the same visible timeline but does not have a first-class history-window model.**
   - In the first log, scrolling up repeatedly calls `/api/chat/messages` with `beforeSeq:2998`, `2918`, `2838`, `2758`, etc.
   - Visible `messageCount` grows (`195 -> 198 -> 203 -> 206 -> 209 -> 212 -> 215`), but global state still reports `authoritativeMessageCount:160` and sometimes `historyCoverage:"full"`.
   - That is internally contradictory: a timeline cannot display 215 messages while its authoritative window count remains 160, and it cannot be marked `full` unless the oldest projected seq has actually been reached.

3. **Rapid chat switching starts too much work and lets stale work finish late.**
   - In `message_73---95ef7856-c706-4e99-84c7-8490885a64b8.txt`, 31 chat mounts produce 31 bootstrap starts, but only 18 bootstrap loads complete in the captured window.
   - There are 100 `AbortError` log entries, mostly around `middleware_pins_list`, `middleware_branch_list`, and `middleware_models_list`.
   - Heavy bootstraps complete very late: `9475ms`, `34202ms`, `39499ms`, `69893ms`, `102179ms`, `128322ms`, `131501ms`.
   - Some sessions complete the same bootstrap multiple times after switching away, e.g. `ba1a70a7...` and `33e9d717...`.
   - `chat.bootstrap-recovery.reload` fires for the active chat when an archive import patch arrives for a different session, causing avoidable reloads/remounts.

These failures are symptoms of the same architectural gap: there is no single timeline authority that owns active history window state, stream cursor lifecycle, pagination coverage, and cancellation/scheduling.

## Current Flow

### UI chat hook

`packages/ui/hooks/useChatMessages.ts` currently owns too many concerns in one hook:

- derives initial messages from warm cache, global session cache, query cache, or `initialMessages`.
- calls `ensureGlobalChatEngine(queryClient)` during mount.
- fetches `/api/chat/bootstrap` for authoritative visible history.
- listens to patch stream state through the global chat-engine store.
- handles older-history pagination through `loadOlderMessages()`.
- seeds global chat session after pagination so patch notifications do not snap the UI back to the shorter bootstrap window.

Relevant current code:

- `packages/ui/hooks/useChatMessages.ts:1459` calls `ensureGlobalChatEngine(queryClient)` during hook initialization.
- `packages/ui/hooks/useChatMessages.ts:2504-2582` implements `loadOlderMessages()` and seeds global state with merged older pages.

### Global patch stream store

`packages/ui/lib/chat-engine-v2/store.ts` keeps process-wide session state and stream cursor:

- `ensureGlobalChatEngine()` restores localStorage cursor, considers existing session cursors, then opens `/api/stream/ws`.
- `seedGlobalChatSession()` merges or replaces state and updates `globalCursor`.
- `handleFrame()` applies patches and persists `globalCursor`.

Relevant current code:

- `packages/ui/lib/chat-engine-v2/store.ts:1329-1344` restores `globalCursor` and opens the stream.
- `packages/ui/lib/chat-engine-v2/store.ts:1346-1415` seeds a session from bootstrap/cache/local pagination.
- `packages/ui/lib/chat-engine-v2/store.ts:1180-1310` applies patch frames to global session state.

### Patch stream client

`packages/ui/lib/chat-engine-v2/client.ts` opens the websocket and handles replay:

- `openPatchStreamV2(afterCursor, onFrame)` connects to `/api/stream/ws?afterCursor=N`.
- If the server reports `replayHasMore`, it starts HTTP backlog replay from `afterCursor`.
- Replayed frames are applied through the same path as live patches.

Relevant current code:

- `packages/ui/lib/chat-engine-v2/client.ts:145-243` owns websocket connection, replay, buffering, and reconnect.

### Middleware routes

`apps/middleware/src/features/chat/routes.ts` owns:

- `GET /api/chat/bootstrap` as the authoritative visible snapshot.
- `GET /api/chat/messages` for paginated history.
- background archive import/recovery projection.

`apps/middleware/src/features/patches.ts` owns:

- `WS /api/stream/ws`.
- `GET /api/patches` backlog replay.

## Root Cause

The UI has two competing concepts of history:

1. **Snapshot/window history** from `/api/chat/bootstrap` and `/api/chat/messages`.
2. **Patch replay state** from `/api/stream/ws` and `/api/patches`.

Both can currently mutate visible chat state. This is why every later patch needs special-case defense: metadata bootstrap cannot be empty, stale tools must be skipped, global session must be reseeded after pagination, recovery patches can reload the wrong active chat, etc.

The architecture should instead make the contract explicit:

- Bootstrap/pagination owns **history windows**.
- Patch stream owns **live deltas after a known cursor**.
- Replay from an unknown/zero cursor is **recovery metadata**, not visible history.
- Side metadata commands (pins, branches, models) are **not active-chat render blockers** and must be scheduled/deduped.

## Proposed Fix

### 1. Introduce a first-class `ChatTimelineStore`

Create or refactor the UI chat-engine state around a timeline model:

```ts
type HistoryCoverage = "metadata" | "windowed" | "full"

type ChatTimelineState = {
  sessionKey: string
  messages: ChatMessage[]
  cursor: number
  loadedOldestSeq: number | null
  loadedNewestSeq: number | null
  knownTotalMessages: number | null
  loadedMessageCount: number
  historyCoverage: HistoryCoverage
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  source: "warm-cache" | "bootstrap" | "pagination" | "live-patch" | "recovery-metadata"
}
```

Rules:

- `historyCoverage:"full"` only when `loadedOldestSeq <= firstProjectedSeq` or middleware explicitly says there are no earlier messages.
- Paginating older history updates `loadedOldestSeq`, `loadedNewestSeq`, `loadedMessageCount`, and `knownTotalMessages` together.
- Metadata-only patch replay may update cursor/status counts, but cannot replace `messages` for the active timeline.
- Live message patches can append/merge into the current window only when `patch.cursor > timeline.cursor` and cursor lifecycle is valid.

### 2. Gate global stream startup behind a valid cursor

Change `ensureGlobalChatEngine()` from “always connect after restoring localStorage” to an explicit lifecycle:

- `initializeTimelineRuntime({ activeSessionKey, bootstrapPromise?, queryClient })`.
- Use the best cursor source in order:
  1. persisted stream cursor for this middleware URL,
  2. active chat bootstrap cursor,
  3. cached full/window bootstrap cursor,
  4. recovery mode.

If the only cursor is `0` and active chat bootstrap is in flight:

- do not open `/api/stream/ws` yet, or
- open in metadata/recovery mode that cannot mutate visible active history.

Never allow a normal stream connection from `afterCursor:0` to replay 1000 old patches directly into visible session state after a bootstrap cursor is known.

### 3. Split stream replay from live patch application

In `openPatchStreamV2()` / store handling:

- `hello.replayHasMore` or `replayWindowExceeded` should mark stream state as `recovery-required`.
- Recovery should refetch active bootstrap and session metadata, not apply every old patch as visible chat history.
- Replayed `chat.bootstrap` should become `recovery-metadata` unless it is explicitly full and belongs to the active bootstrap transaction.

### 4. Add request cancellation and stale-result guards for chat switching

For `useChatMessages()`:

- Each mount/session switch gets a monotonic `timelineLoadId`.
- Bootstrap responses only apply if their `loadId` still matches the active session instance.
- Abort in-flight `/api/chat/bootstrap`, pins, branches, and side metadata calls when switching away.
- Keep previous/warm preview visible when switching rapidly instead of rendering empty `loading:true` whenever metadata says `messageCount:160` but messages are not present.

For side metadata:

- Deduplicate `middleware_pins_list`, `middleware_branch_list`, `middleware_models_list` across rapid switches.
- Rate-limit or cache them separately from chat timeline load.
- Do not let these 8s aborting requests block chat render.

### 5. Make archive-import recovery session-scoped

Current logs show `global-chat-session.archive-import-refresh` for one session triggering `chat.bootstrap-recovery.reload` in another active session.

Change recovery events to include the affected `sessionKey` and only reload hooks for that same session.

- `openclaw:chat-bootstrap-recovery` should carry `{ sessionKey }`.
- `useChatMessages()` should ignore recovery events for other sessions.

### 6. Make heavy chat rendering windowed/virtualized

For chats with 160+ loaded messages and large tool/output payloads:

- render only a window of visible messages via virtualization or message-window chunking.
- hydrate heavy tool/result content lazily when expanded/visible.
- keep the timeline store capable of holding the loaded window, but avoid forcing React to render every heavy message on each switch.

This is not a workaround; it is the correct UI architecture for large imported Telegram sessions.

## Files to Change

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Replace loose session state with a timeline/window-aware state model.
  - Add cursor lifecycle states: `uninitialized`, `ready`, `recovery-required`.
  - Prevent metadata/replay patches from replacing active history windows.

- `packages/ui/lib/chat-engine-v2/client.ts`
  - Separate live stream frames from backlog/recovery frames.
  - Surface replay overflow as recovery state instead of applying all old frames normally.

- `packages/ui/hooks/useChatMessages.ts`
  - Use timeline load ids and abort controllers.
  - Apply bootstrap/pagination through timeline APIs.
  - Ignore session-scoped recovery events for other sessions.
  - Stop treating metadata-only `messageCount` as render-ready history.

- `packages/ui/lib/chat-engine-v2/types.ts`
  - Add `loadedOldestSeq`, `loadedNewestSeq`, `knownTotalMessages`, and source/coverage types.

- `apps/middleware/src/features/chat/routes.ts`
  - Return explicit pagination metadata from `/api/chat/bootstrap` and `/api/chat/messages`: oldest/newest seq, hasOlder, total/known count if available.
  - Ensure background archive recovery patches include affected `sessionKey` and clear metadata semantics.

- `apps/middleware/src/features/patches.ts`
  - Consider a stream recovery response mode when `afterCursor` is too old / zero and replay is huge.

- `packages/ui/components/ChatView/*`
  - Add virtualization/windowed rendering for heavy histories if not already available.
  - Preserve existing scroll constraints from `docs/constraints/ui-scroll.md`.

## Risks

- **Live streaming regressions:** assistant/tool/thinking patches must still update active sessions instantly after the cursor is valid.
- **Scroll regressions:** pagination must preserve scroll position and first-open bottom scroll per `docs/constraints/ui-scroll.md`.
- **Multi-window regressions:** each window must keep layout/session isolation per `docs/constraints/sessions.md`; shared stream cursor cannot cause cross-window visible history bleed.
- **Gateway event ordering:** Gateway events remain out-of-order; timeline store must continue ordering by `openclaw_seq` and cursor.
- **Recovery gaps:** if stream replay is skipped too aggressively, active chats could miss live deltas. The fix must use bootstrap recovery to close gaps before accepting live deltas.

## Testing

### Unit / integration

- Add `chat-engine-v2` tests:
  - stream does not connect with `afterCursor:0` when active bootstrap cursor is pending/available.
  - replayed metadata `chat.bootstrap` cannot replace active bootstrap messages.
  - replay overflow enters recovery state instead of mutating visible chat history.
  - pagination updates `loadedOldestSeq`, `loadedNewestSeq`, `loadedMessageCount`, and `historyCoverage` consistently.
  - `historyCoverage:"full"` is only set when oldest seq is reached or authoritative empty state is returned.

- Add `useChatMessages` tests:
  - stale bootstrap response after rapid switch is ignored.
  - in-flight side metadata requests do not keep chat in loading state.
  - session-scoped archive recovery only reloads matching session.

- Add middleware tests:
  - `/api/chat/bootstrap` returns explicit window metadata.
  - `/api/chat/messages` returns explicit page metadata.
  - archive recovery patch includes affected session key and metadata-only marker.

### Manual / production verification

- Rapidly switch 10+ migrated Telegram chats:
  - no long empty loading screen if warm/global preview exists.
  - no late stale bootstrap overwrites current chat.
  - side metadata aborts do not block chat render.

- Open two windows on same heavy migrated chat:
  - both converge to same timeline.
  - no replay from `afterCursor:0` after bootstrap cursor is known.

- Scroll up in a heavy chat:
  - older pages load without duplicates/weird jumps.
  - message count/window metadata stays internally consistent.
  - `historyCoverage` remains `windowed` until oldest seq is reached.

### Gates

- `pnpm --filter ui typecheck`
- `pnpm --filter ui test`
- `pnpm --filter ui build`
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter @openclaw/desktop-middleware test`
- `git diff --check`

## Stop Point

This is a planning artifact only. Do not implement until `feature-build` is requested.
