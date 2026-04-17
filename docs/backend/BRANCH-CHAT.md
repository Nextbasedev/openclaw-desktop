# BRANCH-CHAT.md

Scope: document the current backend/middleware contract for branch chat and thread creation features.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- local `branches` table
- local `topics` table
- underlying chat session creation/send helpers

Current Tauri commands:
- `middleware_branch_create`
- `middleware_branch_list`
- `middleware_branch_get`
- `middleware_branch_delete`
- `middleware_branch_from_regenerate`
- `middleware_branch_from_edit`
- `middleware_branch_create_thread`

## What a branch represents

A branch is a new Jarvis topic + session derived from an existing source session/message.

Current returned branch shape:
```json
{
  "id": "branch_xxx",
  "sourceSessionKey": "agent:main:dashboard:src",
  "sourceMessageId": "msg_xxx",
  "branchSessionKey": "agent:main:dashboard:new",
  "branchTopicId": "topic_xxx",
  "branchReason": "manual",
  "createdAt": "2026-04-17T21:00:00Z",
  "metadata": {}
}
```

## `middleware_branch_create`

### Input
```json
{
  "sourceSessionKey": "agent:main:dashboard:src",
  "sourceMessageId": "msg_xxx",
  "projectId": "proj_1",
  "branchName": "Alternative approach",
  "branchReason": "manual"
}
```

### Behavior
- reads source session history
- creates a new OpenClaw chat session
- creates a new topic in the project
- stores a new session mapping for the branch session
- stores a branch relationship row with source/branch linkage
- saves source history snapshot in branch metadata

### Response
```json
{
  "branch": {},
  "topicId": "topic_xxx",
  "sessionKey": "agent:main:dashboard:new"
}
```

## `middleware_branch_list`

### Input
```json
{ "sourceSessionKey": "agent:main:dashboard:src" }
```

### Response
```json
{ "branches": [] }
```

Ordered by `created_at DESC`.

## `middleware_branch_get`

### Input
```json
{ "branchSessionKey": "agent:main:dashboard:new" }
```

### Response
```json
{ "branch": {} }
```

Failure case:
- `Branch not found`

## `middleware_branch_delete`

### Input
```json
{ "branchSessionKey": "agent:main:dashboard:new" }
```

### Behavior
- deletes row from `branches`
- archives the branch topic
- does not currently delete the underlying chat session in this command

### Response
```json
{
  "deleted": true,
  "branchSessionKey": "agent:main:dashboard:new",
  "topicArchived": "topic_xxx"
}
```

## Convenience helpers

### `middleware_branch_from_regenerate`

Creates a branch with:
- auto-generated branch name based on source message id
- `branchReason = "regenerate"`

### `middleware_branch_from_edit`

Creates a branch, then immediately sends a new user message into the new branch session.

Extra input:
```json
{
  "sourceSessionKey": "agent:main:dashboard:src",
  "sourceMessageId": "msg_xxx",
  "projectId": "proj_1",
  "newMessage": "Try again with a faster approach"
}
```

### `middleware_branch_create_thread`

Creates a branch with custom thread name and:
- `branchReason = "thread"`

## Frontend guidance

Use branch chat for:
- regenerate into separate thread
- edit-and-fork flows
- alternate exploration from one assistant/user turn
- thread creation from any message

UI expectations:
- branch creation returns a new topic and session key immediately
- after branch create, route user into the new topic/session
- branch delete should be treated as archive-style cleanup, not destructive full session wipe
