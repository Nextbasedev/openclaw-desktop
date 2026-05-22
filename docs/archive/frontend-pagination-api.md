# Frontend Pagination API Guide

Use these middleware APIs for chat pagination and realtime catch-up.

## 1. Initial chat open / refresh

Call:

```http
GET /api/chat/bootstrap?sessionKey=<SESSION_KEY>&limit=<N>
```

Recommended:

```http
GET /api/chat/bootstrap?sessionKey=<SESSION_KEY>&limit=80
```

Notes:
- `limit` max is `1000`.
- Bootstrap returns the latest `limit` messages, ordered oldest → newest.
- Response includes `cursor`; keep it for realtime patch replay.
- Optional `maxChars=<N>` can limit Gateway history payload size.

Use this for:
- opening a chat
- refresh/reload recovery
- after patch replay says recovery/bootstrap is needed

## 2. Load older/newer stored messages

Current available endpoint:

```http
GET /api/chat/messages?sessionKey=<SESSION_KEY>&afterSeq=<SEQ>&limit=<N>
GET /api/chat/messages?sessionKey=<SESSION_KEY>&beforeSeq=<SEQ>&limit=<N>
```

Examples:

```http
GET /api/chat/messages?sessionKey=<SESSION_KEY>&afterSeq=120&limit=80
GET /api/chat/messages?sessionKey=<SESSION_KEY>&beforeSeq=120&limit=80
```

Response message shape:

```ts
{
  ok: true,
  source: "middleware-projection",
  sessionKey: string,
  messages: Array<{
    sessionKey: string
    openclawSeq: number
    messageId: string | null
    role: string | null
    data: unknown
    updatedAtMs: number
  }>,
  messageCount: number
}
```

Important:
- Use `afterSeq` to load newer messages after a known sequence.
- Use `beforeSeq` to load older messages before the first visible sequence.
- Returned messages are ordered oldest → newest.

Older-page API:

```http
GET /api/chat/messages?sessionKey=<SESSION_KEY>&beforeSeq=<FIRST_VISIBLE_SEQ>&limit=80
```

Expected behavior:
- returns messages with `openclawSeq < beforeSeq`
- ordered oldest → newest
- returns at most `limit`

## 3. Realtime patch replay / cursor pagination

Poll fallback:

```http
GET /api/patches?afterCursor=<CURSOR>&limit=<N>
```

Recommended:

```http
GET /api/patches?afterCursor=<lastSeenCursor>&limit=1000
```

WebSocket:

```http
WS /api/stream/ws?afterCursor=<CURSOR>
```

Patch response includes:

```ts
{
  ok: true,
  patches: Patch[],
  count: number,
  latestCursor: number,
  hasMore: boolean,
  replayWindowExceeded: boolean,
  recovery: "bootstrap" | null
}
```

Rules:
- Apply only patches where `patch.cursor > currentCursor`.
- Update local cursor after each applied patch.
- If `hasMore`, `replayWindowExceeded`, or `recovery === "bootstrap"`, stop trusting patch replay and call `/api/chat/bootstrap` for visible/open sessions.

## Suggested frontend flow

1. Open chat:
   - call `/api/chat/bootstrap?sessionKey=X&limit=80`
   - render returned messages
   - store `cursor`

2. Subscribe/replay realtime:
   - open `WS /api/stream/ws?afterCursor=<cursor>`
   - or poll `/api/patches?afterCursor=<cursor>`

3. User scrolls older:
   - call `/api/chat/messages?sessionKey=X&beforeSeq=<firstVisibleSeq>&limit=80`
   - prepend returned messages to the local list

4. User scrolls newer after a gap:
   - use `/api/chat/messages?afterSeq=<lastVisibleSeq>&limit=80`

## Quick summary for frontend dev

- Initial page: `GET /api/chat/bootstrap?sessionKey=X&limit=80`
- Newer messages by sequence: `GET /api/chat/messages?sessionKey=X&afterSeq=SEQ&limit=80`
- Realtime/catch-up: `WS /api/stream/ws?afterCursor=CURSOR` or `GET /api/patches?afterCursor=CURSOR&limit=1000`
- Older messages: `GET /api/chat/messages?sessionKey=X&beforeSeq=FIRST_VISIBLE_SEQ&limit=80`
