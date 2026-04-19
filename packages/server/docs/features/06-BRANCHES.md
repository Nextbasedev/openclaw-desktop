# Feature Migration: Branches

## Overview

Branches create conversation forks from a specific message in a chat session. Used for regenerate, edit-and-resend, and explicit thread creation.

## Commands

| Command | Args |
|---------|------|
| `middleware_branch_create` | `{ sourceSessionKey, sourceMessageId, projectId, branchName, branchReason?, branchSessionKey }` |
| `middleware_branch_list` | `{ sourceSessionKey }` |
| `middleware_branch_get` | `{ branchSessionKey }` |
| `middleware_branch_delete` | `{ branchSessionKey }` |
| `middleware_branch_from_regenerate` | `{ sourceSessionKey, sourceMessageId, projectId, branchSessionKey }` |
| `middleware_branch_from_edit` | `{ sourceSessionKey, sourceMessageId, projectId, branchSessionKey, newMessage }` |
| `middleware_branch_create_thread` | `{ sourceSessionKey, sourceMessageId, projectId, threadName, branchSessionKey }` |

## Response Shapes

### Branch object

```typescript
interface Branch {
  id: string                  // "branch_xxxxxxxx"
  sourceSessionKey: string
  sourceMessageId: string
  branchSessionKey: string    // unique
  branchTopicId: string | null
  branchReason: string | null // "regenerate" | "edit" | "thread" | custom
  createdAt: string
  metadata: unknown | null
}
```

### branchList response

```json
{ "branches": [Branch, ...] }
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

// Create a branch from regenerate
const { branch } = await invoke("middleware_branch_from_regenerate", {
  sourceSessionKey: "ses_original",
  sourceMessageId: "msg_123",
  projectId: "proj_abc",
  branchSessionKey: "ses_new_branch"
})

// List all branches from a source session
const { branches } = await invoke("middleware_branch_list", {
  sourceSessionKey: "ses_original"
})
```

## Notes

- `branchSessionKey` must be a valid Gateway session key (create the chat session first)
- `branchFromRegenerate` sets `branchReason: "regenerate"`, auto-generates name
- `branchFromEdit` sets `branchReason: "edit"`, auto-generates name
- `branchCreateThread` sets `branchReason: "thread"`, creates a topic with `threadName`
