# TERMINAL-PTY.md

Scope: document the current backend/middleware contract for terminal and PTY APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- local `terminal_sessions` table
- Tauri event stream for PTY output

There are two terminal families today:
- project-aware saved terminals: `middleware_terminal_*`
- generic PTY sessions: `middleware_pty_*`

## Event notes

Terminal/PTY output is event-driven.
Frontend should expect streaming output through Tauri events, not only invoke responses.

## 1. Saved terminal sessions

Commands:
- `middleware_terminal_list`
- `middleware_terminal_create`
- `middleware_terminal_write`
- `middleware_terminal_resize`
- `middleware_terminal_close`

### Terminal object
```json
{
  "id": "term_xxx",
  "projectId": "proj_1",
  "topicId": "topic_1",
  "title": "Terminal",
  "cwd": "/root/.openclaw/workspace/Jarvis",
  "status": "running",
  "lastActiveAt": "2026-04-17T21:00:00Z",
  "runtimeId": "uuid"
}
```

### `middleware_terminal_list`

Input:
```json
{ "projectId": "proj_1" }
```

Response:
```json
{ "terminals": [] }
```

Ordered by `last_active_at DESC`.

### `middleware_terminal_create`

Input:
```json
{
  "projectId": "proj_1",
  "topicId": "topic_1",
  "title": "Server",
  "cwd": "/root/.openclaw/workspace/Jarvis",
  "rows": 30,
  "cols": 120
}
```

Behavior:
- defaults cwd to project workspace root
- defaults title to `Terminal`
- opens native PTY and spawns shell
- stores session in SQLite with `status = running`

Response:
```json
{ "terminal": {} }
```

### `middleware_terminal_write`

Input:
```json
{ "sessionId": "term_xxx", "data": "ls\n" }
```

Response:
```json
{ "ok": true, "sessionId": "term_xxx" }
```

### `middleware_terminal_resize`

Input:
```json
{ "sessionId": "term_xxx", "rows": 40, "cols": 120 }
```

### `middleware_terminal_close`

Input:
```json
{ "sessionId": "term_xxx" }
```

Behavior:
- kills PTY child
- marks persisted terminal status as `closed`

Response:
```json
{ "ok": true, "sessionId": "term_xxx" }
```

## 2. Generic PTY sessions

Commands:
- `middleware_pty_spawn`
- `middleware_pty_write`
- `middleware_pty_resize`
- `middleware_pty_kill`

Use these for lightweight shell panes that do not need DB-backed project session metadata.

### `middleware_pty_spawn`

Input:
```json
{
  "cwd": "/root/.openclaw/workspace/Jarvis",
  "shell": "/bin/bash",
  "rows": 24,
  "cols": 80
}
```

Response:
```json
{
  "ptyId": "pty_xxx",
  "cwd": "/root/.openclaw/workspace/Jarvis"
}
```

Notes:
- cwd defaults to current process dir when omitted
- shell defaults to system shell command

### `middleware_pty_write`

Input:
```json
{ "ptyId": "pty_xxx", "data": "pwd\n" }
```

Response:
```json
{ "written": true, "ptyId": "pty_xxx" }
```

### `middleware_pty_resize`

Input:
```json
{ "ptyId": "pty_xxx", "rows": 40, "cols": 120 }
```

Response:
```json
{ "resized": true, "ptyId": "pty_xxx" }
```

### `middleware_pty_kill`

Input:
```json
{ "ptyId": "pty_xxx" }
```

Response when found:
```json
{ "killed": true, "ptyId": "pty_xxx" }
```

Response when already missing:
```json
{ "killed": false, "ptyId": "pty_xxx" }
```

## Frontend guidance

Use `middleware_terminal_*` when you need:
- project/topic association
- terminal persistence in Jarvis UI
- recents/history list

Use `middleware_pty_*` when you need:
- quick raw shell sessions
- temporary panes
- no DB-backed terminal list

Important UI rule:
- write/resize/kill should always target the correct family
- do not mix `sessionId` and `ptyId`
