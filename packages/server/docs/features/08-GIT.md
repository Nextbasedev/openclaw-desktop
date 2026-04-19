# Feature Migration: Git

## Overview

Git commands operate on the repository associated with a project. All commands use `execFileSync`/`execSync` with the project's `repoRoot` or `workspaceRoot` as the working directory.

## Commands

| Command | Args |
|---------|------|
| `middleware_git_remote_add` | `{ projectId, remoteName, remoteUrl }` |
| `middleware_git_remote_list` | `{ projectId }` |
| `middleware_git_remote_remove` | `{ projectId, remoteName }` |
| `middleware_git_context` | `{ projectId, topicId? }` |
| `middleware_git_switch_branch` | `{ projectId, branchName, create? }` |
| `middleware_git_branches` | `{ projectId }` |

## Response Shapes

### gitContext response

```json
{
  "branch": "main",
  "uncommittedChanges": 3,
  "recentCommits": [
    {
      "hash": "abc1234",
      "message": "fix: resolve login bug",
      "author": "Dev Name",
      "date": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### gitBranches response

```json
{
  "local": ["main", "feature/chat", "bugfix/login"],
  "remote": ["origin/main", "origin/feature/chat"],
  "current": "main"
}
```

### gitRemoteList response

```json
{
  "remotes": [
    { "name": "origin", "url": "git@github.com:org/repo.git" }
  ]
}
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

const context = await invoke("middleware_git_context", {
  projectId: "proj_abc"
})
// context.branch, context.uncommittedChanges, context.recentCommits

const { local, remote, current } = await invoke("middleware_git_branches", {
  projectId: "proj_abc"
})

await invoke("middleware_git_switch_branch", {
  projectId: "proj_abc",
  branchName: "feature/new-thing",
  create: true
})
```

## Error Cases

- `"Project not found"` — invalid projectId
- `"Not a git repository"` — project directory is not a git repo
- `"git is not installed"` — git binary not found
- `"Branch already exists"` — `create: true` but branch exists
- Git command failures include the stderr output in the error message

## Notes

- Git operations have a 5-10 second timeout
- `recentCommits` returns the last 10 commits
- `topicId` in `gitContext` stores the detected branch in `topic_git_context` table for later recall
