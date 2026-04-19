# Frontend Migration Guide: Tauri IPC to Node.js HTTP Backend

This guide is for frontend developers who built the UI against the Rust/Tauri backend and need to migrate their branch to work with the new Node.js server (`packages/server`).

---

## TL;DR

1. Replace all `window.__TAURI__.core.invoke(command, args)` calls with `invoke(command, args)` from `@/lib/ipc`
2. Replace all Tauri event listeners with `openEventStream(path, callback)` from `@/lib/ipc`
3. Command names stay the same (`middleware_profiles_list`, etc.)
4. Request/response shapes stay the same (1:1 port of Rust)
5. Run with `pnpm dev:web` instead of `pnpm dev:tauri`

---

## Table of Contents

- [Architecture Change](#architecture-change)
- [Quick Start](#quick-start)
- [Step 1: Replace IPC Calls](#step-1-replace-ipc-calls)
- [Step 2: Replace Event Streaming](#step-2-replace-event-streaming)
- [Step 3: Window Controls](#step-3-window-controls)
- [Step 4: Next.js Config](#step-4-nextjs-config)
- [Step 5: Environment Variables](#step-5-environment-variables)
- [Command Reference](#command-reference)
- [SSE Streaming Reference](#sse-streaming-reference)
- [Response Shape Reference](#response-shape-reference)
- [Error Handling](#error-handling)
- [Running Both Modes](#running-both-modes)
- [Checklist](#checklist)

---

## Architecture Change

```
BEFORE (Tauri):
  Browser ──IPC──> Rust (packages/desktop) ──> SQLite / Gateway

AFTER (Web):
  Browser ──HTTP──> Node.js (packages/server:3001) ──> SQLite / Gateway
                ──SSE───>  (streaming events)

The UI detects which runtime it's in automatically.
Tauri mode still works — zero regression.
```

---

## Quick Start

```bash
# Start the Node.js backend + Next.js frontend
pnpm dev:web

# This runs:
#   packages/server on :3001  (Express API)
#   packages/ui on :3000      (Next.js with proxy rewrites to :3001)
```

---

## Step 1: Replace IPC Calls

### Before (Tauri-specific)

```typescript
// OLD — direct Tauri invoke
const { invoke } = window.__TAURI__.core

const result = await invoke("middleware_profiles_list")
const project = await invoke("middleware_projects_create", {
  name: "My Project",
  profileId: "prof_abc",
  workspaceRoot: "/home/user/code",
})
```

### After (Universal)

```typescript
// NEW — works in Tauri AND browser
import { invoke } from "@/lib/ipc"

const result = await invoke("middleware_profiles_list")
const project = await invoke("middleware_projects_create", {
  name: "My Project",
  profileId: "prof_abc",
  workspaceRoot: "/home/user/code",
})
```

**That's it.** Same function name, same arguments, same return types. The `invoke()` function auto-detects Tauri vs browser:

- **Tauri detected?** Calls `window.__TAURI__.core.invoke()` (same as before)
- **Browser?** Calls `POST http://localhost:3001/api/ipc/{command}` with JSON body

### What to search & replace

Find all of these patterns in your code and replace with the universal import:

```typescript
// REMOVE any of these:
import { invoke } from "@tauri-apps/api/core"
import { invoke } from "@tauri-apps/api/tauri"
const { invoke } = window.__TAURI__.core
const invoke = window.__TAURI__.core.invoke

// REPLACE WITH:
import { invoke } from "@/lib/ipc"
```

### Type-safe invoke

The invoke function is generic — pass your return type:

```typescript
interface ProfilesListResponse {
  profiles: Array<{ id: string; name: string; mode: string }>
}

const result = await invoke<ProfilesListResponse>("middleware_profiles_list")
// result.profiles is typed
```

---

## Step 2: Replace Event Streaming

Chat, terminal, and PTY output use real-time streaming. In Tauri, this was Tauri window events. In the browser, this is Server-Sent Events (SSE).

### Before (Tauri events)

```typescript
// OLD — Tauri event listener
import { listen } from "@tauri-apps/api/event"

const unlisten = await listen("chat-stream-event", (event) => {
  const data = event.payload
  // handle chat event
})

// cleanup
unlisten()
```

### After (Universal)

```typescript
// NEW — works in Tauri AND browser
import { openEventStream } from "@/lib/ipc"

const close = openEventStream(
  "/api/stream/chat/my-session-key",
  (event) => {
    const data = JSON.parse(event.data)
    // handle chat event
  }
)

// cleanup
close()
```

### SSE Endpoints

| Stream | URL Pattern | Use Case |
|--------|-------------|----------|
| Chat | `GET /api/stream/chat/:sessionKey` | Chat message streaming |
| Terminal | `GET /api/stream/terminal/:sessionId` | Terminal output |
| PTY | `GET /api/stream/pty/:ptyId` | Raw PTY output |

### Chat SSE Event Format

```typescript
// Each SSE message has:
//   event: <event-type>
//   data: <JSON payload>

// Event types from chat stream:
interface ChatStreamEvent {
  type: "chat.ready" | "chat.status" | "chat.message" | "chat.tool" | "chat.error"
  sessionKey: string
  // ... type-specific fields
}
```

### Terminal SSE Event Format

```typescript
// Output event
{ sessionId: "term_abc123", data: "$ ls -la\ntotal 42\n..." }

// Exit event
{ sessionId: "term_abc123", code: 0 }
```

### PTY SSE Event Format

```typescript
// Data event
{ ptyId: "pty_abc123", data: "output text here" }

// Exit event
{ ptyId: "pty_abc123" }
```

---

## Step 3: Window Controls

These 3 files use Tauri window management APIs that don't exist in browser mode. They already have `__TAURI_INTERNALS__` guards, so they won't crash in the browser, but they won't do anything either.

| File | What it does | Browser behavior |
|------|-------------|-----------------|
| `components/TrafficLights.tsx` | Mac window buttons (close/min/max) | Buttons render but do nothing |
| `components/WindowControls.tsx` | Windows/Linux window buttons | Buttons render but do nothing |
| `hooks/useAppShortcuts.ts` | Cmd+Q / Ctrl+Q to close | Shortcut is no-op |
| `common/Header/index.tsx` | `data-tauri-drag-region` for window dragging | Attribute is ignored |

**Recommended approach:** Conditionally hide window controls in browser mode:

```typescript
const isTauri = typeof window !== "undefined"
  && !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__

// In your component:
if (!isTauri) return null  // Don't render window controls in browser
```

---

## Step 4: Next.js Config

The `next.config.mjs` already handles dual mode. No changes needed unless you've modified it.

```javascript
// packages/ui/next.config.mjs
const nextConfig = {
  // "export" for Tauri (static HTML), undefined for web (SSR + proxy)
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  images: { unoptimized: true },
  async rewrites() {
    if (process.env.NEXT_OUTPUT === "export") return []
    return [
      // Proxy /api/ipc/* and /api/stream/* to the Node.js server
      { source: "/api/ipc/:path*", destination: "http://localhost:3001/api/ipc/:path*" },
      { source: "/api/stream/:path*", destination: "http://localhost:3001/api/stream/:path*" },
    ]
  },
}
```

**Key:** In browser mode, the Next.js dev server on :3000 proxies API requests to :3001 automatically. Your frontend code doesn't need to know about port 3001.

---

## Step 5: Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:3001` | Backend URL (only needed if server is on a different host/port) |
| `NEXT_OUTPUT` | (unset) | Set to `export` for Tauri static build |
| `JARVIS_SERVER_PORT` | `3001` | Change the backend port |

---

## Command Reference

Every Rust Tauri command has an identical Node.js equivalent. **Same command name, same args, same response shape.**

### Runtime (5 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_runtime_info` | `{}` | `{ contractVersion, transport, ... }` |
| `middleware_openclaw_bot_name` | `{}` | `{ botName }` |
| `middleware_openclaw_bot_name_get` | `{}` | `{ botName }` |
| `middleware_openclaw_bot_name_set` | `{ botName: string }` | `{ ok: true }` |
| `middleware_request_admin_access` | `{ actionId, actionLabel? }` | `{ ok: true }` |
| `middleware_approve_admin_access` | `{ actionId }` | `{ ok: true }` |

### Profiles (8 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_profiles_list` | `{}` | `{ profiles: Profile[] }` |
| `middleware_profiles_create` | `{ name, mode, gatewayUrl, workspaceRoot, token?, isDefault? }` | `{ profile: Profile }` |
| `middleware_profiles_update` | `{ profileId, name?, gatewayUrl?, workspaceRoot?, token?, isDefault? }` | `{ profile: Profile }` |
| `middleware_profiles_delete` | `{ profileId }` | `{ ok: true }` |
| `middleware_profile_token_set` | `{ profileId, token }` | `{ ok: true }` |
| `middleware_profile_token_get` | `{ profileId }` | `{ token: string \| null }` |
| `middleware_profile_token_delete` | `{ profileId }` | `{ ok: true }` |

### Environment (3 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_environment_connect` | `{ profileId }` | `{ connected: true }` |
| `middleware_environment_status` | `{ profileId }` | `{ status, capabilities }` |
| `middleware_environment_detect` | `{ profileId }` | `{ detected: {...} }` |

### Projects (8 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_projects_list` | `{}` | `{ projects: Project[] }` |
| `middleware_projects_create` | `{ name, profileId, workspaceRoot, repoRoot? }` | `{ project: Project }` |
| `middleware_projects_get` | `{ projectId }` | `{ project: Project, repoSummary? }` |
| `middleware_projects_update` | `{ projectId, name?, workspaceRoot?, repoRoot?, archived? }` | `{ project: Project }` |
| `middleware_projects_archive` | `{ projectId, archived? }` | `{ project: Project }` |
| `middleware_projects_pin` | `{ projectId, pinned? }` | `{ project: Project }` |
| `middleware_projects_delete` | `{ projectId }` | `{ ok: true }` |
| `middleware_projects_sidebar` | `{ projectId }` | `{ topics, sessions, agents }` |

### Topics (7 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_topics_list` | `{ projectId }` | `{ topics: Topic[] }` |
| `middleware_topics_create` | `{ projectId, name }` | `{ topic: Topic }` |
| `middleware_topics_update` | `{ topicId, name?, sortOrder? }` | `{ topic: Topic }` |
| `middleware_topics_archive` | `{ topicId, archived? }` | `{ topic: Topic }` |
| `middleware_topics_delete` | `{ topicId }` | `{ ok: true }` |
| `middleware_topics_attach_session` | `{ topicId, sessionKey }` | `{ ok: true }` |
| `middleware_topics_detach_session` | `{ topicId, sessionKey }` | `{ ok: true }` |

### Sessions (4 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_sessions_list` | `{ projectId?, topicId?, includeExisting? }` | `{ sessions: Session[] }` |
| `middleware_sessions_create` | `{ projectId, topicId?, agentId, label, sessionKey }` | `{ session: Session }` |
| `middleware_sessions_update` | `{ sessionKey, label?, pinned?, hidden?, topicId? }` | `{ session: Session }` |
| `middleware_sessions_delete` | `{ sessionKey }` | `{ ok: true }` |

### Branches (7 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_branch_create` | `{ sourceSessionKey, sourceMessageId, projectId, branchName, branchReason?, branchSessionKey }` | `{ branch: Branch }` |
| `middleware_branch_list` | `{ sourceSessionKey }` | `{ branches: Branch[] }` |
| `middleware_branch_get` | `{ branchSessionKey }` | `{ branch: Branch }` |
| `middleware_branch_delete` | `{ branchSessionKey }` | `{ ok: true }` |
| `middleware_branch_from_regenerate` | `{ sourceSessionKey, sourceMessageId, projectId, branchSessionKey }` | `{ branch: Branch }` |
| `middleware_branch_from_edit` | `{ sourceSessionKey, sourceMessageId, projectId, branchSessionKey, newMessage }` | `{ branch: Branch }` |
| `middleware_branch_create_thread` | `{ sourceSessionKey, sourceMessageId, projectId, threadName, branchSessionKey }` | `{ branch: Branch }` |

### Files — Project-scoped (8 commands)

All paths are relative to the project's `workspaceRoot`.

| Command | Args | Response |
|---------|------|----------|
| `middleware_files_tree` | `{ projectId, path }` | `{ entries: FileEntry[] }` |
| `middleware_files_read` | `{ projectId, path }` | `{ content, size, mimeType }` |
| `middleware_files_prepare_attachment` | `{ projectId, path }` | `{ name, mimeType, content, encoding, size }` |
| `middleware_files_write` | `{ projectId, path, content }` | `{ ok: true }` |
| `middleware_files_mkdir` | `{ projectId, path }` | `{ ok: true }` |
| `middleware_files_rename` | `{ projectId, from, to }` | `{ ok: true }` |
| `middleware_files_delete` | `{ projectId, path }` | `{ ok: true }` |
| `middleware_files_search` | `{ projectId, query }` | `{ results: string[] }` |

### Filesystem — Raw/Absolute (9 commands)

All paths are absolute filesystem paths.

| Command | Args | Response |
|---------|------|----------|
| `middleware_fs_read_dir` | `{ path }` | `{ entries: FsEntry[] }` |
| `middleware_fs_read_file` | `{ path }` | `{ content, size, mimeType }` |
| `middleware_fs_prepare_attachment` | `{ path }` | `{ name, mimeType, content, encoding, size }` |
| `middleware_fs_write_file` | `{ path, content }` | `{ ok: true }` |
| `middleware_fs_create_dir` | `{ path, recursive? }` | `{ ok: true }` |
| `middleware_fs_remove` | `{ path, recursive? }` | `{ ok: true }` |
| `middleware_fs_rename` | `{ oldPath, newPath }` | `{ ok: true }` |
| `middleware_fs_metadata` | `{ path }` | `{ size, isFile, isDirectory, modified, created }` |
| `middleware_fs_search` | `{ path, query, maxResults? }` | `{ results: string[] }` |

### Git (6 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_git_remote_add` | `{ projectId, remoteName, remoteUrl }` | `{ ok: true }` |
| `middleware_git_remote_list` | `{ projectId }` | `{ remotes: { name, url }[] }` |
| `middleware_git_remote_remove` | `{ projectId, remoteName }` | `{ ok: true }` |
| `middleware_git_context` | `{ projectId, topicId? }` | `{ branch, uncommittedChanges, recentCommits }` |
| `middleware_git_switch_branch` | `{ projectId, branchName, create? }` | `{ ok: true, branch }` |
| `middleware_git_branches` | `{ projectId }` | `{ local: string[], remote: string[], current }` |

### Memory (7 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_memory_list` | `{ projectId? }` | `{ files: MemoryFile[] }` |
| `middleware_memory_read` | `{ path, startLine?, endLine? }` | `{ content, totalLines }` |
| `middleware_memory_write` | `{ path, content, category?, importance? }` | `{ ok: true, path }` |
| `middleware_memory_search` | `{ query, limit? }` | `{ results: [] }` (stub) |
| `middleware_memory_store` | `{ content, category?, importance?, tags? }` | `{ ok: true, path }` |
| `middleware_memory_recall` | `{ path?, limit? }` | `{ entries: MemoryEntry[] }` |
| `middleware_memory_reindex` | `{}` | `{ ok: true }` (stub) |

### Skills (2 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_skills_discover` | `{ query?, limit?, includeLocal?, includeClawHub?, includeGithubProbe? }` | `{ skills: Skill[] }` |
| `middleware_skills_install` | `{ source, slug?, version?, repoUrl?, gitRef?, localPath?, scope?, force? }` | `{ ok: true, skill }` |

### Chat (7 commands) — Gateway Required

| Command | Args | Response |
|---------|------|----------|
| `middleware_chat_create_session` | `{ label?, model?, agentId?, verboseLevel? }` | `{ sessionKey, ... }` |
| `middleware_chat_delete_session` | `{ sessionKey }` | `{ ok: true }` |
| `middleware_chat_send` | `{ sessionKey, text, timeoutMs?, attachments? }` | `{ accepted, sessionKey, runId, status }` |
| `middleware_chat_stop` | `{ sessionKey }` | `{ stopped: true, sessionKey }` |
| `middleware_chat_history` | `{ sessionKey }` | `{ messages: Message[] }` |
| `middleware_chat_edit_and_resend` | `{ sessionKey, messageId, text }` | `{ accepted, editedMessageId, action }` |
| `middleware_chat_regenerate` | `{ sessionKey, messageId }` | `{ accepted, regeneratedMessageId, action }` |

**Attachment format for `middleware_chat_send`:**
```typescript
{
  attachments: [
    {
      name: "file.txt",
      mimeType: "text/plain",
      content: "base64-or-utf8-string",
      encoding: "utf-8" | "base64",
      size: 1234
    }
  ]
}
// Limits: max 10 attachments, max 50MB each, max 100MB total
```

### Cron (12 commands) — Gateway Required

| Command | Args | Response |
|---------|------|----------|
| `middleware_cron_list_jobs` | `{}` | `{ jobs: CronJob[] }` |
| `middleware_cron_get_job` | `{ jobId }` | `{ job: CronJob }` |
| `middleware_cron_create_job` | `{ name, schedule, task, params?, enabled?, metadata? }` | `{ job: CronJob }` |
| `middleware_cron_update_job` | `{ jobId, name?, schedule?, task?, params?, enabled?, metadata? }` | `{ job: CronJob }` |
| `middleware_cron_delete_job` | `{ jobId }` | `{ ok: true }` |
| `middleware_cron_run_job` | `{ jobId, params? }` | `{ run: CronRun }` |
| `middleware_cron_job_status` | `{ jobId }` | `{ job: CronJob, lastRun? }` |
| `middleware_cron_list_runs` | `{ jobId, limit?, sortDir?, afterTs? }` | `{ runs: CronRun[] }` |
| `middleware_cron_get_run` | `{ jobId, runId }` | `{ run: CronRun }` |
| `middleware_cron_pause_job` | `{ jobId, paused }` | `{ job: CronJob }` |
| `middleware_cron_poll_run_completion` | `{ jobId, afterTs, timeoutMs?, intervalMs? }` | `{ run: CronRun }` |
| `middleware_cron_create_notification_job` | `{ name, schedule, notificationMessage, sessionKey }` | `{ job: CronJob }` |

### Sync (4 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_sync_status` | `{}` | `{ breakdown: {...}, tombstones }` |
| `middleware_sync_mark_clean` | `{ table, ids }` | `{ ok: true, updated }` |
| `middleware_sync_purge_tombstones` | `{}` | `{ ok: true, deleted }` |
| `middleware_sync_set_device_id` | `{ deviceId }` | `{ ok: true }` |

### Usage (4 commands) — Gateway Required

| Command | Args | Response |
|---------|------|----------|
| `middleware_usage_current` | `{}` | `{ usage: UsageSnapshot }` |
| `middleware_usage_history` | `{ period? }` | `{ history: UsageEntry[] }` |
| `middleware_usage_limits` | `{}` | `{ limits: UsageLimits }` |
| `middleware_usage_estimate` | `{ model?, tokens? }` | `{ estimate: CostEstimate }` |

### Onboarding (22 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_onboarding_status` | `{}` | `{ step, completed }` |
| `middleware_onboarding_set_step` | `{ step }` | `{ ok: true }` |
| `middleware_onboarding_complete` | `{}` | `{ ok: true }` |
| `middleware_onboarding_reset` | `{}` | `{ ok: true }` |
| `middleware_onboarding_check_gateway` | `{}` | `{ available, url }` |
| `middleware_onboarding_check_identity` | `{}` | `{ hasIdentity, deviceId? }` |
| `middleware_onboarding_check_workspace` | `{}` | `{ exists, path }` |
| `middleware_onboarding_validate_gateway_url` | `{ url }` | `{ valid, reachable }` |
| `middleware_onboarding_create_workspace` | `{}` | `{ created, path }` |
| `middleware_onboarding_check_dependencies` | `{}` | `{ deps: DependencyCheck[] }` |
| `middleware_onboarding_save_gateway_config` | `{ gatewayUrl }` | `{ ok: true }` |
| `middleware_onboarding_generate_identity` | `{}` | `{ deviceId }` |
| `middleware_onboarding_core` | `{ action?, gatewayUrl? }` | `{ snapshot: OnboardingSnapshot }` |
| `middleware_onboarding_providers` | `{}` | `{ providers: ProviderSummary[] }` |
| `middleware_onboarding_provider_types` | `{}` | `{ types: string[] }` |
| `middleware_onboarding_provider_details` | `{ providerId }` | `{ provider: ProviderDetails }` |
| `middleware_onboarding_provider_submit` | `{ providerId, authMethod, fields }` | `{ ok: true }` |
| `middleware_onboarding_model_contract` | `{ providerId? }` | `{ contract: ModelContract }` |
| `middleware_onboarding_model_submit` | `{ providerId, modelId, displayName? }` | `{ ok: true }` |
| `middleware_onboarding_flow` | `{ action?, gatewayUrl? }` | `{ flow: OnboardingFlow }` |
| `middleware_onboarding_sign_out` | `{}` | `{ ok: true }` |
| `middleware_onboarding_delete_account` | `{}` | `{ ok: true }` |

### Connect (3 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_connect_status` | `{}` | `{ gateway, identity, config }` |
| `middleware_connect_test` | `{}` | `{ ready, latencyMs? }` |
| `middleware_connect_reset` | `{}` | `{ ok: true }` |

### Terminal (5 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_terminal_create` | `{ projectId, topicId?, cwd?, title?, cols?, rows? }` | `{ terminal: Terminal }` |
| `middleware_terminal_list` | `{ projectId }` | `{ terminals: Terminal[] }` |
| `middleware_terminal_write` | `{ sessionId, data }` | `{ ok: true }` |
| `middleware_terminal_resize` | `{ sessionId, cols, rows }` | `{ ok: true }` |
| `middleware_terminal_close` | `{ sessionId }` | `{ ok: true, sessionId }` |

### PTY — Ephemeral (4 commands)

| Command | Args | Response |
|---------|------|----------|
| `middleware_pty_spawn` | `{ cwd?, cols?, rows? }` | `{ ptyId, cwd }` |
| `middleware_pty_write` | `{ ptyId, data }` | `{ ok: true }` |
| `middleware_pty_resize` | `{ ptyId, cols, rows }` | `{ ok: true }` |
| `middleware_pty_kill` | `{ ptyId }` | `{ ok: true, ptyId }` |

---

## SSE Streaming Reference

### Connecting to a stream

```typescript
import { openEventStream } from "@/lib/ipc"

// Chat streaming
const close = openEventStream(
  `/api/stream/chat/${sessionKey}`,
  (event) => {
    const data = JSON.parse(event.data)
    switch (data.type) {
      case "chat.ready":
        // Session is ready
        break
      case "chat.message":
        // New message chunk: data.content
        break
      case "chat.tool":
        // Tool use event
        break
      case "chat.status":
        // Status change: data.state ("thinking", "done", "error")
        break
      case "chat.error":
        // Error: data.message
        break
    }
  }
)

// Terminal output streaming
const closeTerminal = openEventStream(
  `/api/stream/terminal/${sessionId}`,
  (event) => {
    const data = JSON.parse(event.data)
    // data.sessionId, data.data (terminal output text)
  }
)

// PTY output streaming
const closePty = openEventStream(
  `/api/stream/pty/${ptyId}`,
  (event) => {
    const data = JSON.parse(event.data)
    // data.ptyId, data.data (raw PTY output)
  }
)

// Always clean up when component unmounts
close()
```

### SSE vs Tauri Events

| Tauri Event | SSE Equivalent |
|-------------|---------------|
| `listen("chat-stream", cb)` | `openEventStream("/api/stream/chat/:key", cb)` |
| `listen("terminal-output", cb)` | `openEventStream("/api/stream/terminal/:id", cb)` |
| `listen("pty-output", cb)` | `openEventStream("/api/stream/pty/:id", cb)` |

---

## Error Handling

### HTTP error responses

All errors return status 500 with:
```json
{ "error": "Human-readable error message" }
```

Unknown commands return 404:
```json
{ "error": "Unknown command: middleware_nonexistent" }
```

### Gateway errors

Commands that need the OpenClaw Gateway (chat, cron, usage) return:
```json
{ "error": "Gateway not connected. Start the OpenClaw Gateway first." }
```

### Using with try/catch

```typescript
import { invoke } from "@/lib/ipc"

try {
  const result = await invoke("middleware_projects_create", {
    name: "My Project",
    profileId: "prof_123",
    workspaceRoot: "/path/to/code",
  })
  // success
} catch (error) {
  // error.message contains the server's error message
  console.error(error.message)
  // e.g. "Profile not found: prof_123"
  // e.g. "Project name already exists"
  // e.g. "Gateway not connected. Start the OpenClaw Gateway first."
}
```

---

## Running Both Modes

### Web mode (browser)

```bash
pnpm dev:web
# Opens http://localhost:3000 in browser
# Node.js server runs on http://localhost:3001
# Next.js proxies /api/* to :3001
```

### Tauri mode (desktop) — unchanged

```bash
NEXT_OUTPUT=export pnpm dev:tauri
# Tauri desktop app, Rust backend
# UI calls window.__TAURI__.core.invoke() directly
# No Node.js server involved
```

### Tauri production build

```bash
NEXT_OUTPUT=export pnpm build:tauri
```

---

## Checklist

Use this checklist for each UI feature you're migrating:

- [ ] **Replace Tauri invoke imports** with `import { invoke } from "@/lib/ipc"`
- [ ] **Replace Tauri event listeners** with `openEventStream()` from `@/lib/ipc`
- [ ] **Remove `__TAURI_INTERNALS__` guards** around IPC calls (the universal invoke handles detection)
- [ ] **Keep `__TAURI_INTERNALS__` guards** for window-specific features (TrafficLights, WindowControls, drag region)
- [ ] **Test in browser** — run `pnpm dev:web` and verify your feature works at `localhost:3000`
- [ ] **Test in Tauri** — run `pnpm dev:tauri` and verify no regression
- [ ] **Verify SSE streams** work for any real-time features (chat, terminal)
- [ ] **Check error handling** — errors now come as thrown exceptions, not Tauri error objects

### Already migrated (no changes needed)

These files are already using the universal `invoke()`:

- [x] `components/onboarding/useOnboardingFlow.ts`
- [x] `app/connect/page.tsx`
- [x] `components/SkillPage/index.tsx`

### Still need migration

These files still import from `@tauri-apps/api`:

- [ ] `components/TrafficLights.tsx` — window minimize/maximize/close
- [ ] `components/WindowControls.tsx` — window minimize/maximize/close
- [ ] `hooks/useAppShortcuts.ts` — Cmd+Q keyboard shortcut
- [ ] `common/Header/index.tsx` — `data-tauri-drag-region` attribute (CSS only, harmless in browser)

### Files to search for remaining Tauri references

```bash
# Find all remaining Tauri references in packages/ui
grep -rn "@tauri-apps" packages/ui/
grep -rn "__TAURI__" packages/ui/
grep -rn "invoke(" packages/ui/ --include="*.ts" --include="*.tsx"
```
