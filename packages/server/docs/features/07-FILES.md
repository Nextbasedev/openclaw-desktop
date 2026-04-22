# Feature Migration: Files & Filesystem

## Overview

Two sets of file commands:
- **Files** (`middleware_files_*`) — project-scoped, paths relative to `workspaceRoot`
- **Filesystem** (`middleware_fs_*`) — raw absolute paths, no project context

## Project-scoped File Commands

| Command | Args |
|---------|------|
| `middleware_files_tree` | `{ projectId, path }` |
| `middleware_files_read` | `{ projectId, path }` |
| `middleware_files_prepare_attachment` | `{ projectId, path }` |
| `middleware_files_write` | `{ projectId, path, content }` |
| `middleware_files_mkdir` | `{ projectId, path }` |
| `middleware_files_rename` | `{ projectId, from, to }` |
| `middleware_files_delete` | `{ projectId, path }` |
| `middleware_files_search` | `{ projectId, query }` |

**Path resolution:** `path` is joined with the project's `workspaceRoot`. Path traversal (`../`) is blocked.

## Raw Filesystem Commands

| Command | Args |
|---------|------|
| `middleware_fs_read_dir` | `{ path }` |
| `middleware_fs_read_file` | `{ path }` |
| `middleware_fs_prepare_attachment` | `{ path }` |
| `middleware_fs_write_file` | `{ path, content }` |
| `middleware_fs_create_dir` | `{ path, recursive? }` |
| `middleware_fs_remove` | `{ path, recursive? }` |
| `middleware_fs_rename` | `{ oldPath, newPath }` |
| `middleware_fs_metadata` | `{ path }` |
| `middleware_fs_search` | `{ path, query, maxResults? }` |

## Response Shapes

### filesTree / fsReadDir entry

```typescript
interface FileEntry {
  name: string
  path: string       // relative for files_tree, absolute for fs_read_dir
  isDirectory: boolean
  isFile: boolean
  size: number
  modified: string   // ISO 8601
}
```

### filesRead / fsReadFile response

```json
{
  "content": "file contents as string",
  "size": 1234,
  "mimeType": "text/plain"
}
```

### filesPrepareAttachment / fsPrepareAttachment response

```json
{
  "name": "file.txt",
  "mimeType": "text/plain",
  "content": "base64-or-utf8-content",
  "encoding": "utf-8",
  "size": 1234
}
```

Binary files use `"encoding": "base64"`, text files use `"encoding": "utf-8"`.

### fsMetadata response

```json
{
  "size": 1234,
  "isFile": true,
  "isDirectory": false,
  "modified": "2024-01-15T10:30:00.000Z",
  "created": "2024-01-10T08:00:00.000Z"
}
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

// Read project file tree
const { entries } = await invoke("middleware_files_tree", {
  projectId: "proj_abc",
  path: "src/components"
})

// Read a file
const { content } = await invoke("middleware_files_read", {
  projectId: "proj_abc",
  path: "src/index.ts"
})

// Search files by name
const { results } = await invoke("middleware_files_search", {
  projectId: "proj_abc",
  query: "service"
})
```

## Limits

- Max file read size: **50 MB**
- Max search results: **500** entries
- Search depth: **6** levels (project-scoped), **10** levels (raw fs)
- Path traversal (`../`) blocked in project-scoped commands

## Error Cases

- `"File not found"` / `"Directory not found"` — path doesn't exist
- `"File too large"` — exceeds 50 MB
- `"Path traversal not allowed"` — tried to escape workspaceRoot
- `"Project not found"` — invalid projectId
