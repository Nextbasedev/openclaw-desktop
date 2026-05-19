# OpenClaw Desktop Chat Architecture Plan

Date: 2026-05-19
Scope: Desktop chat history, tab switching, idle reset, subagents, media/files, and lazy history loading.

## Goal

Make Desktop chat feel instant and reliable:

- Fast chat/tab switching when the app is already open.
- Fast first paint after app restart.
- No stale backend/history response should hide newer messages, tool cards, thinking state, or subagent output.
- Long history should load lazily on scroll.
- Idle reset / `/new` / daily reset should not make older chat history appear lost.
- Subagents and media/files must remain correctly linked and isolated.

## Current / Old Architecture

Current flow is roughly:

```text
Gateway chat.history
  -> Middleware bootstrap/projection
  -> UI bootstrap + global patch stream + warm cache
```

Important current pieces:

- Gateway stores session transcript in JSONL `sessionFile`.
- `sessions/sessions.json` stores metadata/index for the latest active session entry.
- Desktop Middleware calls Gateway `chat.history { sessionKey, limit: 200 }` during bootstrap/recovery.
- Middleware normalizes that into its projection store.
- UI reads:
  - `/api/chat/bootstrap?sessionKey=...`
  - `/api/chat/messages?sessionKey=...&beforeSeq=...&limit=...`
  - `/api/patches?afterCursor=...`
  - `/api/stream/ws`
- UI has an in-memory global chat store keyed by `sessionKey`.
- Warm cache/local state is used to make initial rendering faster.

## Current Known Issues

### 1. Stale reconcile can overwrite live UI

Observed bug:

- Live patch stream had latest user message + running tools + correct active state.
- A later recovery call returned fewer messages and `idle` state.
- Frontend trusted stale history and overwrote active UI.

Symptoms:

- Latest user message disappears.
- Tool cards disappear.
- Chat shows only Thinking/running.
- Refresh can look like history was lost.

Short-term fix already pushed:

- Preserve active chat state when stale reconcile has fewer messages or would downgrade active run/tool state.

Long-term rule:

```text
Older history/reconcile must never overwrite newer in-memory/live cursor state.
```

### 2. Multiple sources of truth fight each other

Current Desktop has:

- Gateway transcript/history.
- Middleware projection.
- UI memory store.
- Warm cache/localStorage.
- Legacy compatibility APIs.

The bug class appears when these are treated as equal truth sources.

Correct hierarchy should be:

```text
Gateway transcript/session files = canonical storage
Middleware projection = UI read model/cache
UI memory store = current live view
Warm cache = preview only
```

### 3. Idle reset / daily reset creates new session files

OpenClaw reset behavior:

- Same logical `sessionKey` can remain.
- Gateway creates a new `sessionId` and new `sessionFile`.
- Old transcript file is archived, e.g. `.reset.<timestamp>`.
- `sessions.json` points to the latest current session entry.
- Normal `chat.history(sessionKey)` returns current session history, not a continuous history across all old archived files.

Risk:

- Desktop may think old history disappeared.
- New empty/current `chat.history` could wipe visible old projection unless handled carefully.

### 4. `sessions.json` is not full history

`sessions.json` is an index/metadata file. It points to the latest session entry and current `sessionFile`.

It should not be treated as the transcript itself.

### 5. History pagination is only middleware-projection based today

Code check found:

- Shared `chat.history` schema only has `{ sessionKey }`.
- Server `chatHistory(input: { sessionKey })` calls `getChatHistory(gwKey)`.
- No clean Gateway cursor-history API was visible.
- Middleware has `/api/chat/messages` with `beforeSeq`, `afterSeq`, `limit`, but it reads from middleware projection.

So current practical pagination source is Middleware projection, not Gateway cursor API.

### 6. Subagent isolation can break if parent and child share stream state incorrectly

Recent fix:

- Parent chat uses global patch stream/session store.
- Subagent view now subscribes to the child `sessionKey` live state.
- Parent should only show spawn/status/result summary.
- Child should own its full internal messages/tools.

Risk remains if future architecture mixes parent and child transcript rows without explicit relation metadata.

### 7. Media/files need first-class history support

Telegram/media contexts can include:

- `MediaPath`
- `MediaPaths`
- `MediaType`
- `MediaTypes`
- images/audio/stickers
- attached files like `.md`, `.txt`, JSON, etc.

If history pagination returns only text messages, old images/files will appear missing.

## Better New Architecture

### Core idea

Desktop should not permanently duplicate everything blindly, and it should not rely only on latest `chat.history` either.

Better model:

```text
Desktop chat timeline = index over Gateway transcript/session files + live middleware projection/cache
```

Not:

```text
Desktop DB becomes a second permanent full source of truth
```

## New Data Model

### 1. Chat timeline

One Desktop chat is a stable timeline.

```ts
chats:
  chatId
  title
  spaceId
  projectId?
  topicId?
  activeSessionKey
  createdAt
  updatedAt
```

### 2. Session segments

One chat can have multiple Gateway session segments over time.

```ts
chat_session_segments:
  segmentId
  chatId
  sessionKey
  sessionId
  sessionFile
  archivedSessionFile?
  segmentIndex
  startedAt
  endedAt?
  resetReason? // idle | daily | manual | new | unknown
  isActive
```

Meaning:

- Same Desktop chat can survive idle reset.
- Old messages stay in old segment.
- New messages go to new active segment.
- UI can show a reset boundary between segments.

### 3. Messages

Projection rows should include segment identity.

```ts
messages:
  messageId
  chatId
  segmentId
  sessionKey
  sessionId
  openclawSeq
  role
  content
  text
  createdAt
  updatedAt
```

Important invariants:

- Message count should not shrink unless there is an explicit delete/truncate event.
- Older bootstrap/history cannot remove newer live messages.
- Dedupe by stable `messageId` / `sessionId + seq`.

### 4. Attachments / media / files

Do not store large blobs directly in message rows.

```ts
attachments:
  attachmentId
  messageId
  chatId
  segmentId
  sessionId
  name
  mimeType
  size
  source // gateway-transcript | local-upload | media-path | generated | tool-output
  contentRef // path/url/blob id
  previewText?
  thumbnailRef?
  createdAt
```

Rules:

- Images: metadata + content ref + optional thumbnail.
- `.md`, `.txt`, JSON: preview text if small, ref if large.
- Audio/video: metadata + media ref.
- Tool outputs: preview + full ref if large.
- Attachment-only messages must still render as messages.
- Pagination must return attachments together with messages.

### 5. Subagents

Subagents are separate timelines, linked to parent.

Parent chat stores only:

- spawn tool call
- child `sessionKey`
- child `sessionId`
- status
- final summary/link

Child chat/timeline stores:

- child messages
- child tools
- child attachments
- child session segments if reset happens

```ts
subagent_links:
  linkId
  parentChatId
  parentSegmentId
  parentSessionId
  parentMessageId?
  parentToolCallId?
  childChatId
  childSessionKey
  childSessionId?
  status // spawning | working | completed | failed
  createdAt
  updatedAt
```

Rule:

```text
Parent never owns child internal transcript. Parent only links to it.
```

## Runtime Flow

### App already open: tab switching

Use memory first:

```text
globalSessionStore[sessionKey] -> instant render
```

No skeleton if that chat/session was already opened.

Backend can validate/continue in the background, but cannot overwrite newer cursor state.

### Fresh app startup

```text
1. Show warm recent cache as preview.
2. Load active chat timeline metadata.
3. Load last page of current active segment.
4. Connect/replay live patches from latest cursor.
5. Backfill older segment pages only when user scrolls up.
```

### Scroll-up history

Use seq/cursor pagination, not offset pagination.

```text
GET /api/chat/messages?chatId=...&beforeSeq=...&limit=50
```

or, if segment-specific:

```text
GET /api/chat/messages?segmentId=...&beforeSeq=...&limit=50
```

Response should include:

- messages
- attachments
- tool metadata
- segment boundary markers
- `hasMoreBefore`

### Idle reset / `/new` / daily reset

When Gateway returns a new `sessionId` for same logical chat/sessionKey:

```text
1. Close previous active segment.
2. Create new segment.
3. Insert reset boundary marker.
4. Continue live messages in new segment.
5. Do not wipe old messages.
```

Suggested semantics:

- Manual New Chat button = new Desktop `chatId`.
- Gateway idle/daily reset inside same external/channel conversation = same `chatId`, new segment.
- `/new` inside an existing chat = likely same `chatId`, new segment, visible boundary.

## Transcript File Strategy

Telegram/Gateway normal model is not “copy everything forever into one chat.”

Actual behavior:

- Stable route/sessionKey maps to current `sessionFile`.
- Reset archives the old session file.
- `sessions.json` points to latest current file.

Desktop should mirror that style:

- Use `sessions.json` as an index to discover current session metadata.
- Use current `sessionFile` as source for active segment rebuild.
- Discover archived transcript files when needed for older segments.
- Store lightweight segment index + UI projection/cache, not uncontrolled full duplicate storage.

## Potential Issues With New Architecture

### 1. Archived transcript discovery may be incomplete

If old reset files are renamed or moved, Desktop may not discover every previous segment automatically.

Mitigation:

- Store segment file path when Desktop first sees it.
- On reset detection, persist old active `sessionFile` before it disappears from `sessions.json`.
- Add best-effort scan for `.reset.<timestamp>` files near known session file path.

### 2. Reading transcript files directly can be risky

Risks:

- Partial writes while Gateway is writing.
- JSONL format changes.
- Very large files.
- Missing permission/path access.

Mitigation:

- Prefer Gateway APIs when available.
- For file reads, use append-only JSONL tolerant parser.
- Ignore malformed trailing line.
- Page reads / cache parsed result by file mtime + size.
- Never block UI on full-file parse.

### 3. Segment + message ordering can get tricky

Different segments may have overlapping local `seq` numbers.

Mitigation:

- Use `segmentIndex + openclawSeq` for display order.
- Use stable identity: `sessionId + openclawSeq` or transcript event id.

### 4. Media paths can become stale

Media files referenced by transcript may be moved/deleted.

Mitigation:

- Store metadata even if content is unavailable.
- UI shows “file unavailable” instead of breaking message render.
- For local uploads, optionally copy only small/important previews or thumbnails.

### 5. Subagent lifecycle can be mis-linked

Child session might appear before parent spawn tool result is fully parsed.

Mitigation:

- Link by child session activity + tool result/session key extraction.
- Keep parent/child transcript stores separate.
- Add tests for parent isolation and child live subscription.

### 6. Projection cleanup must not delete useful history

If middleware projection is just a cache, cleanup is okay. But if it contains only copy of old segment messages, cleanup could look like data loss.

Mitigation:

- Treat transcript files as source.
- Projection rows should be rebuildable from segment files.
- Cleanup only derived rows, not segment index/source references.

### 7. Old UI assumptions may break

Existing UI may assume one `sessionKey` = one continuous message list.

Mitigation:

- Add segment handling below UI first.
- UI receives one flattened timeline with boundary markers.
- Keep ChatView virtualization unchanged initially.

## Suggested Implementation Phases

### Phase 1: Safe hardening

- Add `sessionId` awareness to middleware projection snapshots.
- Detect `sessionId` change for same chat/sessionKey.
- Preserve old projection state; do not wipe on new empty history.
- Add boundary marker support internally.
- Keep UI mostly unchanged.

### Phase 2: Segment index

- Add `chat_session_segments` model.
- Persist active `sessionFile` per segment.
- On reset/new session, close old segment and open new one.
- Read latest segment for bootstrap.
- Tests for idle reset and `/new` behavior.

### Phase 3: Lazy history across segments

- `/api/chat/messages` can page across segment boundary.
- Include attachments and tool metadata.
- Preserve scroll position on prepend.

### Phase 4: Subagent + media hardening

- Add explicit `subagent_links` storage/projection.
- Ensure child timelines can have their own segments.
- Add attachments table/projection.
- Tests for image, `.md`, `.txt`, audio, child subagent media.

### Phase 5: Cleanup/caching policy

- Projection cache size caps.
- Thumbnail/preview cache cleanup.
- Rebuild projection from transcript files if missing.

## Recommended Direction

Do not make Desktop a second permanent full transcript database.

Recommended architecture:

```text
Gateway transcript files = durable source
Desktop segment index = map one chat to many session files
Middleware projection = fast UI cache/read model
UI memory store = live current view
Warm cache = preview only
```

This gives us:

- fast tab switching
- reliable refresh
- lazy history
- reset-safe history
- subagent isolation
- media/file support
- less storage duplication
