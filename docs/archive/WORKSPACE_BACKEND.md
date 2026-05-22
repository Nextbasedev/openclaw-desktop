# Workspace Implementation Plan

## Goal

Implement a dashboard-accessible workspace feature in another project using the same model as Ampere:

- the workspace lives on the user's remote runtime
- the web app does not keep a cloned copy
- the app exposes a live remote filesystem API
- all file operations proxy into the user's workspace directory on the remote machine

---

## Core Decision

This workspace should be implemented as a remote filesystem proxy, not as a local clone, sync cache, or replica.

### Mental Model

> "The frontend talks to the app API. The app API calls a backend execution service. That service runs commands on the user's remote runtime and reads or writes files inside the user's workspace directory."

---

## High-Level Architecture

```text
Frontend
  -> App API
  -> Backend execution/orchestrator service
  -> Remote host/container/VM
  -> Workspace directory on remote machine
```

### Responsibilities

| Layer | Responsibility |
|---|---|
| Frontend | File tree, editor, upload/download UI |
| App API | Auth, path validation, API shaping |
| Execution Service | Resolve user runtime, execute commands remotely |
| Remote Runtime | Actual source of truth for files |
| Workspace Directory | Persistent user data and project files |

---

## Workspace Location

Pick one canonical remote path, for example:

```bash
/home/app/workspace
```

or

```bash
/root/.app/workspace
```

Everything in the workspace API should operate only inside this directory.

---

## Non-Goals

This implementation should not do any of the following initially:

- store a second workspace copy in the API service
- mirror files into a database
- support offline sync
- support conflict resolution
- support git-aware diff or merge logic
- support large file streaming beyond basic limits

---

## API Endpoints To Build

Recommended endpoints:

- `GET /api/my/workspace/tree`
- `GET /api/my/workspace/stat/*`
- `GET /api/my/workspace/files/*`
- `PUT /api/my/workspace/files/*`
- `DELETE /api/my/workspace/files/*`
- `POST /api/my/workspace/move`
- `POST /api/my/workspace/mkdir`
- `DELETE /api/my/workspace/dir/*`
- `GET /api/my/workspace/download/*`
- `GET /api/my/workspace/download-dir/*`

Optional later:

- `POST /api/my/workspace/upload`
- `POST /api/my/workspace/clone-repo`
- `POST /api/my/workspace/search`
- `GET /api/my/workspace/templates`

---

## Endpoint Behavior

### `GET /api/my/workspace/tree`

Purpose:
- list files and directories under the workspace

Implementation:
- resolve real workspace base path
- run `find`
- return structured metadata

Suggested fields:
- `path`
- `type`
- `size`
- `mtime`

### `GET /api/my/workspace/stat/*`

Purpose:
- return metadata for one file or directory

Implementation:
- run `stat`
- return:
  - file or dir type
  - size
  - modified time

### `GET /api/my/workspace/files/*`

Purpose:
- read file contents

Implementation:
- validate path
- base64-encode file remotely
- decode in API service
- return:
  - UTF-8 text for text files
  - base64 payload for binary files

### `PUT /api/my/workspace/files/*`

Purpose:
- write or replace a file

Implementation:
- validate path and size
- base64-encode request payload
- create parent directory if needed
- write temp file remotely
- decode temp file into final file path

### `DELETE /api/my/workspace/files/*`

Purpose:
- delete one file

Implementation:
- validate path
- remove file only if it exists and is a regular file

### `POST /api/my/workspace/move`

Purpose:
- rename or move files or directories

Input:

```json
{
  "from": "docs/a.md",
  "to": "archive/a.md"
}
```

Implementation:
- validate both paths
- ensure destination parent exists
- run `mv`

### `POST /api/my/workspace/mkdir`

Purpose:
- create a directory

Input:

```json
{
  "path": "notes/daily"
}
```

Implementation:
- validate path
- run `mkdir -p`

### `DELETE /api/my/workspace/dir/*`

Purpose:
- delete a directory

Implementation:
- validate path
- optionally require directory to be empty first
- or allow recursive delete only with strong safeguards

### `GET /api/my/workspace/download/*`

Purpose:
- download a single file

Implementation:
- validate path
- base64-encode remotely
- decode and return bytes with proper content type

### `GET /api/my/workspace/download-dir/*`

Purpose:
- download a directory as archive

Implementation:
- validate path
- check total size
- run:

```bash
tar -czf - -C '<workspace-base>' '<dir>' | base64 -w 0
```

- decode and return `.tar.gz`

---

## Backend Execution Flow

For every workspace request:

1. authenticate user
2. resolve the user's runtime, instance, or container
3. verify runtime is running
4. construct a safe command
5. execute command remotely
6. parse stdout and stderr
7. return structured API response

---

## Provisioning And Workspace Creation

The workspace should be created during user runtime provisioning, not lazily by the dashboard.

### Initial Seed Files

Recommended starter files:

- `IDENTITY.md`
- `README.md`
- `NOTES.md`
- `PROJECT.md`

Optional:

- `USER.md`
- `MEMORY.md`
- `TASKS.md`

This gives every workspace a predictable structure from day one.

---

## Repo Clone Behavior

If a repo is cloned, it should be cloned inside the remote workspace, for example:

```bash
/home/app/workspace/my-repo
```

Important:

- the cloned repo is stored only on the remote runtime
- the API service does not keep its own copy
- after clone, the repo just appears as another folder in the workspace tree

Optional future endpoint:

### `POST /api/my/workspace/clone-repo`

Input:

```json
{
  "repoUrl": "https://github.com/org/repo.git",
  "targetDir": "my-repo"
}
```

Execution:

- validate URL and target dir
- run clone inside workspace
- return status or logs

---

## Security Rules

### Path Safety

All paths must:

- stay relative to workspace root
- reject `..`
- reject `~`
- reject null bytes
- reject shell metacharacter abuse
- enforce max path length

### File Safety

Recommended:

- block reading secrets like:
  - `.env`
  - `.pem`
  - `.key`
  - `.p12`
- optionally restrict writable extensions
- enforce file size limits

### Runtime Safety

- only allow operations for the authenticated user's own runtime
- do not allow arbitrary shell exec from frontend
- do not expose raw SSH access through the API
- timeout remote commands
- log all write, delete, and move actions

---

## Limits

Recommended starting limits:

- text write: 5 MB
- binary write: 10 MB
- directory download: 100 MB
- command timeout: 30s to 300s depending on operation

---

## Suggested Implementation Phases

### Phase 1: Read-Only Workspace

Build:

- tree
- stat
- file read
- file download

Outcome:
- users can browse and inspect files safely

### Phase 2: Basic Editing

Build:

- write file
- move file
- mkdir
- delete file
- delete directory

Outcome:
- users can fully manage workspace content

### Phase 3: Project Workflows

Build:

- repo clone endpoint
- upload endpoint
- templates
- search
- archive import or export

Outcome:
- workspace becomes useful for real coding and project tasks

### Phase 4: Advanced Features

Optional later:

- streaming large file reads
- background jobs for clone or archive extraction
- git status support
- diff preview
- version history
- snapshot or export API
- object-storage caching

---

## Observability

Log these events:

- workspace tree read
- file read
- file write
- file delete
- file move
- mkdir
- directory delete
- download file
- download dir
- clone repo

Suggested log fields:

- userId
- instanceId or runtimeId
- path
- action
- durationMs
- success or failure
- error message

---

## Testing Checklist

### API Tests

- rejects unauthenticated requests
- rejects invalid paths
- blocks path traversal
- reads text file correctly
- writes file correctly
- moves file correctly
- deletes file correctly
- downloads directory correctly

### Integration Tests

- remote command executes in correct runtime
- workspace root cannot be escaped
- large files are rejected by limits
- instance not running returns clean error

### Manual QA

- open workspace tree
- edit markdown file
- create folder
- rename file
- download folder
- clone repo into workspace
- refresh UI and confirm live state

---

## Key Tradeoffs

### Strengths

- simple architecture
- single source of truth
- no sync conflicts
- always shows latest remote state

### Constraints

- every operation depends on remote runtime health
- latency is higher than local disk access
- large file operations are expensive
- shell command construction must be very careful

---

## Recommended Team Wording

Use this wording in docs and reviews:

> "The workspace feature is a live remote filesystem API. It does not clone the workspace into the web app. It proxies file operations into the user's workspace directory on the remote runtime."

---

## Future Upgrade Path

If the product later needs real sync or mirroring:

1. keep remote workspace as source of truth
2. add full workspace snapshot export
3. optionally cache snapshot in object storage
4. add version metadata
5. define conflict rules before two-way sync

---

## Final Summary

This project should implement workspace as:

- a remote persistent directory on the user's runtime
- exposed through authenticated API endpoints
- executed through a backend remote-command layer
- treated as a live filesystem proxy, not a local clone
