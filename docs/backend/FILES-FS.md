# FILES-FS.md

Scope: document the current backend/middleware contract for Jarvis file APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`

There are two file API families today:
- project-scoped `middleware_files_*`
- raw-path `middleware_fs_*`

## 1. Project-scoped file APIs

These resolve paths against a Jarvis project/workspace root.

Current Tauri commands:
- `middleware_files_tree`
- `middleware_files_read`
- `middleware_files_write`
- `middleware_files_mkdir`
- `middleware_files_rename`
- `middleware_files_delete`
- `middleware_files_search`

Use these for normal project file manager UI.

### `middleware_files_tree`

Input:
```json
{
  "projectId": "proj_1",
  "path": "/src"
}
```

Response:
```json
{
  "nodes": [
    {
      "name": "index.ts",
      "path": "/src/index.ts",
      "type": "file",
      "size": 1234,
      "modifiedAt": "2026-04-17T21:00:00Z"
    }
  ]
}
```

Notes:
- sorted by name
- `type` is `file` or `directory`

### `middleware_files_read`

Input:
```json
{
  "projectId": "proj_1",
  "path": "/README.md"
}
```

Response:
```json
{
  "file": {
    "path": "/README.md",
    "content": "...",
    "encoding": "utf8"
  }
}
```

Current implementation reads as text.

### `middleware_files_write`

Input:
```json
{
  "projectId": "proj_1",
  "path": "/notes/todo.md",
  "content": "hello"
}
```

Behavior:
- creates parent directories when needed

Response:
```json
{ "ok": true, "path": "/notes/todo.md" }
```

### `middleware_files_mkdir`

Input:
```json
{ "projectId": "proj_1", "path": "/notes" }
```

Response:
```json
{ "ok": true, "path": "/notes" }
```

### `middleware_files_rename`

Input:
```json
{
  "projectId": "proj_1",
  "from": "/old.txt",
  "to": "/new.txt"
}
```

Behavior:
- creates target parent directories when needed

Response:
```json
{ "ok": true, "from": "/old.txt", "to": "/new.txt" }
```

### `middleware_files_delete`

Input:
```json
{ "projectId": "proj_1", "path": "/notes" }
```

Behavior:
- removes file or directory
- directory delete is recursive in current implementation

Response:
```json
{ "ok": true, "path": "/notes" }
```

### `middleware_files_search`

Input:
```json
{
  "projectId": "proj_1",
  "query": "readme"
}
```

Response:
```json
{
  "results": [
    {
      "name": "README.md",
      "path": "/README.md",
      "type": "file",
      "size": 100,
      "modifiedAt": "2026-04-17T21:00:00Z"
    }
  ]
}
```

Notes:
- search is filename-based
- walk depth is currently capped at 6

## 2. Raw filesystem APIs

These operate on direct filesystem paths, not project-relative paths.

Current Tauri commands:
- `middleware_fs_read_dir`
- `middleware_fs_read_file`
- `middleware_fs_write_file`
- `middleware_fs_create_dir`
- `middleware_fs_remove`
- `middleware_fs_rename`
- `middleware_fs_metadata`
- `middleware_fs_search`

Use these only when product explicitly wants absolute-path operations.

### `middleware_fs_read_dir`

Input:
```json
{ "path": "/root/.openclaw/workspace" }
```

Response:
```json
{
  "entries": [
    {
      "name": "Jarvis",
      "path": "/root/.openclaw/workspace/Jarvis",
      "isFile": false,
      "isDir": true,
      "size": null,
      "modifiedAt": "2026-04-17T21:00:00Z"
    }
  ]
}
```

### `middleware_fs_read_file`

Response is text or base64 depending on UTF-8 decode success:
```json
{ "content": "...", "encoding": "utf-8" }
```
or
```json
{ "content": "base64...", "encoding": "base64" }
```

### `middleware_fs_write_file`

Input:
```json
{ "path": "/tmp/test.txt", "content": "hello" }
```

Response:
```json
{ "written": true, "path": "/tmp/test.txt" }
```

### `middleware_fs_create_dir`

Input:
```json
{ "path": "/tmp/demo", "recursive": true }
```

### `middleware_fs_remove`

Input:
```json
{ "path": "/tmp/demo", "recursive": true }
```

Notes:
- non-recursive directory remove fails on non-empty dirs

### `middleware_fs_rename`

Input:
```json
{ "oldPath": "/tmp/a.txt", "newPath": "/tmp/b.txt" }
```

### `middleware_fs_metadata`

Input:
```json
{ "path": "/tmp/b.txt" }
```

Response:
```json
{
  "path": "/tmp/b.txt",
  "isFile": true,
  "isDir": false,
  "size": 5,
  "modifiedAt": "2026-04-17T21:00:00Z",
  "createdAt": "2026-04-17T21:00:00Z"
}
```

### `middleware_fs_search`

Input:
```json
{ "path": "/root/.openclaw/workspace", "query": "jarvis", "maxResults": 100 }
```

Response:
```json
{ "results": [], "query": "jarvis", "count": 0 }
```

## Frontend guidance

Default choice:
- use `middleware_files_*` for project explorer/editor UX
- use `middleware_fs_*` only for advanced admin/system flows

Important product rule:
- do not mix project-relative and raw-path APIs in the same normal user flow without making that distinction clear in UI.
