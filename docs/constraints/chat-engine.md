# Chat Engine Constraints

## Message Ordering

- `openclaw_seq` is the single canonical, monotonic ordering key. Messages are
  ordered by it within segments, NOT by timestamp and NOT by raw `gatewaySeq`.
- Gateway timestamps can be inconsistent across segments.
- **Do not re-derive order from `gatewaySeq`.** Within a single run the raw
  Gateway sequence can be out of order (e.g. a `sessions_spawn`/subagent-spawn
  assistant message gets a HIGHER `gatewaySeq` than its own tool results and the
  follow-up reply). The frontend parser (`messageOrderSeq` in
  `chatHistoryParser.ts`) must trust `__openclaw.seq` first and only fall back to
  a gateway-derived position when the canonical seq is absent (pure live rows
  not yet persisted). `gatewaySeq` is identity/match metadata, not order.
- `openclaw_seq` is ORDER, not identity. The middleware `upsertMessages` only
  appends a new row on a true collision (a DIFFERENT message — different role,
  or different text — landing on an occupied seq). A same-role/same-text replay
  of an existing message overwrites in place; it must never be appended, or each
  send duplicates the prior turn one row down.
- `confirmOptimisticUser` must NOT move the optimistic user's `openclaw_seq` to
  `baseSeq + gatewaySeq`. That projection overshoots when `baseSeq` was frozen
  before local optimistic appends and collides the confirmed user with its own
  run's assistant/tool rows. Keep the locally allocated seq; retain the gateway
  position only in `gateway_seq` / `__openclaw.gatewaySeq` for matching.
- Segments have a `baseSeq` used for backfill projection, but it is not an
  authoritative reorder source for already-persisted messages.
- Active segment receives new messages; archived segments are read-only.
- Live patch apply (`applyPatches.ts`) must anchor an assistant/tool message to
  at least `runUser.gatewayIndex + 1`. During streaming the live and
  history-backfill seq sources can disagree (the live assistant can carry a
  LOWER raw `messageSeq` than the user that triggered the run), which makes the
  tool card flicker ABOVE the user message then snap back. Clamp it so an
  assistant row in a run never sorts above its own run's user message.
- Send-path history persist (`routes.ts`) must drop stripped prior-turn user
  echoes using the same confirmed-user guard the live/backfill paths use
  (`ChatLiveIngest.isConfirmedUserDuplicate`). Gateway replays every prior user
  turn on each send with a stripped `messageId` (no `runId`/`idempotencyKey`);
  re-persisting them duplicates earlier user turns.

## Message Deduplication (`chatMessageDedupe.ts`)

- Dedup key: `messageId` (primary), text similarity + attachment names (fallback)
- Optimistic messages are replaced by confirmed gateway echoes
- `sendStatus` is cleared when gateway confirmation arrives
- Attachment marker text (`[Attached image: ...]`) is stripped from display text
- Role comparator ensures user/assistant messages don't accidentally merge
- **Single sorter.** Ordering is decided in exactly one place
  (`sortChatMessagesByTimeline`, invoked as the final step of
  `dedupeChatMessages`). `timelineStore.getSortedMessages` must delegate to it,
  not implement a second, divergent tiebreak. Historically the store used a
  `createdAt` tiebreak while dedupe used a role tiebreak, so the same messages
  rendered in different orders depending on the path. Keep one source of truth.

## History Parsing (`chatHistoryParser.ts`)

- Normalizes raw Gateway history messages into `ChatMessage` format
- Extracts attachments from:
  - Top-level `attachments` array
  - Content blocks (type: "image", "input_image", "attachment")
  - Marker text in message body (`[Attached image: ...]`)
- Error messages parsed from `stopReason: "error"` or `Error:` prefix
- Media attachment preambles (instructions for agents) are stripped from user-visible text
- Blank/hidden Gateway user messages are still turn boundaries. Even when a
  user echo has no visible text/content and should not render as a bubble, it
  must prevent the next assistant/tool message from merging into the previous
  assistant card. Otherwise tool calls from a later question can appear above
  or inside older answers.

## Bootstrap Flow

```
Chat opens
  1. Check warm cache (bounded recent messages)
  2. Check global session cache (Jotai atoms)
  3. Fetch /api/chat/bootstrap from middleware
  4. Middleware calls Gateway chat.history (limit: 200)
  5. Normalize messages, project into SQLite
  6. Return bootstrap payload (messages, status, tools, runs)
  7. UI hydrates state, subscribes to patch stream
```

## Streaming

- Gateway streams via events: `session.message`, `session.tool`, `agent.event`
- Middleware projects events into patches → broadcasts via patch bus
- UI applies patches in `applyPatches.ts` → updates Jotai store
- Live assistant text: accumulated delta → merged into single message
- Tool calls: projected as `chat.tool` patches with lifecycle (calling → result)
- Thinking: projected as `chat.thinking` patches (streaming text)

## Warm Cache Rules

- Warm cache = bounded recent window for fast paint on reopen
- NOT the source of truth (middleware projection is)
- Persist timer debounces writes (avoids thrashing during streaming)
- Cache cleared/updated on session switch, send, bootstrap
- `suppressNextWarmPersist` flag prevents double-writes after programmatic updates

## Patch Stream Cursor

- `globalCursor` persisted to localStorage, scoped by middleware URL
- On page reload/tab switch, stream resumes from saved cursor (not 0)
- Key format: `openclaw:patchCursor:<middlewareUrl>`
- Validated with `Number.isSafeInteger` on restore
- If middleware restarts and cursor resets, bootstrap recovery handles the gap
- Warm/global/bootstrap cache cursor must seed the global chat engine BEFORE
  opening `/api/stream/ws`; otherwise refresh can replay old global patches from
  cursor 0 and temporarily overwrite active chat state.
- Replayed `chat.bootstrap` / tool patches are not the source of truth for the
  active chat when a fresher `/api/chat/bootstrap` cursor is already known.
- Replayed metadata-only `chat.bootstrap` patches with zero messages must not
  make the UI treat a session as authoritatively empty. Only real
  `/api/chat/bootstrap` query data or persisted warm/bootstrap cache may use the
  known-empty fast path; patch-stream placeholders are cursor/activity hints.
- When older-history pagination prepends messages locally, update the global
  chat session/cache too. Otherwise later non-message patches can notify
  subscribers with the shorter bootstrap/global snapshot and wipe the older
  messages from the visible chat.

## Tool Card Rendering

- `pendingTools` = live tools for the current run only
- Completed tools (success/error) are removed from `pendingTools` once written to a message's `toolCalls`
- If no message exists yet to attach to, completed tools stay in `pendingTools` until `finalizeActiveToolsForTerminalStatus`
- UI filters `pendingTools` to only show `running` or `awaitingResult` tools, PLUS completed tools not yet in message history
- `mergeToolCallsForDisplay()` deduplicates: skips live tools already completed in base message history
- Never render the same tool card twice (once in message history, once as live pending)
- Tool cards must be scoped to their assistant message / run segment, never to
  the global chat `status` or `isGenerating` flag. A new run entering
  `thinking` / `tool_running` must not make completed tool cards above older
  answers show loading.
- Tool grouping must flush at assistant text and at every user boundary
  (including hidden/blank user boundaries). Do not group tool calls across
  separate questions just because no visible user bubble was rendered.
- Replayed/backfilled `running` tool blocks must not downgrade a visible
  terminal tool (`success`/`error`) with the same `toolCallId`.
- Chat tool-card state must follow Activity tab semantics: once a run/turn is
  no longer live, stale `running` / `awaitingResult` display rows are finalized
  visually instead of showing an old spinner. Activity tab is the reference
  behavior; do not modify Activity to mask ChatView bugs.
- During an active run, if `pendingTools` is empty, older visible assistant tool
  cards must not keep a spinner just because global `isGenerating` is true.
  `isGenerating` describes the current turn, not every historical tool card.
- `middleware_chat_history` / Gateway canonical history can omit inline
  `tool_call` content blocks (`canonicalToolCount: 0`). Reconcile/backfill is a
  recovery path and must never replace a richer live-projected transcript with a
  shorter canonical parse that drops tool cards or intermediate assistant rows.
  If fresh history has fewer parsed messages than the current visible state,
  merge additively and preserve existing `toolCalls`.
- Immediate history backfill after `runStatus: done` is expected. The UI must
  treat it as reconciliation, not as permission to wipe richer live state.

## Focused / New Window Replay Cursor

- Focused/new chat windows run in a fresh JS realm and may not have the main
  window's in-memory chat state.
- When a focused/new window has an active-session warm/bootstrap cursor that is
  lower than the persisted global patch cursor, the patch stream must start from
  the session-safe cursor. Other local session state can reject stale replayed
  patches by its own cursor; otherwise the focused
  window can skip active-session patches that happened before the unrelated
  global cursor advanced.
- Bootstrap remains the canonical source for messages/tools/subagents; lowering
  the replay cursor is only to avoid missing live patch gaps during fresh-window
  reconstruction.

## Scroll Behavior

- `scrollToBottom` uses `requestAnimationFrame` — does NOT fire when the window
  is hidden/backgrounded.
- On `visibilitychange` (visible) or `focus`, force scroll to bottom if the
  session finished or is still generating. This ensures users see the answer
  after switching back from another window.
- `forceScrollToBottom` unconditionally sets `isAtBottomRef = true` and scrolls.
  Used for send, focus-recovery, and initial load.

## Markdown Rendering

- `MarkdownParagraph` must render as `<div>` (not `<p>`) when children contain
  block-level elements (CodeBlock, div, pre, table, etc.).
- Invalid `<p><div>...</div></p>` nesting breaks browser layout calculation
  and corrupts `scrollHeight`, making the chat appear un-scrollable.
