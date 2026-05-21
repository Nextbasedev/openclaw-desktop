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
