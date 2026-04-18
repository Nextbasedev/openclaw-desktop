# GIT-CONTEXT.md

Scope: document the backend/middleware contract for Jarvis git context tracking APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware/git.rs`
- local SQLite `topic_git_context` table
- local SQLite `session_mappings` table (session_key -> topic_id, project_id)
- local SQLite `projects` table (workspace_root, repo_root)

Current Tauri commands:
- `middleware_git_context`
- `middleware_git_switch_branch`
- `middleware_git_branches`

Existing Tauri commands (git remotes, unchanged):
- `middleware_git_remote_add`
- `middleware_git_remote_list`
- `middleware_git_remote_remove`

## Overview

The desktop app sidebar shows git information per project and topic. The challenge is that the Gateway has no concept of git -- it only sees tool calls. These commands bridge the gap by:

1. **Passive detection**: Intercepting git-related tool calls in the chat stream loop (`session.tool` events) and recording which branch a topic is working on.
2. **Active queries**: Running git commands against the project's repo to return current branch, uncommitted changes, recent commits, and branch listings.

## Architecture

### Passive git detection (chat stream integration)

When an agent executes a Bash or Terminal tool call containing a git command, the stream loop in `chat.rs` intercepts it:

```
session.tool event arrives
  |
  +-- detect_git_tool_call(data)
  |     Checks: tool name is Bash/Terminal, phase is "invoke", command contains "git "
  |     Parses: subcommand + branch from command args
  |
  +-- If branch detected from command args:
  |     store_git_context_for_session(session_key, branch, command)
  |
  +-- If git command but no branch in args (e.g. "git commit", "git status"):
        detect_current_branch(repo_root) via `git rev-parse --abbrev-ref HEAD`
        store_git_context_for_session(session_key, detected_branch, command)
```

### Git subcommands that extract branch names

| Subcommand | Extraction logic |
|------------|-----------------|
| `checkout`, `switch` | First non-flag arg (skips `-b`, `-c`, etc.) |
| `branch` | First non-flag arg (skipped for `-d`/`-D`/`--delete`) |
| `merge`, `rebase`, `cherry-pick` | First non-flag arg |
| `pull`, `push`, `fetch` | Second non-flag arg (first is remote name) |

All other git commands (commit, status, add, diff, log, etc.) trigger a fallback that reads the current branch from the repo itself.

### SQLite schema

```sql
CREATE TABLE topic_git_context (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  detected_command TEXT,
  detected_at TEXT NOT NULL,
  session_key TEXT,
  UNIQUE(topic_id, branch_name)
);
```

The `UNIQUE(topic_id, branch_name)` constraint means each topic tracks one entry per branch. Repeated commands on the same branch update `detected_command`, `detected_at`, and `session_key` via upsert.

### Helper functions

- `detect_git_tool_call(data)` -- parses session.tool event data, returns `Option<(branch, command)>`
- `extract_branch_from_command(subcommand, parts)` -- extracts branch name from parsed git command parts
- `store_git_context_for_session(session_key, branch, command)` -- resolves session -> topic/project, upserts into topic_git_context
- `detect_current_branch(repo_root)` -- async, runs `git rev-parse --abbrev-ref HEAD`
- `project_repo_root(project_id)` -- shared helper in mod.rs, returns repo_root (falling back to workspace_root)

## `middleware_git_context`

### Input
```json
{
  "projectId": "proj_1",
  "topicId": "topic_1"
}
```

`topicId` is optional. When provided, returns tracked branches for that topic from the database.

### Behavior
1. Resolves project repo root via `project_repo_root(project_id)`
2. Checks if `.git` directory exists
3. Runs `git rev-parse --abbrev-ref HEAD` for current branch
4. Runs `git status --porcelain` for uncommitted changes
5. Runs `git log --oneline -10 --no-decorate` for recent commits
6. If `topicId` provided, queries `topic_git_context` for tracked branches

### Output
```json
{
  "hasGit": true,
  "projectId": "proj_1",
  "topicId": "topic_1",
  "currentBranch": "feat/git-context",
  "uncommittedChanges": [
    { "status": "M", "path": "src/middleware/git.rs" },
    { "status": "??", "path": "src/middleware/git_context_tests.rs" }
  ],
  "uncommittedCount": 2,
  "recentCommits": [
    { "hash": "026cf52", "message": "Add usage API, split middleware into modules, and fix bugs" },
    { "hash": "431060b", "message": "feat: add multi-device sync engine with dual-path I/O" }
  ],
  "trackedBranches": [
    {
      "branchName": "feat/git-context",
      "detectedCommand": "git checkout feat/git-context",
      "detectedAt": "2026-04-18T10:00:00.000Z"
    }
  ],
  "repoRoot": "/root/.openclaw/workspace/Jarvis"
}
```

When `hasGit` is `false`, only `hasGit` and `projectId` are returned.

## `middleware_git_switch_branch`

### Input
```json
{
  "projectId": "proj_1",
  "branchName": "feat/new-feature",
  "create": true
}
```

`create` is optional (defaults to `false`). When `true`, uses `git switch -c` / `git checkout -b`.

### Behavior
1. Resolves project repo root
2. Checks for uncommitted changes via `git status --porcelain`
3. Runs `git switch <branch>` (or `git switch -c <branch>` for create)
4. Falls back to `git checkout` if `git switch` fails (older git versions)
5. Verifies the switch by reading the new current branch

### Output
```json
{
  "switched": true,
  "branch": "feat/new-feature",
  "projectId": "proj_1",
  "hadUncommittedChanges": false
}
```

### Error cases
- No git repo: `"Project has no git repository"`
- Branch doesn't exist (without create): git error message from stderr
- Conflicting uncommitted changes: git error message (switch still attempted -- git itself rejects if unsafe)

## `middleware_git_branches`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Behavior
1. Resolves project repo root
2. Reads current branch via `git rev-parse --abbrev-ref HEAD`
3. Lists local branches via `git branch --format=%(refname:short)`
4. Lists remote branches via `git branch -r --format=%(refname:short)` (filters out HEAD)

### Output
```json
{
  "hasGit": true,
  "current": "feat/git-context",
  "local": ["main", "feat/git-context", "feat/usage-api"],
  "remote": ["origin/main", "origin/feat/git-context"],
  "projectId": "proj_1"
}
```

When `hasGit` is `false`, `current` is `null` and both arrays are empty.

## TypeScript contracts

Defined in `packages/shared/src/api/git.ts`:

| operationId | method | path |
|-------------|--------|------|
| `git.context` | GET | `/api/git/context` |
| `git.switchBranch` | POST | `/api/git/switch-branch` |
| `git.branchesList` | GET | `/api/git/branches-list` |

These extend the existing git endpoints (git.status, git.diff, git.history, git.branches, git.checkout, git.commit).

## Test coverage

- **Rust unit tests** (`middleware/git_context_tests.rs`): 24 tests covering `detect_git_tool_call` (checkout, switch, merge, pull, push, rebase, branch create/delete, piped commands, non-git tools, result phase filtering, Terminal tool support) and `extract_branch_from_command` (all subcommand patterns, flags, edge cases)
- **Rust integration tests** (`middleware/git_context_tests.rs`): 5 tests covering `detect_current_branch` with real temp git repos (init, checkout, no-git-dir) and `store_git_context_for_session` with real SQLite (insert + upsert)
- **TypeScript contract tests** (`shared/src/api/index.test.ts`): gitContext representative parser validates request/response Zod schemas

## Data flow diagram

```
Agent runs "git checkout feature/xyz"
  |
  +-- Gateway sends session.tool event
  |     { name: "Bash", phase: "invoke", args: { command: "git checkout feature/xyz" } }
  |
  +-- chat.rs: spawn_stream_loop intercepts
  |     detect_git_tool_call(data) -> Some(("feature/xyz", "git checkout feature/xyz"))
  |
  +-- git.rs: store_git_context_for_session
  |     session_key -> (topic_id, project_id) from session_mappings
  |     UPSERT into topic_git_context
  |
  +-- Later: sidebar calls middleware_git_context({ projectId, topicId })
        Returns current branch, changes, commits, tracked branches
```
