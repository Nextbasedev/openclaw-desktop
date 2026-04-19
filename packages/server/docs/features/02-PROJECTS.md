# Feature Migration: Projects

## Overview

Projects are workspaces tied to a profile and a directory on disk. They contain topics, sessions, terminal sessions, and git context.

## Commands

| Command | Args |
|---------|------|
| `middleware_projects_list` | `{}` |
| `middleware_projects_create` | `{ name, profileId, workspaceRoot, repoRoot? }` |
| `middleware_projects_get` | `{ projectId }` |
| `middleware_projects_update` | `{ projectId, name?, workspaceRoot?, repoRoot?, archived? }` |
| `middleware_projects_archive` | `{ projectId, archived? }` |
| `middleware_projects_pin` | `{ projectId, pinned? }` |
| `middleware_projects_delete` | `{ projectId }` |
| `middleware_projects_sidebar` | `{ projectId }` |

## Response Shapes

### Project object

```typescript
interface Project {
  id: string            // "proj_xxxxxxxx"
  name: string
  profileId: string
  workspaceRoot: string
  repoRoot: string | null
  remotes: unknown | null  // parsed JSON
  archived: boolean
  unreadCount: number
  lastActivityAt: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}
```

### projectsList response

```json
{ "projects": [Project, ...] }
```

### projectsGet response

```json
{
  "project": Project,
  "repoSummary": {
    "branch": "main",
    "uncommittedChanges": 3,
    "recentCommits": [{ "hash": "abc", "message": "...", "author": "...", "date": "..." }]
  }
}
```

### projectsSidebar response

```json
{
  "topics": [Topic, ...],
  "sessions": [Session, ...],
  "agents": []
}
```

## Migration

```typescript
// Same as before, just change the import
import { invoke } from "@/lib/ipc"

const { projects } = await invoke("middleware_projects_list")
const { project, repoSummary } = await invoke("middleware_projects_get", {
  projectId: "proj_abc123"
})
```

## Error Cases

- `"Profile not found: {profileId}"` — profileId doesn't exist
- `"Project name already exists for this profile"` — duplicate name per profile
- `"Project not found: {projectId}"` — invalid projectId

## Notes

- `projectsDelete` cascades: deletes all topics, sessions, branches, and terminal sessions for the project
- `repoSummary` in `projectsGet` runs `git` commands — returns `null` if the project directory isn't a git repo
- `remotes` field is parsed JSON from the `remotes_json` DB column
