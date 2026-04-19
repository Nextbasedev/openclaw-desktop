# Feature Migration: Terminal & PTY

## Overview

Two terminal services:
- **Terminal** — project-bound terminal sessions persisted in SQLite, with title/status tracking
- **PTY** — ephemeral pseudo-terminal sessions, no DB persistence

Both use `node-pty` for real shell access. Both stream output via SSE.

## Terminal Commands (project-bound)

| Command | Args |
|---------|------|
| `middleware_terminal_create` | `{ projectId, topicId?, cwd?, title?, cols?, rows? }` |
| `middleware_terminal_list` | `{ projectId }` |
| `middleware_terminal_write` | `{ sessionId, data }` |
| `middleware_terminal_resize` | `{ sessionId, cols, rows }` |
| `middleware_terminal_close` | `{ sessionId }` |

### Terminal object

```typescript
interface Terminal {
  id: string           // "term_xxxxxxxx"
  projectId: string
  topicId: string | null
  title: string        // default "Terminal"
  cwd: string          // defaults to project workspaceRoot
  status: string       // "running" | "closed"
  lastActiveAt: string
  runtimeId: string    // "rt_xxxxxxxx"
}
```

### terminalCreate defaults

- `cols`: 120
- `rows`: 30
- `title`: "Terminal"
- `cwd`: project's workspaceRoot

## PTY Commands (ephemeral)

| Command | Args |
|---------|------|
| `middleware_pty_spawn` | `{ cwd?, cols?, rows? }` |
| `middleware_pty_write` | `{ ptyId, data }` |
| `middleware_pty_resize` | `{ ptyId, cols, rows }` |
| `middleware_pty_kill` | `{ ptyId }` |

### ptySpawn defaults

- `cols`: 80
- `rows`: 24
- `cwd`: server's `process.cwd()`
- Shell: `$SHELL` env var or `/bin/sh`

## Streaming Output (Critical)

### Before (Tauri)

In Tauri, terminal output came through Tauri window events:

```typescript
import { listen } from "@tauri-apps/api/event"

const unlisten = await listen("terminal-output", (event) => {
  const { sessionId, data } = event.payload
  appendToXterm(data)
})
```

### After (Browser SSE)

```typescript
import { invoke, openEventStream } from "@/lib/ipc"

// 1. Create terminal
const { terminal } = await invoke("middleware_terminal_create", {
  projectId: "proj_abc",
  title: "Build"
})

// 2. Subscribe to output stream
const close = openEventStream(
  `/api/stream/terminal/${terminal.id}`,
  (event) => {
    const data = JSON.parse(event.data)
    // data.sessionId — terminal session ID
    // data.data — terminal output text
    xterm.write(data.data)
  }
)

// 3. Write user input
await invoke("middleware_terminal_write", {
  sessionId: terminal.id,
  data: "npm run build\n"
})

// 4. Resize on viewport change
await invoke("middleware_terminal_resize", {
  sessionId: terminal.id,
  cols: 200,
  rows: 50
})

// 5. Close terminal
await invoke("middleware_terminal_close", { sessionId: terminal.id })
close() // stop SSE stream
```

### PTY Streaming

```typescript
const { ptyId } = await invoke("middleware_pty_spawn", {
  cwd: "/home/user/code",
  cols: 120,
  rows: 40
})

const close = openEventStream(
  `/api/stream/pty/${ptyId}`,
  (event) => {
    const data = JSON.parse(event.data)
    // data.ptyId, data.data
    xterm.write(data.data)
  }
)

await invoke("middleware_pty_write", { ptyId, data: "ls -la\n" })

// Cleanup
await invoke("middleware_pty_kill", { ptyId })
close()
```

## SSE Event Formats

### Terminal output event

```json
{ "sessionId": "term_abc123", "data": "$ ls -la\nfile1.txt\nfile2.txt\n" }
```

### Terminal exit event

```json
{ "sessionId": "term_abc123", "code": 0 }
```

### PTY data event

```json
{ "ptyId": "pty_abc123", "data": "output text" }
```

### PTY exit event

```json
{ "ptyId": "pty_abc123" }
```

## Limits

- Max **20 active sessions** (shared between terminal and PTY)
- Terminal sessions persist in DB even after process exits (status changes to "closed")
- PTY sessions are fully ephemeral — no DB records

## Error Cases

- `"Project not found"` — invalid projectId
- `"Directory not found"` / `"Not a directory"` — invalid cwd
- `"Maximum session limit reached (20)"` — too many active terminals
- `"Terminal session not found or not active"` — session doesn't exist or already closed
- `"PTY not found"` — ptyId doesn't exist

## Notes

- Terminal auto-detects shell from `$SHELL` env var, falls back to `/bin/sh`
- When a terminal process exits naturally, the server emits an exit event and cleans up automatically
- `terminalList` returns ALL sessions (including closed), ordered by `lastActiveAt` DESC
