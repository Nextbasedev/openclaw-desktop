# PROJECTS.md

Scope: document the current **backend/middleware contract** for Jarvis project APIs so frontend can build project setup, listing, details, and sidebar flows without digging through Rust.

Source of truth right now:
- `packages/desktop/src-tauri/src/middleware.rs`
- `packages/desktop/src-tauri/src/lib.rs`

Current Tauri commands:
- `middleware_projects_list`
- `middleware_projects_create`
- `middleware_projects_get`
- `middleware_projects_update`
- `middleware_projects_archive`
- `middleware_projects_pin`
- `middleware_projects_delete`
- `middleware_projects_sidebar`

---

## 1. What a project represents

A project is Jarvis' top-level workspace container.

A project currently stores:
- `id`
- `name`
- `profileId`
- `workspaceRoot`
- `repoRoot`
- `archived`
- `pinned`
- `unreadCount`
- `lastActivityAt`
- `createdAt`
- `updatedAt`

Backend JSON shape:
```json
{
  "id": "proj_xxx",
  "name": "Jarvis Desktop",
  "profileId": "prof_local_main",
  "workspaceRoot": "/Users/dixit/Jarvis",
  "repoRoot": "/Users/dixit/Jarvis",
  "archived": false,
  "pinned": false,
  "unreadCount": 0,
  "lastActivityAt": null,
  "createdAt": "2026-04-17T21:00:00Z",
  "updatedAt": "2026-04-17T21:00:00Z"
}
```

---

## 2. Recommended frontend project flow

### Step 1, list projects
Call:
- `middleware_projects_list`

Use for:
- home screen
- workspace picker
- empty state detection

### Step 2, create first project
Call:
- `middleware_projects_create`

Use for:
- onboarding project creation
- connecting a profile + workspace root

### Step 3, load project details
Call:
- `middleware_projects_get`

Use for:
- project settings screen
- project header
- repo summary display

### Step 4, update, archive, pin, or delete project
Calls:
- `middleware_projects_update`
- `middleware_projects_archive`
- `middleware_projects_pin`
- `middleware_projects_delete`

Use for:
- rename
- change roots
- soft archive / restore
- pin / unpin for priority ordering
- permanent deletion (cascades to topics + sessions)

### Step 5, load sidebar payload
Call:
- `middleware_projects_sidebar`

Use for:
- main navigation rendering
- topic list + mapped sessions list

---

## 3. Tauri command contracts

## 3.1 `middleware_projects_list`

### Input
No input.

### Response
```json
{
  "projects": [
    {
      "id": "proj_1",
      "name": "Jarvis Desktop",
      "profileId": "prof_local_main",
      "workspaceRoot": "/Users/dixit/Jarvis",
      "repoRoot": "/Users/dixit/Jarvis",
      "archived": false,
      "pinned": false,
      "unreadCount": 0,
      "lastActivityAt": null,
      "createdAt": "2026-04-17T21:00:00Z",
      "updatedAt": "2026-04-17T21:00:00Z"
    }
  ]
}
```

### Behavior
- ordered by `pinned DESC, updated_at DESC` (pinned projects always appear first)
- includes archived and non-archived projects
- does not add repo summary

### UI guidance
- filter archived in UI if needed
- use `updatedAt` for recents ordering
- if list is empty, show create-project onboarding state

---

## 3.2 `middleware_projects_create`

### Input
```json
{
  "name": "Jarvis Desktop",
  "profileId": "prof_local_main",
  "workspaceRoot": "/Users/dixit/Jarvis",
  "repoRoot": "/Users/dixit/Jarvis"
}
```

### Required fields
- `name`
- `profileId`
- `workspaceRoot`

### Optional fields
- `repoRoot`

### Success response
```json
{
  "project": {
    "id": "proj_xxx",
    "name": "Jarvis Desktop",
    "profileId": "prof_local_main",
    "workspaceRoot": "/Users/dixit/Jarvis",
    "repoRoot": "/Users/dixit/Jarvis",
    "archived": false,
    "unreadCount": 0,
    "lastActivityAt": null,
    "createdAt": "2026-04-17T21:00:00Z",
    "updatedAt": "2026-04-17T21:00:00Z"
  }
}
```

### Behavior
- backend generates id as `proj_<uuid>`
- new project starts with:
  - `archived = false`
  - `unreadCount = 0`
- `lastActivityAt` is not set on create

### Failure shape
Rejected invoke with string error, for example:
- `Failed to create project: ...`
- `Failed to fetch created project: ...`
- `Failed to decode created project: ...`

### UI guidance
- default `repoRoot = workspaceRoot` is reasonable for most flows
- after create, frontend can immediately route to topic setup or repo remote setup

---

## 3.3 `middleware_projects_get`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Success response
```json
{
  "project": {
    "id": "proj_1",
    "name": "Jarvis Desktop",
    "profileId": "prof_local_main",
    "workspaceRoot": "/Users/dixit/Jarvis",
    "repoRoot": "/Users/dixit/Jarvis",
    "archived": false,
    "unreadCount": 0,
    "lastActivityAt": null,
    "createdAt": "2026-04-17T21:00:00Z",
    "updatedAt": "2026-04-17T21:00:00Z",
    "repo": {
      "branch": "main",
      "dirty": true
    }
  }
}
```

### Behavior
- returns one project
- adds computed `repo` summary when repo root exists and can be inspected
- repo summary may be `null`

### Failure cases
- `Project not found`
- `Failed to prepare project fetch: ...`
- `Failed to fetch project: ...`
- `Project payload was not an object`

### UI guidance
- use this for details page, not list page
- `repo` is a convenience field and can be absent or null
- if project is missing, route back to project list

---

## 3.4 `middleware_projects_update`

### Input
```json
{
  "projectId": "proj_1",
  "name": "Jarvis Desktop",
  "workspaceRoot": "/Users/dixit/Jarvis",
  "repoRoot": "/Users/dixit/Jarvis",
  "archived": false
}
```

All fields except `projectId` are optional.

### Update behavior
If a field is omitted:
- backend keeps existing value

### Success response
```json
{
  "project": {
    "id": "proj_1",
    "name": "Updated Name",
    "profileId": "prof_local_main",
    "workspaceRoot": "/Users/dixit/Jarvis",
    "repoRoot": "/Users/dixit/Jarvis",
    "archived": false,
    "unreadCount": 0,
    "lastActivityAt": null,
    "createdAt": "2026-04-17T21:00:00Z",
    "updatedAt": "2026-04-17T21:05:00Z"
  }
}
```

### Failure cases
- `Project not found: <id>`
- `Failed to load project for update: ...`
- `Failed to update project: ...`
- `Failed to fetch updated project: ...`

### UI guidance
- safe for partial edits
- use for rename and path editing
- do optimistic UI only if you can revert on string error

---

## 3.5 `middleware_projects_archive`

### Input
```json
{
  "projectId": "proj_1",
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
  "projectId": "proj_1",
  "archived": true
}
```

### Behavior
- soft archive only
- can also unarchive by sending `archived: false`

### Failure cases
- `Failed to archive project: ...`

### UI guidance
- label this as archive, not delete
- support restore from archived state if you expose archived projects in UI

---

## 3.6 `middleware_projects_pin`

### Input
```json
{
  "projectId": "proj_1",
  "pinned": true
}
```

### Notes
- `pinned` is optional
- if omitted, backend defaults to `true`

### Success response
```json
{
  "ok": true,
  "projectId": "proj_1",
  "pinned": true
}
```

### Behavior
- toggles the `pinned` flag on the project
- pinned projects appear first in list results
- can unpin by sending `pinned: false`

### Failure cases
- `Project not found: <id>`
- `Failed to pin project: ...`

### UI guidance
- use a star/pin icon on project cards
- support toggling in-place

---

## 3.7 `middleware_projects_delete`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Success response
```json
{
  "ok": true,
  "projectId": "proj_1"
}
```

### Behavior
- **hard delete** — permanently removes the project
- cascades to related data:
  - deletes all `session_mappings` for the project
  - deletes all `topics` for the project
  - deletes the project row itself
- this is irreversible

### Failure cases
- `Project not found: <id>`
- `Failed to check project existence: ...`
- `Failed to delete project sessions: ...`
- `Failed to delete project topics: ...`
- `Failed to delete project: ...`

### UI guidance
- require a confirmation dialog before calling this
- prefer archive for soft removal; delete for permanent cleanup
- label clearly as "Delete permanently" or similar

---

## 3.8 `middleware_projects_sidebar`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Success response
```json
{
  "project": {
    "id": "proj_1",
    "name": "Jarvis Desktop"
  },
  "topics": [
    {
      "id": "topic_1",
      "name": "Deploy flow",
      "unreadCount": 2
    }
  ],
  "agents": [
    {
      "id": "main",
      "name": "Main",
      "status": "online"
    }
  ],
  "sessions": [
    {
      "key": "dashboard:abc",
      "title": "Fix auth flow",
      "status": "running"
    }
  ],
  "sessionVisibility": "jarvis-only"
}
```

### Behavior
- only non-archived topics are returned
- sessions come from `session_mappings`
- sessions with `hidden = 1` are excluded
- sessions are ordered by `pinned DESC, updated_at DESC`
- current agent list is hardcoded to one entry:
  - `main`

### Important note
This is a UI-composed payload, not raw DB rows.

### Failure cases
- `Project not found: <id>`
- `Failed to load project sidebar: ...`
- `Failed to prepare topics sidebar query: ...`
- `Failed to load sidebar topics: ...`
- `Failed to prepare sidebar sessions query: ...`

### UI guidance
- use this as the main left-sidebar payload
- do not assume agent list is complete/final, it is placeholder-like today
- `sessionVisibility: "jarvis-only"` means this list intentionally hides non-Jarvis historical sessions

---

## 4. Suggested frontend project states

Use these simple UI states:
- `loading_projects`
- `empty_projects`
- `projects_ready`
- `creating_project`
- `project_error`
- `loading_project_details`
- `updating_project`
- `archiving_project`
- `loading_project_sidebar`

---

## 5. Suggested frontend forms

## Create project form
Fields:
- `name`
- `profileId`
- `workspaceRoot`
- `repoRoot` optional

Good defaults:
- set `repoRoot = workspaceRoot`
- validate non-empty `name`
- validate non-empty `workspaceRoot`

## Project settings form
Fields:
- `name`
- `workspaceRoot`
- `repoRoot`
- archive toggle or archive action

---

## 6. Example frontend invoke usage

```ts
import { invoke } from "@tauri-apps/api/core";

export async function listProjects() {
  return invoke("middleware_projects_list");
}

export async function createProject(input: {
  name: string;
  profileId: string;
  workspaceRoot: string;
  repoRoot?: string;
}) {
  return invoke("middleware_projects_create", { input });
}

export async function getProject(projectId: string) {
  return invoke("middleware_projects_get", {
    input: { projectId },
  });
}

export async function updateProject(input: {
  projectId: string;
  name?: string;
  workspaceRoot?: string;
  repoRoot?: string;
  archived?: boolean;
}) {
  return invoke("middleware_projects_update", { input });
}

export async function archiveProject(projectId: string, archived = true) {
  return invoke("middleware_projects_archive", {
    input: { projectId, archived },
  });
}

export async function pinProject(projectId: string, pinned = true) {
  return invoke("middleware_projects_pin", {
    input: { projectId, pinned },
  });
}

export async function deleteProject(projectId: string) {
  return invoke("middleware_projects_delete", {
    input: { projectId },
  });
}

export async function getProjectSidebar(projectId: string) {
  return invoke("middleware_projects_sidebar", {
    input: { projectId },
  });
}
```

---

## 7. Current backend limitations

Frontend should know these limits exist today:
- sidebar agent list is currently static
- list API does not include computed repo summary
- no server-side filtering for archived/non-archived project lists yet
- no structured error codes yet, only string messages

---

## 8. Recommended next backend additions

Useful next commands or improvements:
- `middleware_projects_list_active`
- `middleware_projects_list_archived`
- richer `repo` summary in list payload
- better validation errors for bad roots/profile ids
