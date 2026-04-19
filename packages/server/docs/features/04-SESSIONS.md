# Feature Migration: Sessions

## Overview

Sessions map a Gateway chat session (`sessionKey`) to a project and optional topic. The actual chat history lives on the Gateway — the server only stores the mapping metadata.

## Commands

| Command | Args |
|---------|------|
| `middleware_sessions_list` | `{ projectId?, topicId?, includeExisting? }` |
| `middleware_sessions_create` | `{ projectId, topicId?, agentId, label, sessionKey }` |
| `middleware_sessions_update` | `{ sessionKey, label?, pinned?, hidden?, topicId? }` |
| `middleware_sessions_delete` | `{ sessionKey }` |

## Response Shapes

### Session object

```typescript
interface Session {
  sessionKey: string
  sessionId: string | null
  projectId: string
  topicId: string | null
  agentId: string
  label: string
  status: string         // "active" | "closed"
  createdAt: string
  updatedAt: string
  pinned: boolean
  hidden: boolean
  source: string | null
}
```

### sessionsList response

```json
{ "sessions": [Session, ...] }
```

### sessionsCreate response

```json
{ "session": Session }
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

// Create a session mapping (after creating a Gateway chat session)
const { session } = await invoke("middleware_sessions_create", {
  projectId: "proj_abc",
  agentId: "agent-1",
  label: "Debug the login bug",
  sessionKey: "gateway-session-key-from-chat-create"
})

// List sessions for a project
const { sessions } = await invoke("middleware_sessions_list", {
  projectId: "proj_abc"
})

// Pin a session
await invoke("middleware_sessions_update", {
  sessionKey: session.sessionKey,
  pinned: true
})
```

## Error Cases

- `"Project not found"` — projectId doesn't exist
- `"Session mapping already exists"` — duplicate sessionKey

## Notes

- `sessionKey` is the primary key — it comes from the Gateway's `createChatSession`
- The server does NOT create the actual Gateway session. The UI should:
  1. Call `middleware_chat_create_session` to get a `sessionKey` from the Gateway
  2. Call `middleware_sessions_create` to store the mapping locally
- `includeExisting` on list: when true, includes all sessions regardless of status
