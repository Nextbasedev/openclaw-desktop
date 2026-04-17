# SESSIONS.md

Scope: document the current backend/middleware contract for Jarvis session mapping APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- session mapping rows in local SQLite
- OpenClaw Gateway for reset/delete/session creation side effects

Current Tauri commands:
- `middleware_sessions_list`
- `middleware_sessions_create`
- `middleware_sessions_update`
- `middleware_sessions_reset`
- `middleware_sessions_delete`

## What a session mapping represents

Jarvis stores a local mapping layer on top of OpenClaw sessions.

Current shape:
```json
{
  "sessionKey": "agent:main:dashboard:abc",
  "sessionId": null,
  "projectId": "proj_1",
  "topicId": "topic_1",
  "agentId": "main",
  "label": "Deploy debugging",
  "status": "idle",
  "createdAt": "2026-04-17T21:00:00Z",
  "updatedAt": "2026-04-17T21:00:00Z",
  "pinned": false,
  "hidden": false,
  "source": "jarvis"
}
```

Key rule:
- frontend should treat this as Jarvis navigation/state metadata around the OpenClaw session, not the full transcript object

## `middleware_sessions_list`

### Input
```json
{
  "projectId": "proj_1",
  "topicId": "topic_1",
  "includeExisting": false
}
```

All fields optional.

### Behavior
- filters by `projectId` when present
- filters by `topicId` when present
- default visibility is `source = "jarvis"` only
- if `includeExisting = true`, returns all mapped sessions
- ordered by:
  - `pinned DESC`
  - `updated_at DESC`

### Response
```json
{
  "sessions": [],
  "sessionVisibility": "jarvis-only"
}
```

`sessionVisibility` values:
- `jarvis-only`
- `all-visible`

## `middleware_sessions_create`

Creates a real OpenClaw chat session first, then stores a Jarvis mapping row.

### Input
```json
{
  "projectId": "proj_1",
  "topicId": "topic_1",
  "agentId": "main",
  "label": "Deploy debugging"
}
```

### Behavior
- calls `middleware_chat_create_session`
- uses `verboseLevel = "full"` for created chat session
- stores local mapping with:
  - `status = "idle"`
  - `pinned = false`
  - `hidden = false`
  - `source = "jarvis"`

### Response
```json
{
  "session": {
    "sessionKey": "agent:main:dashboard:abc",
    "projectId": "proj_1",
    "topicId": "topic_1",
    "agentId": "main",
    "label": "Deploy debugging",
    "status": "idle"
  }
}
```

## `middleware_sessions_update`

Updates Jarvis-local mapping metadata only.

### Input
```json
{
  "sessionKey": "agent:main:dashboard:abc",
  "label": "Deploy repair",
  "pinned": true,
  "hidden": false,
  "topicId": "topic_2"
}
```

All fields except `sessionKey` are optional.

### Behavior
- omitted fields keep existing value
- does not patch remote OpenClaw session settings
- updates `updatedAt`

### Failure case
- `Session mapping not found: <sessionKey>`

## `middleware_sessions_reset`

### Input
```json
{
  "sessionKey": "agent:main:dashboard:abc"
}
```

### Behavior
- calls Gateway `sessions.reset`
- requires operator admin-capable connection internally
- sets local mapped status back to `idle`

### Response
```json
{
  "ok": true,
  "sessionKey": "agent:main:dashboard:abc"
}
```

## `middleware_sessions_delete`

### Input
```json
{
  "sessionKey": "agent:main:dashboard:abc"
}
```

### Behavior
- deletes local mapping row first
- then deletes underlying OpenClaw chat session via `middleware_chat_delete_session`

### Response
```json
{
  "ok": true,
  "sessionKey": "agent:main:dashboard:abc"
}
```

## Frontend guidance

Use these APIs for:
- session list in project/topic screens
- pin/hide/label updates
- moving a mapped session between topics
- reset/delete actions from the Jarvis shell

Do not use them for:
- transcript fetch
- live chat streaming
- tool timeline rendering

Use chat middleware for those instead.
