# TOPICS.md

Scope: document the current **backend/middleware contract** for Jarvis topic APIs so frontend can build topic creation, rename, archive, ordering, and session attachment UI cleanly.

Source of truth right now:
- `packages/desktop/src-tauri/src/middleware.rs`
- `packages/desktop/src-tauri/src/lib.rs`

Current Tauri commands:
- `middleware_topics_list`
- `middleware_topics_create`
- `middleware_topics_update`
- `middleware_topics_archive`
- `middleware_topics_attach_session`
- `middleware_topics_detach_session`

---

## 1. What a topic represents

A topic is a project-scoped conversation bucket.

Topics currently store:
- `id`
- `projectId`
- `name`
- `archived`
- `unreadCount`
- `sortOrder`
- `createdAt`
- `updatedAt`

Backend JSON shape:
```json
{
  "id": "topic_xxx",
  "projectId": "proj_1",
  "name": "Deploy flow",
  "archived": false,
  "unreadCount": 0,
  "sortOrder": 0,
  "createdAt": "2026-04-17T21:00:00Z",
  "updatedAt": "2026-04-17T21:00:00Z"
}
```

---

## 2. Recommended frontend topic flow

### Step 1, list topics for a project
Call:
- `middleware_topics_list`

Use for:
- project screen
- sidebar topic drawer
- selecting a topic before attaching sessions

### Step 2, create topic
Call:
- `middleware_topics_create`

Use for:
- new conversation bucket
- default first topic after project create

### Step 3, rename or reorder topic
Call:
- `middleware_topics_update`

Use for:
- inline rename
- drag-and-drop ordering save

### Step 4, archive or restore topic
Call:
- `middleware_topics_archive`

Use for:
- hiding old topic threads without deleting history

### Step 5, attach or detach sessions
Calls:
- `middleware_topics_attach_session`
- `middleware_topics_detach_session`

Use for:
- move an existing session into a topic
- remove a session from topic grouping

---

## 3. Tauri command contracts

## 3.1 `middleware_topics_list`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Success response
```json
{
  "topics": [
    {
      "id": "topic_1",
      "projectId": "proj_1",
      "name": "Deploy flow",
      "archived": false,
      "unreadCount": 0,
      "sortOrder": 0,
      "createdAt": "2026-04-17T21:00:00Z",
      "updatedAt": "2026-04-17T21:00:00Z"
    }
  ]
}
```

### Behavior
- returns all topics for project
- includes archived and non-archived topics
- ordered by:
  - `sort_order ASC`
  - then `updated_at DESC`

### UI guidance
- filter archived separately if needed
- use this API for topic management pages
- use sidebar payload if you only want active topics for navigation

---

## 3.2 `middleware_topics_create`

### Input
```json
{
  "projectId": "proj_1",
  "name": "Deploy flow"
}
```

### Required fields
- `projectId`
- `name`

### Success response
```json
{
  "topic": {
    "id": "topic_xxx",
    "projectId": "proj_1",
    "name": "Deploy flow",
    "archived": false,
    "unreadCount": 0,
    "sortOrder": 0,
    "createdAt": "2026-04-17T21:00:00Z",
    "updatedAt": "2026-04-17T21:00:00Z"
  }
}
```

### Behavior
- backend generates id as `topic_<uuid>`
- backend computes next `sortOrder` as:
  - `MAX(sort_order) + 1` within the project
- topic starts as:
  - `archived = false`
  - `unreadCount = 0`

### Failure cases
- `Failed to compute topic sort order: ...`
- `Failed to create topic: ...`
- `Failed to fetch created topic: ...`
- `Failed to decode created topic: ...`

### UI guidance
- after create, refresh project sidebar or topic list
- use returned topic id directly for navigation

---

## 3.3 `middleware_topics_update`

### Input
```json
{
  "topicId": "topic_1",
  "name": "Deploy Debugging",
  "sortOrder": 2
}
```

### Optional fields
- `name`
- `sortOrder`

### Behavior
If a field is omitted:
- backend keeps existing value

### Success response
```json
{
  "topic": {
    "id": "topic_1",
    "projectId": "proj_1",
    "name": "Deploy Debugging",
    "archived": false,
    "unreadCount": 0,
    "sortOrder": 2,
    "createdAt": "2026-04-17T21:00:00Z",
    "updatedAt": "2026-04-17T21:05:00Z"
  }
}
```

### Failure cases
- `Topic not found: <id>`
- `Failed to load topic for update: ...`
- `Failed to update topic: ...`
- `Failed to fetch updated topic: ...`

### UI guidance
- use same API for rename and reorder
- for drag-and-drop ordering, persist each affected topic's `sortOrder`
- no batch reorder API exists yet

---

## 3.4 `middleware_topics_archive`

### Input
```json
{
  "topicId": "topic_1",
  "archived": true
}
```

### Notes
- `archived` is optional
- if omitted, backend defaults to `true`

### Success response
```json
{
  "ok": true,
  "topicId": "topic_1",
  "archived": true
}
```

### Behavior
- soft archive only
- topic can be restored with `archived: false`

### Failure cases
- `Failed to archive topic: ...`

### UI guidance
- archive should not be shown as permanent delete
- after archive, refresh topic list or sidebar

---

## 3.5 `middleware_topics_attach_session`

### Input
```json
{
  "topicId": "topic_1",
  "sessionKey": "dashboard:abc"
}
```

### Success response
```json
{
  "ok": true,
  "topicId": "topic_1",
  "sessionKey": "dashboard:abc"
}
```

### Behavior
- updates `session_mappings.topic_id`
- does not create session mapping by itself
- assumes session already exists in `session_mappings`

### Failure cases
- `Failed to attach session to topic: ...`

### UI guidance
- only show this action for known mapped sessions
- after attach, refresh sidebar and/or topic session list

---

## 3.6 `middleware_topics_detach_session`

### Input
```json
{
  "topicId": "topic_1",
  "sessionKey": "dashboard:abc"
}
```

### Success response
```json
{
  "ok": true,
  "topicId": "topic_1",
  "sessionKey": "dashboard:abc"
}
```

### Behavior
- sets `session_mappings.topic_id = NULL`
- `topicId` is echoed back for UI convenience, but backend uses only `sessionKey` for detach

### Failure cases
- `Failed to detach session from topic: ...`

### Important note
Current backend does not verify that the provided `topicId` matches the session's current topic before detach.

### UI guidance
- treat detach as session-level ungrouping
- refresh sidebar after detach

---

## 4. Topic ordering rules

Current ordering logic:
- list order is `sortOrder ASC`, then `updatedAt DESC`
- new topics are appended at the end by using max existing sort order + 1

Frontend implication:
- if you implement drag-and-drop, you must write back explicit `sortOrder` values
- there is no automatic reorder normalization command yet

---

## 5. Suggested frontend topic states

Use simple UI states like:
- `loading_topics`
- `empty_topics`
- `topics_ready`
- `creating_topic`
- `updating_topic`
- `archiving_topic`
- `attaching_session`
- `detaching_session`
- `topic_error`

---

## 6. Suggested frontend topic UX

### Topic list UI
Show:
- name
- unread count
- archived badge if archived view is enabled
- drag handle if ordering supported

### Topic actions
Recommended actions:
- rename
- archive
- restore
- attach session
- detach session

### Create topic dialog
Fields:
- `name`

Hidden/contextual value:
- `projectId`

---

## 7. Example frontend invoke usage

```ts
import { invoke } from "@tauri-apps/api/core";

export async function listTopics(projectId: string) {
  return invoke("middleware_topics_list", {
    input: { projectId },
  });
}

export async function createTopic(input: {
  projectId: string;
  name: string;
}) {
  return invoke("middleware_topics_create", { input });
}

export async function updateTopic(input: {
  topicId: string;
  name?: string;
  sortOrder?: number;
}) {
  return invoke("middleware_topics_update", { input });
}

export async function archiveTopic(topicId: string, archived = true) {
  return invoke("middleware_topics_archive", {
    input: { topicId, archived },
  });
}

export async function attachSessionToTopic(input: {
  topicId: string;
  sessionKey: string;
}) {
  return invoke("middleware_topics_attach_session", { input });
}

export async function detachSessionFromTopic(input: {
  topicId: string;
  sessionKey: string;
}) {
  return invoke("middleware_topics_detach_session", { input });
}
```

---

## 8. Current backend limitations

Frontend should know these limits exist today:
- no topic delete command
- no batch reorder command
- no dedicated topic detail/get endpoint
- attach/detach assumes session mapping already exists
- detach does not validate the passed topic id against current DB state
- only string errors exist today, no structured error codes

---

## 9. Recommended next backend additions

Useful next commands or improvements:
- `middleware_topics_get`
- `middleware_topics_reorder_bulk`
- `middleware_topics_delete`
- better validation when attaching/detaching unknown sessions
- topic-level session listing payload for direct topic detail screens
