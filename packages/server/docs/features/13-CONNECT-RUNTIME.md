# Feature Migration: Connect & Runtime

## Connect

Gateway connection management.

| Command | Args |
|---------|------|
| `middleware_connect_status` | `{}` |
| `middleware_connect_test` | `{}` |
| `middleware_connect_reset` | `{}` |

### connectStatus response

```json
{
  "gateway": {
    "configured": true,
    "url": "http://localhost:18789"
  },
  "identity": {
    "configured": true,
    "deviceId": "dev_xxxxxxxx"
  },
  "config": {
    "exists": true,
    "path": "/home/user/.openclaw/openclaw.json"
  }
}
```

### connectTest response

```json
{
  "ready": true,
  "latencyMs": 42
}
```

```typescript
import { invoke } from "@/lib/ipc"

const status = await invoke("middleware_connect_status")
const { ready } = await invoke("middleware_connect_test")
```

**Already migrated in:** `app/connect/page.tsx`

---

## Runtime

Server runtime info and admin access.

| Command | Args |
|---------|------|
| `middleware_runtime_info` | `{}` |
| `middleware_openclaw_bot_name` | `{}` |
| `middleware_openclaw_bot_name_get` | `{}` |
| `middleware_openclaw_bot_name_set` | `{ botName }` |
| `middleware_request_admin_access` | `{ actionId, actionLabel? }` |
| `middleware_approve_admin_access` | `{ actionId }` |

### runtimeInfo response

```json
{
  "contractVersion": "1.0.0",
  "transport": "http",
  "platform": "node",
  "version": "0.0.1"
}
```

**Key difference from Tauri:** `transport` is `"http"` instead of `"ipc"`. Use this to detect which backend the UI is talking to.

```typescript
import { invoke } from "@/lib/ipc"

const info = await invoke("middleware_runtime_info")
if (info.transport === "http") {
  // Running in browser mode with Node.js backend
} else {
  // Running in Tauri with Rust backend
}

const { botName } = await invoke("middleware_openclaw_bot_name_get")
await invoke("middleware_openclaw_bot_name_set", { botName: "Jarvis" })
```
