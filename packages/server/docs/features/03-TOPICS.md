# Feature Migration: Topics

## Overview

Topics are conversation groupings within a project. Sessions (chat threads) can be attached to topics.

## Commands

| Command | Args |
|---------|------|
| `middleware_topics_list` | `{ projectId }` |
| `middleware_topics_create` | `{ projectId, name }` |
| `middleware_topics_update` | `{ topicId, name?, sortOrder? }` |
| `middleware_topics_archive` | `{ topicId, archived? }` |
| `middleware_topics_rename` | `{ topicId, name }` |
| `middleware_topics_delete` | `{ topicId }` |
| `middleware_topics_attach_session` | `{ topicId, sessionKey }` |
| `middleware_topics_detach_session` | `{ topicId, sessionKey }` |

## Response Shapes

### Topic object

```typescript
interface Topic {
  id: string           // "topic_xxxxxxxx"
  projectId: string
  name: string
  archived: boolean
  unreadCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

### topicsList response

```json
{ "topics": [Topic, ...] }
```

### topicsCreate / topicsUpdate response

```json
{ "topic": Topic }
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

const { topics } = await invoke("middleware_topics_list", { projectId: "proj_abc" })
const { topic } = await invoke("middleware_topics_create", {
  projectId: "proj_abc",
  name: "Feature Work"
})
await invoke("middleware_topics_attach_session", {
  topicId: topic.id,
  sessionKey: "ses_xyz"
})
```

### topicsRename response

```json
{ "topic": Topic }
```

Validates that name is not empty. Used by auto-naming — see `14-STANDALONE-CHATS.md` for the full auto-naming flow (same pattern for both chats and topics).

## Auto-Naming (New)

Topics now support the same auto-naming flow as standalone chats. After the first message in a new topic:

```typescript
// 1. Immediate name from first message
const { name } = await invoke("middleware_autonaming_quick", { text: firstMessage })
await invoke("middleware_topics_rename", { topicId, name })

// 2. Async AI-generated name (fire and forget)
invoke("middleware_autonaming_generate", { sessionKey, firstMessage })
  .then(({ name }) => invoke("middleware_topics_rename", { topicId, name }))
  .catch(() => {})
```

See `14-STANDALONE-CHATS.md` for full details on auto-naming commands.

## Error Cases

- `"Project not found"` — projectId doesn't exist
- `"Topic name already exists in this project"` — duplicate per project (case-insensitive)
- `"Topic not found"` — topicId doesn't exist
- `"Name cannot be empty"` — rename with blank name

## Notes

- Topic names are unique per project (COLLATE NOCASE)
- `topicsDelete` also deletes attached session mappings and branches
- `sortOrder` defaults to 0 — use it for custom ordering in the sidebar
