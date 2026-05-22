# Middleware Constraints

## Body Limits

| Limit | Value | Constant |
|-------|-------|----------|
| JSON body limit | 25 MB | `MIDDLEWARE_BODY_LIMIT_BYTES` in `app.ts` |
| Embedded text attachment | 120K chars per file | `MAX_EMBEDDED_ATTACHMENT_CHARS` in `attachments.ts` |
| Total embedded text | 300K chars | `MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS` in `attachments.ts` |

- Oversized requests return HTTP 413 with `PAYLOAD_TOO_LARGE` error code
- Image attachments are forwarded as base64 to Gateway (type: "image")
- Text attachments are decoded and embedded in the message body
- Non-readable file types get a placeholder notice

## Chat Send Pipeline

```
POST /api/chat/send
  1. Validate sendBody (Zod)
  2. Create/ensure Gateway session (sessions.create, fail-safe)
  3. Apply exec policy if provided (sessions.patch)
  4. Subscribe to session events (ensureSessionSubscribed)
  5. Prepare message + attachments (prepareMessageAndAttachments)
  6. Create optimistic user message + patches
  7. Queue Gateway send (SessionSendQueue, per-session serialized)
  8. Gateway chat.send → wait for response
  9. Fetch chat.history → normalize → confirm optimistic → project
  10. Broadcast done/error status patches
```

## Send Reconciliation

- Live `session.message` can confirm the optimistic user before the queued
  `chat.send` path finishes loading `chat.history`.
- Post-send history reconciliation must treat that already-confirmed optimistic
  user as the current send boundary, even if the later `chat.history` snapshot
  does not contain an exact text-matching user echo.
- Do not mark current-run assistant/tool history as stale solely because the
  history snapshot lacks a text-matching user. Check the local optimistic
  message id first.
- Gateway `chat.send` returning `done` is not enough to finalize the UI; final
  status still depends on history/live events confirming the user and assistant
  response.

## Patch Bus

- Single broadcast channel for all real-time UI updates
- Events: `chat.message.upsert`, `chat.message.confirmed`, `chat.status`, `chat.tool`, `chat.thinking`, `chat.history`
- UI subscribes via WebSocket at `/api/stream/ws`
- Each event has a monotonic `cursor` for ordering and replay
- Backlog replay via `/api/patches?afterCursor=N`

## Session Management

- Sessions stored in SQLite (`v2_sessions` table)
- Segments track chat history boundaries (`v2_segments` table)
- Messages projected with `openclaw_seq` per session
- Runs track active/completed agent runs with tool calls
- Stale runs/tools finalized on startup

## Timeouts

| Operation | Timeout |
|-----------|---------|
| Chat send (default) | 120s |
| Chat send (Gateway call) | 130s (send timeout + 10s buffer) |
| Clawhub skill fetch | 15s |
| Gateway request (default) | 30s |

## Error Handling

- `HttpError` class for structured API errors (status, code, message, details)
- Fastify error handler maps `FST_ERR_CTP_BODY_TOO_LARGE` → `PAYLOAD_TOO_LARGE`
- Gateway request failures during send are caught and broadcast as error status patches
- History load failures after send are warn-logged and ignored (non-fatal)

## Gateway Session Sync Cache

- `syncGatewaySessions()` has a 5s TTL promise cache
- Concurrent `/api/chats`, `/api/bootstrap` calls share one `sessions.list` response
- Cache is NOT populated when Gateway is disconnected (no-op results bypass cache)
- Error cleanup checks cache identity before clearing (avoids clearing a newer entry)
- `clearSyncGatewaySessionsCache()` exported for test isolation
- Tests must call it in `afterEach` and between sequential bootstrap assertions

## Chat Bootstrap Performance

- `/api/chat/bootstrap` is the critical path for opening/restoring a chat and
  must return projected visible messages quickly.
- Do not synchronously import archived transcript files or resequence thousands
  of messages in the bootstrap response path. Schedule archive import/resequence
  in a guarded background job instead.
- Do not await `sessions.messages.subscribe`/live subscription from bootstrap;
  subscribe in the background so slow Gateway subscription calls cannot block
  visible history.
- Guard background archive projection per session so refresh/tab restore cannot
  start duplicate archive imports for the same chat.
- If a background archive projection changes visible history, emit a session
  patch/recovery signal so an already-open chat refetches instead of staying on
  the first bootstrap snapshot.

## Telegram Import

- Group topics create: project + topic + session + chat entry
- Direct messages create: chat entry only
- `prewarmArchivedHistory()` fires in background (fire-and-forget, 10s timeout) after import
- Re-import of already-imported sessions repairs missing chat entries for old group imports
- Bootstrap response includes `topics` array (space-scoped through active-space projects)

## Startup

- `onClose` hooks must be registered BEFORE `app.listen()` (Fastify constraint)
- Gateway autoconnect starts AFTER `listen` succeeds, with retry/backoff
- Autoconnect cancellation registered via pre-listen `onClose` hook
