# Chat Engine Constraints

## Message Ordering

- Messages are ordered by `openclaw_seq` within segments, NOT by timestamp
- Gateway timestamps can be inconsistent across segments
- Segments have a `baseSeq`; projected seq = `baseSeq + gatewaySeq`
- Active segment receives new messages; archived segments are read-only

## Message Deduplication (`chatMessageDedupe.ts`)

- Dedup key: `messageId` (primary), text similarity + attachment names (fallback)
- Optimistic messages are replaced by confirmed gateway echoes
- `sendStatus` is cleared when gateway confirmation arrives
- Attachment marker text (`[Attached image: ...]`) is stripped from display text
- Role comparator ensures user/assistant messages don't accidentally merge

## History Parsing (`chatHistoryParser.ts`)

- Normalizes raw Gateway history messages into `ChatMessage` format
- Extracts attachments from:
  - Top-level `attachments` array
  - Content blocks (type: "image", "input_image", "attachment")
  - Marker text in message body (`[Attached image: ...]`)
- Error messages parsed from `stopReason: "error"` or `Error:` prefix
- Media attachment preambles (instructions for agents) are stripped from user-visible text

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

## Tool Card Rendering

- `pendingTools` = live tools for the current run only
- Completed tools (success/error) are removed from `pendingTools` once written to a message's `toolCalls`
- If no message exists yet to attach to, completed tools stay in `pendingTools` until `finalizeActiveToolsForTerminalStatus`
- UI filters `pendingTools` to only show `running` or `awaitingResult` tools, PLUS completed tools not yet in message history
- `mergeToolCallsForDisplay()` deduplicates: skips live tools already completed in base message history
- Never render the same tool card twice (once in message history, once as live pending)
