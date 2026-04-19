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

## Error Cases

- `"Project not found"` — projectId doesn't exist
- `"Topic name already exists in this project"` — duplicate per project (case-insensitive)
- `"Topic not found"` — topicId doesn't exist

## Notes

- Topic names are unique per project (COLLATE NOCASE)
- `topicsDelete` also deletes attached session mappings and branches
- `sortOrder` defaults to 0 — use it for custom ordering in the sidebar
