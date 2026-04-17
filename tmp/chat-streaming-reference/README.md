# Jarvis temp design, OpenClaw chat streaming reference

This is reference-only, not the real desktop UI.

## Goal

Prove the middleware surface for:
- loading/thinking state
- live tool activity
- optional tool result rendering when OpenClaw exposes it
- final transcript updates

## Middleware shape

### Send
- `POST /api/chat/send`
- body:
```json
{
  "sessionKey": "agent:main:...",
  "text": "Use the exec tool to run printf hello"
}
```
- response:
```json
{
  "accepted": true,
  "sessionKey": "agent:main:...",
  "runId": "...",
  "status": "started"
}
```

### Stream
- `GET /api/chat/stream?sessionKey=...`
- transport: SSE
- normalized events:
  - `chat.ready`
  - `chat.status`
  - `chat.tool`
  - `chat.message`
  - `chat.error`

## Desktop rendering guidance

### State model
- local after send: `sending`
- after `chat.ready` or once request is accepted: `thinking`
- after `chat.tool`: `tool_running`
- after first assistant transcript event: `streaming` if partial UX is later added, otherwise still render the completed message block
- after final assistant transcript append: `done`
- after `chat.error`: `error`

## Important real OpenClaw behavior

Confirmed from live Gateway tests:
- OpenClaw emits `session.tool` events for tool lifecycle.
- Tool result payloads are only included when session `verboseLevel` is `full`.
- At `verboseLevel: on`, middleware still gets tool cards, args, names, and phases, but result bodies are stripped.
- At `verboseLevel: off`, tool detail visibility is effectively hidden.
- Verified live with `/etc/hostname` using the `read` tool:
  - `verboseLevel: on` → `session.tool` start/result events, no `result` body
  - `verboseLevel: full` → `session.tool` result event includes `result.content[0].text = "ubuntu-8gb-hel1-4\n"`

## What desktop should do

- Always show tool name + phase when `chat.tool` arrives.
- Only render tool stdout/result panels when `toolOutputVisibility === "full"` and `result` or `partialResult` exists.
- If visibility is `metadata-only`, show a compact card like:
  - `Running exec`
  - `Finished exec`
- Never assume raw tool output is available.

## Production note

The Next.js app in `packages/ui` uses `output: "export"`, so its `/api/*` routes are reference adapters only, not the production middleware host.

The production-ready runtime-safe middleware now lives in `packages/middleware/src/index.ts` and exposes:
- `createChatSession`
- `deleteChatSession`
- `getChatHistory`
- `sendChatMessage`
- `openChatEventStream`

The desktop shell now also has a real Tauri bridge in `packages/desktop/src-tauri/src/middleware.rs` with commands:
- `middleware_chat_create_session`
- `middleware_chat_delete_session`
- `middleware_chat_history`
- `middleware_chat_send`
- `middleware_chat_stream_start`
- `middleware_chat_stream_stop`

Tauri stream events are emitted on:
- `middleware://chat-event`

Live verification script:
- `node --experimental-strip-types tmp/chat-streaming-reference/test-middleware-package.mjs`

## Why SSE first

- Browser-native.
- Enough for send + observe.
- Clean fit for temp reference UI and desktop webview middleware.
- We can add WebSocket later only if desktop needs bidirectional stream control beyond send/abort.
