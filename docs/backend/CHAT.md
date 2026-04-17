# CHAT.md

Scope: frontend-facing contract for Jarvis chat middleware.

## Commands

Frontend sends Tauri `invoke` commands:
- `middleware_chat_create_session`
- `middleware_chat_history`
- `middleware_chat_send`
- `middleware_chat_stream_start`
- `middleware_chat_stream_stop`

Rule:
- `invoke` returns immediate control/ack data
- live run output comes from the stream event channel

## Stream events

Middleware emits these event types to frontend:
- `chat.ready`
- `chat.status`
- `chat.message`
- `chat.tool`
- `chat.error`

## `chat.ready`

Sent when stream attaches and recent state is loaded.

Example:
```json
{
  "type": "chat.ready",
  "sessionKey": "sess_xxx",
  "thinkingLevel": null,
  "verboseLevel": "full",
  "toolOutputVisibility": "full",
  "recentMessages": []
}
```

Use for:
- initial stream bootstrap
- recent message tail
- tool visibility decisions

## `chat.status`

High-level chat lifecycle state.

Example:
```json
{
  "type": "chat.status",
  "sessionKey": "sess_xxx",
  "state": "tool_running",
  "label": "read"
}
```

Observed states:
- `connected`
- `tool_running`
- `thinking`
- `streaming`
- `done`
- `error`

Meaning:
- `thinking` is a state hint only
- it should not be treated as proof that raw reasoning text will arrive

## `chat.message`

Assistant message event for normal transcript content.

Example:
```json
{
  "type": "chat.message",
  "sessionKey": "sess_xxx",
  "messageId": "msg_xxx",
  "role": "assistant",
  "content": [],
  "text": "Done.",
  "createdAt": "2026-04-17T21:00:05Z",
  "model": "openai-codex/gpt-5.4"
}
```

Notes:
- tool-role messages are filtered out of `chat.message`
- final assistant text belongs here

## `chat.tool`

Primary source for tool lifecycle UI.

Example:
```json
{
  "type": "chat.tool",
  "sessionKey": "sess_xxx",
  "runId": "run_xxx",
  "verboseLevel": "full",
  "toolOutputVisibility": "full",
  "phase": "result",
  "name": "read",
  "toolCallId": "tool_xxx",
  "args": { "path": "/etc/hostname" },
  "partialResult": null,
  "result": { "content": "ubuntu-8gb-hel1-4\n" },
  "error": null
}
```

Render rules:
- always show tool name and phase
- show args when helpful
- show `partialResult` / `result` only when `toolOutputVisibility` allows it

Visibility mapping:
- `verboseLevel = "full"` → `toolOutputVisibility = "full"`
- `verboseLevel = "on"` → `toolOutputVisibility = "metadata-only"`
- `verboseLevel = "off"` or missing → `toolOutputVisibility = "hidden"`

## `chat.error`

Example:
```json
{
  "type": "chat.error",
  "sessionKey": "sess_xxx",
  "message": "Some stream error"
}
```

## Thinking / reasoning reality

Tested result against current live OpenClaw on this machine:
- session config supports `reasoningLevel` values such as `on`, `off`, `stream`
- `thinkingLevel` and `chat.status.state = "thinking"` are usable UI signals
- raw live reasoning text should **not** be treated as a stable frontend contract today

What was actually observed in live testing:
- normal assistant delta events
- final assistant message
- final transcript may include a `thinking` block with encrypted signature metadata
- no usable live Gateway `agent.stream = "thinking"` text payloads were observed in the tested run

Frontend rule:
- render thinking as a state/indicator
- do not build the UI around raw reasoning text availability

## Recommended frontend model

Use these layers:
- message timeline → `chat.message`
- tool timeline → `chat.tool`
- top-level progress state → `chat.status`
- error banner → `chat.error`

Do not rely on a dedicated reasoning-text stream for current production behavior.
