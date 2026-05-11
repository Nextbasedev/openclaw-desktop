# Middleware V2 Frontend Integration Guide

This guide documents the current `apps/middleware-v2` HTTP/WebSocket surface for frontend engineers. It is based on the source in `apps/middleware-v2/src` and the v2 frontend client in `packages/ui/lib/chat-engine-v2`.

Middleware v2 is not the legacy desktop middleware on port `8787`. Its default base URL is:

```text
http://127.0.0.1:8989
```

Frontend code should treat this URL as the canonical app backend for middleware-v2 chat projection and patch streaming. Do not mix v2 chat state with legacy `/api/stream/chat/:sessionKey` or legacy `8787` session status heuristics unless a feature is explicitly still missing from v2.

## 1. Current scope and caveats

Middleware v2 currently implements:

- System and diagnostics endpoints.
- Gateway connection status/reconnect endpoints.
- Chat send, abort, bootstrap, projected message reads, approval resolve.
- A global patch replay endpoint.
- A global WebSocket patch stream.

Middleware v2 currently does **not** implement first-class endpoints for these legacy/backend features:

- Terminal spawn/write/resize/kill/stream.
- Workspace/project/file tree/read/write/search.
- Git status/diff/branch/commit.
- Activity feed, agents tree, processes list.
- Models, settings, pins, projects, topics, sessions list, memory, usage, skills.

For those missing features, the current repo still has legacy/shared API contracts under `packages/shared/src/api/*` and legacy frontend helpers that talk to port `8787` or remote middleware (`packages/ui/lib/middleware-client.ts`, `packages/ui/lib/ipc.ts`, `packages/ui/components/inspector/workspace-api.ts`). Treat these as caveats, not v2 contracts. If the goal is “v2 only”, these endpoints must be added to `apps/middleware-v2/src` before frontend code can use them on port `8989`.

## 2. Auth and configuration assumptions

Middleware v2 uses CORS with `origin: true` and `credentials: false`. The current v2 HTTP client does not send an Authorization header.

Server environment:

- `MIDDLEWARE_V2_HOST` or `HOST`: defaults to `127.0.0.1`.
- `MIDDLEWARE_V2_PORT` or `PORT`: defaults to `8989`.
- `MIDDLEWARE_V2_DB`: defaults to `~/.openclaw/middleware-v2/state.sqlite`.
- `OPENCLAW_GATEWAY_URL`: defaults to `ws://127.0.0.1:18789`.
- `OPENCLAW_GATEWAY_TOKEN`: optional token used by the v2 server when connecting to Gateway.

Frontend configuration from `packages/ui/lib/chat-engine-v2/client.ts`:

- Default v2 URL: `http://127.0.0.1:8989`.
- Environment override: `NEXT_PUBLIC_MIDDLEWARE_V2_URL`.
- Browser localStorage override: `openclaw.middleware.v2.url`.
- If the browser is loaded from a non-loopback host and the v2 URL is loopback, the client rewrites the host to the browser hostname and preserves port `8989`.

Legacy middleware uses separate keys:

- `openclaw.middleware.url`.
- `openclaw.middleware.token`.

Do not use those legacy keys for v2 chat projection unless intentionally bridging an unsupported v2 feature.

## 3. System and bootstrap endpoints

### Health

```bash
curl -s http://127.0.0.1:8989/health | jq
```

Example response:

```json
{
  "ok": true,
  "service": "openclaw-middleware-v2",
  "version": "0.1.0",
  "host": "127.0.0.1",
  "port": 8989,
  "uptimeMs": 12345,
  "gateway": {
    "connected": true,
    "gatewayUrl": "ws://127.0.0.1:18789",
    "connectedAtMs": 1760000000000,
    "lastError": null,
    "pendingRequests": 0,
    "listenerCount": 1
  }
}
```

Use this for readiness and to confirm that the frontend is pointed at v2, not legacy `8787`.

### System info

```bash
curl -s http://127.0.0.1:8989/api/system/info | jq
```

Example response:

```json
{
  "ok": true,
  "service": "openclaw-middleware-v2",
  "version": "0.1.0",
  "host": "127.0.0.1",
  "port": 8989,
  "databasePath": "/home/user/.openclaw/middleware-v2/state.sqlite",
  "gatewayUrl": "ws://127.0.0.1:18789",
  "uptimeMs": 12345
}
```

### Gateway status and reconnect

```bash
curl -s http://127.0.0.1:8989/api/gateway/status | jq
curl -s -X POST http://127.0.0.1:8989/api/gateway/reconnect | jq
```

Use `/api/gateway/status` to distinguish frontend bugs from Gateway connectivity problems. Use reconnect for manual recovery UI/actions.

### Diagnostics

```bash
curl -s http://127.0.0.1:8989/api/diagnostics | jq
curl -s http://127.0.0.1:8989/api/diagnostics/patch-clients | jq
```

Diagnostics include Gateway state, projection database counts, live-ingest subscriptions, and connected patch clients.

## 4. Chat integration

Middleware v2 chat is projection-based:

1. Bootstrap a session snapshot from `/api/chat/bootstrap`.
2. Maintain one global WebSocket to `/api/stream/ws`.
3. Apply patch frames by monotonically increasing `cursor`.
4. Recover from replay overflow with a fresh bootstrap.

### 4.1 Bootstrap snapshot endpoint

```bash
curl -s 'http://127.0.0.1:8989/api/chat/bootstrap?sessionKey=s1&limit=200' | jq
```

Query parameters:

- `sessionKey` is required.
- `limit` is optional, positive integer, max `1000`.
- `maxChars` is optional and is forwarded to Gateway `chat.history`.

Example response:

```json
{
  "ok": true,
  "source": "middleware-v2-projection",
  "projectionVersion": 3,
  "sessionKey": "s1",
  "sessionId": "session-1",
  "runStatus": "done",
  "statusLabel": null,
  "activeRun": null,
  "messages": [
    {
      "role": "user",
      "text": "hello",
      "__openclaw": { "id": "client-1700000000", "seq": 1 }
    },
    {
      "role": "assistant",
      "text": "Hi!",
      "__openclaw": { "id": "assistant-1", "seq": 2 }
    }
  ],
  "messageCount": 2,
  "tools": [],
  "toolCalls": [],
  "cursor": 42,
  "sessionStatus": "done",
  "thinkingLevel": "medium",
  "fastMode": false,
  "verboseLevel": "normal",
  "projection": {
    "enabled": true,
    "version": 3,
    "upserted": 2,
    "lastSeq": 2,
    "cursor": 42,
    "liveSubscribed": true
  }
}
```

Canonical fields to use:

- `projectionVersion`: currently `3`; use it for compatibility guards.
- `cursor`: latest projection cursor included in the snapshot.
- `runStatus`: canonical run state: `idle`, `queued`, `thinking`, `streaming`, `tool_running`, `done`, `error`, `aborted`.
- `statusLabel`: user-facing short label for active work, usually `Thinking`, `Streaming`, a tool name, or an error message.
- `activeRun`: present only for active statuses (`queued`, `thinking`, `streaming`, `tool_running`).
- `messages`: canonical message array for rendering.
- `tools` / `toolCalls`: same projected tool-call list; both are returned for compatibility.
- `sessionStatus`: legacy-compatible field derived from Gateway/session data. Prefer `runStatus` for control flow.
- `thinkingLevel`, `fastMode`, `verboseLevel`: legacy session metadata from Gateway history.

Bootstrap side effects:

- Calls Gateway `chat.history`.
- Persists normalized history into the v2 projection database.
- Ensures live session subscription through Gateway `sessions.messages.subscribe`.
- Emits a `chat.bootstrap` projection event to advance cursor.

### 4.2 Read projected messages directly

```bash
curl -s 'http://127.0.0.1:8989/api/chat/messages?sessionKey=s1&afterSeq=0&limit=100' | jq
```

Example response:

```json
{
  "ok": true,
  "source": "middleware-v2-projection",
  "sessionKey": "s1",
  "messages": [
    {
      "sessionKey": "s1",
      "openclawSeq": 1,
      "messageId": "client-1",
      "role": "user",
      "data": { "role": "user", "text": "hello", "__openclaw": { "id": "client-1" } },
      "updatedAtMs": 1760000000000
    }
  ],
  "messageCount": 1
}
```

This endpoint reads only the v2 projection store. It does not fetch Gateway history or subscribe to live events. Prefer bootstrap for first load.

### 4.3 Send message endpoint

```bash
curl -s -X POST http://127.0.0.1:8989/api/chat/send \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionKey": "s1",
    "text": "Write a short haiku",
    "idempotencyKey": "send-1700000000",
    "clientMessageId": "client-1700000000",
    "timeoutMs": 120000,
    "agentId": "main",
    "label": "New Chat"
  }' | jq
```

Body fields:

- `sessionKey`: required.
- `text` or `message`: required; `text` wins when both are present.
- `idempotencyKey`: required. The v2 run id is `run:${idempotencyKey}`.
- `clientMessageId`: optional but strongly recommended. If omitted, v2 uses `client:${idempotencyKey}`.
- `attachments`: optional; prepared by `features/chat/attachments.ts` before forwarding to Gateway.
- `timeoutMs`: optional. Gateway call defaults to `120000`, request timeout defaults to `130000`.
- `agentId`: optional; defaults to `main` when creating the Gateway session.
- `label`: optional; defaults to `New Chat` when creating the Gateway session.
- `execPolicy`: optional. If provided, v2 patches Gateway session exec settings before send. `null` clears policy.

Example successful response:

```json
{
  "ok": true,
  "sessionKey": "s1",
  "idempotencyKey": "send-1700000000",
  "runId": "gateway-run-1",
  "status": "accepted"
}
```

The returned body includes Gateway result fields, but frontend state should be driven by the bootstrap/patch projection, not by this response alone.

### 4.4 Abort an active run

```bash
curl -s -X POST http://127.0.0.1:8989/api/chat/abort \
  -H 'Content-Type: application/json' \
  -d '{"sessionKey":"s1","runId":"run:send-1700000000"}' | jq
```

`runId` is optional. If omitted, v2 aborts the latest active run for the session. The route forwards to Gateway `chat.abort` and updates projected run/session state to `aborted` when it can identify the run.

### 4.5 Resolve exec approval

```bash
curl -s -X POST http://127.0.0.1:8989/api/exec/approval/resolve \
  -H 'Content-Type: application/json' \
  -d '{"approvalId":"approval-1","decision":"allow-once"}' | jq
```

Accepted decisions:

- `allow-once`
- `allow-always`
- `deny`

`approvalId` may also be sent as `id`. The route forwards to Gateway `exec.approval.resolve`.

### 4.6 Patch replay endpoint

```bash
curl -s 'http://127.0.0.1:8989/api/patches?afterCursor=42&limit=1000' | jq
```

Example response:

```json
{
  "ok": true,
  "patches": [
    {
      "cursor": 43,
      "type": "chat.message.upsert",
      "sessionKey": "s1",
      "payload": {
        "projectionVersion": 3,
        "semanticType": "chat.assistant.final",
        "sessionKey": "s1",
        "runId": "run:send-1700000000",
        "runStatus": "done",
        "status": "done",
        "statusLabel": null,
        "activeRun": null,
        "messageId": "assistant-1",
        "message": { "role": "assistant", "text": "..." },
        "messageSeq": 2,
        "lastSeq": 2
      },
      "createdAtMs": 1760000000000
    }
  ],
  "count": 1,
  "latestCursor": 43,
  "hasMore": false,
  "replayWindowExceeded": false,
  "recovery": null
}
```

Rules:

- `cursor` is global and monotonically increasing across sessions.
- `afterCursor` returns patches where `cursor > afterCursor`.
- `limit` is clamped to `1..5000`; default `1000`.
- If `hasMore` / `replayWindowExceeded` is true, recover with bootstrap snapshots rather than trying to continue from partial replay.

### 4.7 Global WebSocket patch stream

Open one global socket, not one socket per chat:

```text
ws://127.0.0.1:8989/api/stream/ws?afterCursor=42
```

Browser example:

```ts
const url = new URL('http://127.0.0.1:8989/api/stream/ws')
url.searchParams.set('afterCursor', String(globalCursor))
const ws = new WebSocket(url.toString().replace(/^http/, 'ws'))

ws.onmessage = (event) => {
  const frame = JSON.parse(event.data)
  if (frame.type === 'hello') {
    if (frame.replayWindowExceeded || frame.recovery === 'bootstrap') {
      // Re-bootstrap visible/open sessions and reset their cursors from snapshots.
      return
    }
    return
  }

  if (frame.type === 'patch') {
    applyPatch(frame.patch)
  }
}
```

Hello frame example:

```json
{
  "type": "hello",
  "clientId": "0e044b7a-8bd9-4d0f-9e63-e91e5b7de8fd",
  "afterCursor": 42,
  "replayCount": 3,
  "replayHasMore": false,
  "replayWindowExceeded": false,
  "recovery": null
}
```

Patch frame example:

```json
{
  "type": "patch",
  "patch": {
    "cursor": 44,
    "type": "chat.status",
    "sessionKey": "s1",
    "payload": {
      "projectionVersion": 3,
      "semanticType": "chat.run.status",
      "sessionKey": "s1",
      "runId": "run:send-1700000000",
      "clientMessageId": "client-1700000000",
      "idempotencyKey": "send-1700000000",
      "runStatus": "thinking",
      "status": "thinking",
      "statusLabel": "Thinking",
      "activeRun": {
        "runId": "run:send-1700000000",
        "gatewayRunId": null,
        "clientMessageId": "client-1700000000",
        "idempotencyKey": "send-1700000000",
        "status": "thinking",
        "statusLabel": "Thinking",
        "startedAtMs": 1760000000000,
        "updatedAtMs": 1760000000000
      },
      "optimistic": true
    },
    "createdAtMs": 1760000000000
  }
}
```

The server sends the hello frame first, then up to 1000 replay patches from `afterCursor`, then live patches.

### 4.8 Message identity and order rules

Use backend identity and sequence. Do not invent a frontend-only ordering model.

Canonical identity fields:

- For v2 optimistic user sends, use `clientMessageId` as the canonical message id.
- The optimistic user message has `__openclaw.id = clientMessageId` and `__clientOptimistic = true`.
- On Gateway confirmation, v2 preserves the client id as canonical and records Gateway identity under `__openclaw.gatewayId` and `__openclaw.gatewaySeq`.
- Gateway-origin messages may use `__openclaw.id`, `id`, or `messageId` as `messageId` in projection storage.

Ordering fields:

- `openclawSeq` is the v2 projection order for `/api/chat/messages` rows.
- Gateway messages with `__openclaw.seq` or live `messageSeq` keep that sequence.
- Messages without Gateway seq get a stable fallback sequence assigned by v2.
- Patch payloads may include `messageSeq` and `lastSeq`.

Frontend rendering rules:

- Key messages by canonical message id when present.
- Sort/render by backend sequence (`__openclaw.seq`, `messageSeq`, or projected `openclawSeq`) rather than arrival time.
- Deduplicate confirmed user echoes by `optimisticId`/`gatewayMessageId` patches.
- Do not replace `clientMessageId` with `gatewayMessageId`; the v2 contract intentionally preserves the client id.

### 4.9 Optimistic send lifecycle

When `/api/chat/send` is called, v2 does this before forwarding to Gateway:

1. Creates/patches the Gateway session if needed.
2. Ensures live subscription for the session.
3. Creates a local run `run:${idempotencyKey}` with status `thinking`.
4. Inserts an optimistic user message with `clientMessageId`.
5. Broadcasts `chat.message.upsert` with `semanticType: chat.user.created` and `optimistic: true`.
6. Broadcasts `chat.status` with `semanticType: chat.run.status` and `runStatus: thinking`.
7. Calls Gateway `chat.send`.
8. Loads Gateway history and confirms the user echo if it matches.
9. Broadcasts `chat.message.confirmed` with `semanticType: chat.user.confirmed` if confirmed.
10. Broadcasts assistant/history upserts and terminal `chat.status` patches as they arrive.

Frontend behavior:

- You may show the user message immediately after local submit, but reconcile it with the v2 optimistic patch.
- Prefer waiting for the `chat.user.created` patch to enter the canonical store when possible.
- Confirmation is `chat.message.confirmed` / `semanticType: chat.user.confirmed` and contains `optimisticId` and `gatewayMessageId`.
- Never infer run completion from assistant text. Use `runStatus`, `activeRun`, and `chat.status` patches.

### 4.10 Run and tool status lifecycle

Run statuses from `apps/middleware-v2/src/features/chat/repo.runs.ts`:

- `queued`
- `thinking`
- `streaming`
- `tool_running`
- `done`
- `error`
- `aborted`

Bootstrap can also return `idle` when there is no known run.

Active statuses:

- `queued`
- `thinking`
- `streaming`
- `tool_running`

Terminal statuses:

- `done`
- `error`
- `aborted`
- `idle`

Tool-call projection fields:

```json
{
  "toolCallId": "tool-1",
  "id": "tool-1",
  "sessionKey": "s1",
  "runId": "run:send-1700000000",
  "messageId": "assistant-1",
  "name": "exec",
  "phase": "start",
  "status": "running",
  "argsMeta": { "keys": ["command"] },
  "resultMeta": null,
  "startedAtMs": 1760000000000,
  "finishedAtMs": null,
  "updatedAtMs": 1760000000000
}
```

Tool phases:

- `start`
- `calling`
- `result`
- `error`

Tool statuses:

- `running`
- `success`
- `error`

Patch event types emitted by current code:

- `chat.message.upsert`
- `chat.message.confirmed`
- `chat.status`
- `chat.tool.started`
- `chat.tool.result`
- `chat.tool.error`
- `chat.bootstrap`
- `session.upsert`

Patch payload `semanticType` is more specific and should be preferred for rendering semantics when present:

- `chat.user.created`
- `chat.user.confirmed`
- `chat.assistant.final`
- `chat.message.upsert`
- `chat.run.status`
- `chat.run.done`
- `chat.run.error`
- `chat.tool.started`
- `chat.tool.result`
- `chat.tool.error`

## 5. Terminal integration

Current v2 status: **not implemented on port 8989**.

The shared legacy contract defines terminal endpoints in `packages/shared/src/api/terminal.ts`, but `apps/middleware-v2/src/app.ts` does not register terminal routes.

Legacy/shared endpoint shapes that still need v2 implementation:

```bash
# Create terminal - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/terminal \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-1","topicId":"topic-1","cwd":"/repo","title":"Shell"}'

# Write - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/terminal/terminal-1/write \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"terminal-1","data":"ls\n"}'

# Resize - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/terminal/terminal-1/resize \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"terminal-1","cols":120,"rows":32}'

# Close - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/terminal/terminal-1/close \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"terminal-1"}'

# List - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/terminal?projectId=project-1'
```

Legacy stream helpers in `packages/ui/lib/ipc.ts` map `/api/stream/pty/:id` to `/api/terminal/:id/stream` on legacy middleware. There is no equivalent v2 stream route today.

Frontend recommendation:

- Do not call terminal endpoints on `8989` until routes exist in `apps/middleware-v2/src`.
- If product requirements need terminal in v2, add and document a v2 terminal feature module first.
- If temporarily using legacy terminal, isolate it behind a legacy adapter and label it clearly; do not merge terminal events into the v2 chat patch stream unless v2 emits them.

## 6. Workspace, projects, and files integration

Current v2 status: **not implemented on port 8989**.

The repo contains legacy/shared contracts:

- Projects: `packages/shared/src/api/projects.ts`
- Files: `packages/shared/src/api/files.ts`
- Workspace frontend helper: `packages/ui/components/inspector/workspace-api.ts`

But `apps/middleware-v2/src` currently registers only system, gateway, diagnostics, chat, and patches.

Shared file endpoint shapes that still need v2 implementation:

```bash
# File tree - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/files/tree?projectId=project-1&path=/'

# Read file - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/files/read?projectId=project-1&path=README.md'

# Write file - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/files/write \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-1","path":"README.md","content":"hello"}'

# Search - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/files/search?projectId=project-1&query=middleware'
```

The current inspector workspace helper uses legacy-style paths:

- `/api/projects/:projectId/workspace/tree`
- `/api/projects/:projectId/workspace/file`
- `/api/workspace/tree`
- `/api/workspace/file`

Those paths are also not present in middleware v2 today.

Frontend recommendation:

- Treat workspace/project/file UI as blocked for pure v2 until v2 routes are added.
- Do not silently fall back to `8787` from a v2-only screen without an explicit compatibility layer and UI/telemetry label.

## 7. Git integration

Current v2 status: **not implemented on port 8989**.

The shared legacy contract defines Git endpoints in `packages/shared/src/api/git.ts`, and the current UI has legacy Git helpers/components under `packages/ui/components/inspector` and `packages/ui/lib/ipc.ts`.

Shared Git endpoint shapes that still need v2 implementation:

```bash
# Status - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/git/status?projectId=project-1'

# Diff - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/git/diff?projectId=project-1&refA=HEAD'

# Branches - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/git/branches?projectId=project-1'

# Switch branch - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/git/switch-branch \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-1","branchName":"feature/x","create":false}'

# Commit - not currently available on 8989
curl -s -X POST http://127.0.0.1:8989/api/git/commit \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-1","message":"Update docs"}'
```

Frontend recommendation:

- Keep Git state out of v2 chat/run status.
- Add a dedicated v2 Git feature module before using `8989` for Git.
- While using legacy Git, keep the adapter separate from v2 chat stores.

## 8. Subagents and activity integration

There is no dedicated v2 activity endpoint today. Subagent and tool activity appears through chat messages, tool-call projections, and patch payloads.

How to render from v2 chat:

- Tool calls are projected into `tools` / `toolCalls` on bootstrap.
- Live tool changes arrive as `chat.tool.started`, `chat.tool.result`, and `chat.tool.error` patches.
- Tool call patches include `toolCall`, `toolCallId`, `runId`, `runStatus`, `statusLabel`, and `activeRun`.
- Subagent spawning is currently inferred in UI code from tool calls/messages (`sessions_spawn`) rather than from a v2 `/api/activity/*` endpoint.

Rendering notes:

- Render pending/running tools from `toolCalls` and live tool patches.
- Use `runStatus: tool_running` and `statusLabel` for the main “thinking/using tool” affordance.
- Keep subagent cards keyed by tool call id until a child session key is discovered from the tool result/message content.
- Do not infer agent completion from assistant prose. Use terminal run statuses and tool statuses.

Shared legacy activity endpoint shapes that still need v2 implementation:

```bash
# Activity feed - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/activity/feed?projectId=project-1'

# Agents tree - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/agents/tree?projectId=project-1'

# Processes - not currently available on 8989
curl -s 'http://127.0.0.1:8989/api/processes?projectId=project-1'
```

## 9. Models, settings, pins, and other useful endpoints

Current v2 status: **not implemented on port 8989**.

The only currently useful non-chat v2 endpoints are:

- `/health`
- `/api/system/info`
- `/api/gateway/status`
- `/api/gateway/reconnect`
- `/api/diagnostics`
- `/api/diagnostics/patch-clients`

Settings/model/pin related shared contracts exist elsewhere but are not registered in middleware v2:

- Settings: `packages/shared/src/api/settings.ts`
- Projects and project pin: `packages/shared/src/api/projects.ts`
- Usage/models are implemented in legacy server services such as `packages/server/src/services/models.service.ts`, not v2 routes.

Frontend recommendation:

- For v2 chat screens, read model/settings information only if v2 exposes it or the value is already present in chat messages/session metadata.
- Do not hardcode model lists in v2 integration code.
- Add explicit v2 endpoints for settings/models/pins before depending on them through `8989`.

## 10. Frontend implementation checklist

Use this as the v2 chat integration checklist:

- Configure the v2 base URL from `openclaw.middleware.v2.url`, `NEXT_PUBLIC_MIDDLEWARE_V2_URL`, or default `http://127.0.0.1:8989`.
- Health-check `/health` and confirm `service === "openclaw-middleware-v2"`.
- Keep one global WebSocket to `/api/stream/ws`, initialized with the last known global cursor.
- Keep per-session stores keyed by `sessionKey`.
- Bootstrap each opened session with `/api/chat/bootstrap` and treat the snapshot as truth.
- Initialize session cursor from bootstrap `cursor` / `projection.cursor`.
- Apply patches only when `patch.cursor > state.cursor`.
- Route patches by `patch.sessionKey`; ignore or handle global patches separately when `sessionKey` is null.
- Use `payload.semanticType` when available; fall back to `patch.type`.
- Apply message patches by canonical message id and backend sequence.
- Render order by backend sequence (`__openclaw.seq`, `messageSeq`, `openclawSeq`, or equivalent), not by frontend receive time.
- Track active work from `runStatus`, `statusLabel`, and `activeRun`.
- Never infer done from assistant text or stop tokens.
- Use `clientMessageId` and `idempotencyKey` for send identity.
- Preserve `clientMessageId` as canonical after confirmation; store Gateway identity as metadata.
- Deduplicate optimistic user messages on `chat.message.confirmed` / `chat.user.confirmed`.
- Render tools from bootstrap `toolCalls` and live `chat.tool.*` patches.
- On WebSocket hello with `replayWindowExceeded` or `recovery: "bootstrap"`, bootstrap all visible/open sessions and reset cursors.
- On `/api/patches` with `hasMore` true, stop incremental replay and bootstrap.
- Keep legacy `8787` adapters isolated for features v2 does not implement yet.

## 11. Troubleshooting and logging

### Confirm the frontend is using v2

```bash
curl -s http://127.0.0.1:8989/health | jq '.service,.port'
```

Expected:

```json
"openclaw-middleware-v2"
8989
```

If you see legacy service metadata or port `8787`, the frontend is pointed at the wrong backend.

### Gateway disconnected

```bash
curl -s http://127.0.0.1:8989/api/gateway/status | jq
curl -s -X POST http://127.0.0.1:8989/api/gateway/reconnect | jq
```

If Gateway is disconnected, chat send/bootstrap can fail even when v2 health is OK.

### Stuck thinking

Check these in order:

```bash
curl -s 'http://127.0.0.1:8989/api/chat/bootstrap?sessionKey=s1&limit=200' | jq '{runStatus,statusLabel,activeRun,cursor,sessionStatus,tools,toolCalls}'
curl -s 'http://127.0.0.1:8989/api/patches?afterCursor=0&limit=20' | jq '.patches[-10:]'
curl -s http://127.0.0.1:8989/api/diagnostics | jq
```

Common causes:

- Gateway did not emit a final assistant/session event.
- The frontend inferred status from old legacy fields instead of `runStatus`/`activeRun`.
- The WebSocket disconnected and the frontend did not replay or bootstrap.
- A running tool never reported `result` or `error`; v2 may keep the run in `tool_running`.

### Duplicate user messages

Check for `chat.message.confirmed` patches:

```bash
curl -s 'http://127.0.0.1:8989/api/patches?afterCursor=0&limit=1000' \
  | jq '.patches[] | select(.type=="chat.message.confirmed")'
```

Frontend rules to avoid duplicates:

- Use `clientMessageId` as canonical id.
- On confirmation, update the optimistic message instead of appending a new Gateway user echo.
- Use `payload.optimisticId` and `payload.gatewayMessageId` for reconciliation.

### Replay overflow

WebSocket hello:

```json
{
  "type": "hello",
  "replayCount": 1000,
  "replayHasMore": true,
  "replayWindowExceeded": true,
  "recovery": "bootstrap"
}
```

Recovery:

1. Stop trusting incremental patches from the stale cursor.
2. Bootstrap all visible/open sessions.
3. Reset the global cursor to the max bootstrap cursor you received.
4. Reconnect `/api/stream/ws?afterCursor=<globalCursor>`.

### LocalStorage keys

V2 chat URL:

```js
localStorage.getItem('openclaw.middleware.v2.url')
localStorage.setItem('openclaw.middleware.v2.url', 'http://127.0.0.1:8989')
```

Legacy middleware URL/token:

```js
localStorage.getItem('openclaw.middleware.url')
localStorage.getItem('openclaw.middleware.token')
```

Do not confuse the two. Legacy `openclaw.middleware.url` usually points to `8787`; v2 chat uses `openclaw.middleware.v2.url` and `8989`.

### Port quick reference

- `8989`: middleware-v2 HTTP/WebSocket backend documented here.
- `18789`: OpenClaw Gateway WebSocket used internally by middleware-v2.
- `8787`: legacy desktop middleware/server used by older UI features.

## 12. Endpoint inventory from `apps/middleware-v2/src`

Registered in `apps/middleware-v2/src/app.ts`:

- `registerSystemRoutes`
- `registerGatewayRoutes`
- `registerDiagnosticsRoutes`
- `registerChatRoutes`
- `registerPatchRoutes`

Current v2 endpoint inventory:

- `GET /health`
  - Source: `features/system/routes.ts`
  - Purpose: service readiness, configured host/port, Gateway status.

- `GET /api/system/info`
  - Source: `features/system/routes.ts`
  - Purpose: v2 service metadata, database path, Gateway URL.

- `GET /api/gateway/status`
  - Source: `features/gateway/routes.ts`
  - Purpose: Gateway connection status.

- `POST /api/gateway/reconnect`
  - Source: `features/gateway/routes.ts`
  - Purpose: force Gateway reconnect.

- `GET /api/diagnostics`
  - Source: `features/diagnostics/routes.ts`
  - Purpose: Gateway, projection, live ingest, and patch bus diagnostics.

- `GET /api/diagnostics/patch-clients`
  - Source: `features/patches.ts`
  - Purpose: connected patch WebSocket clients and cursors.

- `GET /api/patches?afterCursor=<number>&limit=<number>`
  - Source: `features/patches.ts`
  - Purpose: replay projection patches after a cursor.

- `GET /api/stream/ws?afterCursor=<number>`
  - Source: `features/patches.ts`
  - Purpose: global WebSocket stream for hello/replay/live patch frames.

- `POST /api/exec/approval/resolve`
  - Source: `features/chat/routes.ts`
  - Purpose: resolve Gateway exec approvals.

- `POST /api/chat/send`
  - Source: `features/chat/routes.ts`
  - Purpose: optimistic user message, run projection, Gateway `chat.send`, history reconciliation.

- `POST /api/chat/abort`
  - Source: `features/chat/routes.ts`
  - Purpose: abort active Gateway/v2 run and project `aborted` state.

- `GET /api/chat/bootstrap?sessionKey=<key>&limit=<n>&maxChars=<n>`
  - Source: `features/chat/routes.ts`
  - Purpose: canonical v2 chat snapshot and live subscription.

- `GET /api/chat/messages?sessionKey=<key>&afterSeq=<n>&limit=<n>`
  - Source: `features/chat/routes.ts`
  - Purpose: projected message rows from v2 SQLite.

Missing from v2 as of this guide:

- `/api/terminal*`
- `/api/files/*`
- `/api/projects*`
- `/api/workspace*`
- `/api/git/*`
- `/api/activity/*`
- `/api/agents/tree`
- `/api/processes`
- `/api/settings/*`
- `/api/models*`
- `/api/pins*`
- `/api/sessions*` outside Gateway calls made internally by chat send/bootstrap
- `/api/chat/history` legacy endpoint; v2 uses `/api/chat/bootstrap` instead
- `/api/chat/stream` and `/api/stream/chat/:sessionKey`; v2 uses global `/api/stream/ws`
