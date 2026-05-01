# PRD: OpenClaw Desktop New Architecture — External Node.js Middleware Service

## 1. Summary

OpenClaw Desktop will move from a bundled/local backend architecture to a thin desktop/web client that connects to a separately deployed **Node.js Middleware Service**.

The Desktop app will primarily be a UI shell. The Middleware Service will run near the user's OpenClaw/Gateway environment, usually on the same VPS, and will own filesystem-aware features such as git, terminal, workspace files, project discovery, and OpenClaw Gateway orchestration.

Important context: the backend layer is now **Node.js/TypeScript**, not Rust. Rust remains only the Tauri desktop shell.

## 2. Problem

The current app has too many runtime parts inside one repo/app:

- Tauri/Rust desktop shell
- Next.js UI dev/build server
- Node.js server backend
- local `middleware` workspace package
- OpenClaw Gateway connection
- local SQLite state
- generated `dist` build coupling between packages

This causes repeated issues:

- Desktop startup waits on `localhost:3000`.
- Server startup depends on built middleware `dist`.
- Local vs remote behavior is confusing.
- Git can accidentally show local machine state when user expects remote VPS state.
- Remote terminal cannot work properly without a service running on the remote machine.
- General architecture is hard to reason about and hard to package cleanly.

## 3. Goals

### Product goals

- Make OpenClaw Desktop simple: install app, enter Middleware URL/token, use it.
- Make remote VPS control first-class.
- Make git, terminal, and workspace features operate against the correct machine.
- Allow Desktop web version and Desktop Tauri version to share the same backend contract.
- Enable us to update/control the VPS-side service independently from the Desktop app.

### Technical goals

- Extract backend responsibilities into a separate Node.js/TypeScript middleware service.
- Remove `packages/middleware` from `openclaw-desktop` as an internal workspace dependency.
- Remove local Express backend as a required production runtime for Desktop.
- Replace local IPC/backend calls with HTTP/SSE/WebSocket calls to Middleware Service.
- Keep Rust limited to Tauri shell responsibilities.

## 4. Non-goals

- Do not rewrite the UI from scratch.
- Do not rewrite OpenClaw/Gateway immediately.
- Do not require GitHub/GitLab API tokens for git status.
- Do not make Rust own backend/business logic.
- Do not make remote terminal work by SSHing directly from Desktop.
- Do not remove the possibility of local/self-hosted middleware; local mode can still be supported by running middleware locally.

## 5. Target Architecture

### 5.1 Repositories

#### `openclaw-desktop`

Responsibilities:

- Tauri shell
- Next.js/React UI
- settings/onboarding screens
- HTTP/SSE/WebSocket client for Middleware Service
- secure local storage of Middleware URL/token
- rendering chat/git/workspace/terminal/skills/usage UI

Should not own:

- git command execution
- PTY/terminal execution
- OpenClaw Gateway protocol details
- VPS filesystem reads/writes
- project discovery on remote machine
- middleware package build/dist lifecycle

#### `openclaw-middleware` / new repo name TBD

Responsibilities:

- Node.js/TypeScript service
- Auth/token validation
- OpenClaw Gateway client connection
- project/profile/session metadata
- git status/diff/branch operations on VPS/local host
- PTY terminal on VPS/local host
- workspace file tree/read/write
- repo discovery/clone/select
- chat/session proxying where useful
- health/version/status endpoints
- installer/bootstrap script

## 6. User Experience

### 6.1 First run Desktop onboarding

Desktop shows:

1. Connect to Middleware
2. Middleware URL input
3. Token input
4. Test connection button
5. Save and continue

If user does not have Middleware:

- Show “Install Middleware on your VPS”
- Provide one copy command:

```bash
curl -fsSL https://<domain>/install-middleware.sh | bash
```

Installer prints:

```text
Middleware installed.
URL: https://your-vps-domain-or-ip:<port>
Token: <generated-token>
```

User pastes URL/token into Desktop.

### 6.2 Normal app usage

After connection:

- Projects listed from Middleware.
- Git tab shows repo state from Middleware host.
- Terminal opens shell on Middleware host.
- Workspace file browser shows Middleware/OpenClaw workspace.
- Chat routes through Middleware/OpenClaw Gateway as needed.

### 6.3 Local usage

For users running everything on one machine:

- They may install Middleware locally.
- Desktop connects to `http://127.0.0.1:<port>`.
- Behavior is identical, just local.

No separate “local vs remote mode” should be needed in Desktop. The Middleware URL defines the execution environment.

## 7. Core API Contract

All APIs require token auth:

```http
Authorization: Bearer <token>
```

### 7.1 Health

```http
GET /health
```

Returns:

```json
{
  "ok": true,
  "version": "0.1.0",
  "host": "vps-name",
  "openclaw": {
    "connected": true,
    "gatewayUrl": "ws://127.0.0.1:18789"
  }
}
```

### 7.2 Projects

```http
GET /api/projects
POST /api/projects
PATCH /api/projects/:projectId
DELETE /api/projects/:projectId
```

Project shape:

```json
{
  "id": "proj_x",
  "name": "openclaw-desktop",
  "workspaceRoot": "/root/.openclaw/workspace/openclaw-desktop",
  "repoRoot": "/root/.openclaw/workspace/openclaw-desktop",
  "pinned": false,
  "archived": false,
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```

### 7.3 Repos

```http
GET /api/repos/recent
POST /api/repos/scan
POST /api/repos/select
POST /api/repos/clone
```

### 7.4 Git

```http
GET /api/projects/:projectId/git/status
GET /api/projects/:projectId/git/diff?path=<path>
POST /api/projects/:projectId/git/checkout
```

Git status returns uncommitted files, branch, ahead/behind, and remote info based on the Middleware host filesystem.

### 7.5 Workspace files

```http
GET /api/projects/:projectId/workspace/tree?path=<path>
GET /api/projects/:projectId/workspace/file?path=<path>
PUT /api/projects/:projectId/workspace/file
POST /api/projects/:projectId/workspace/directory
PATCH /api/projects/:projectId/workspace/move
DELETE /api/projects/:projectId/workspace/path
```

### 7.6 Terminal

```http
POST /api/projects/:projectId/terminal/spawn
POST /api/terminal/:terminalId/write
POST /api/terminal/:terminalId/resize
POST /api/terminal/:terminalId/kill
GET /api/terminal/:terminalId/stream
```

Terminal runs on the Middleware host using `node-pty`.

### 7.7 Chat/OpenClaw session proxy

Options:

- Keep Desktop talking to OpenClaw Gateway directly for chat, or
- Proxy chat through Middleware.

Recommended for consistency:

```http
POST /api/chat/sessions
GET /api/chat/sessions/:sessionKey/history
POST /api/chat/sessions/:sessionKey/send
GET /api/chat/sessions/:sessionKey/stream
```

Middleware can normalize usage/model metadata from `session.message` and `chat.history`.

## 8. Data Storage

Middleware owns durable operational state.

Recommended initial storage:

- SQLite via `better-sqlite3`
- token stored in env/config file
- project/session metadata in Middleware DB

Desktop stores only:

- Middleware URL
- token/credential reference
- lightweight UI preferences
- optional recent UI state

## 9. Security

### Requirements

- Token auth required for every non-health endpoint.
- Installer generates a strong random token.
- Never expose token in logs.
- Desktop stores token using Tauri secure storage where available.
- Terminal endpoints require explicit permission/scope.
- Middleware should bind to localhost by default unless installer configures external exposure.
- Public exposure should strongly recommend HTTPS/reverse proxy.

### Risk areas

- Terminal is full remote code execution on VPS.
- Workspace write/delete can destroy user data.
- Git operations can expose private repo paths/remotes.

Mitigations:

- confirmation for destructive UI operations
- audit log for terminal/session creation
- optional readonly mode
- clear “Connected to <host>” UI indicator

## 10. Migration Plan

### Phase 1 — Contract and skeleton

- Create new Middleware repo.
- Add Express/Fastify Node.js TypeScript service.
- Add `/health` and auth middleware.
- Add OpenClaw Gateway connection config.
- Add installer draft.

### Phase 2 — Extract current server logic

Move from `openclaw-desktop` to Middleware:

- project service
- repo service
- git service
- workspace service
- terminal service
- Gateway client/middleware logic

Keep behavior equivalent where possible.

### Phase 3 — Desktop API client

In `openclaw-desktop`:

- add `middlewareClient` HTTP wrapper
- replace `invoke("middleware_*")` paths gradually
- remove dependency on internal `packages/middleware`
- keep temporary compatibility layer during migration

### Phase 4 — Onboarding

- Replace current Gateway onboarding with Middleware onboarding.
- Add URL/token test.
- Add installer command UI.
- Store connection config.

### Phase 5 — Remote-first features

- Git status/diff from Middleware.
- Terminal via Middleware PTY stream.
- Workspace browser via Middleware.
- Project selector from Middleware projects, not local filesystem.

### Phase 6 — Cleanup

- Remove local Express backend requirement from production Desktop.
- Remove internal `packages/middleware` package from Desktop repo.
- Keep local dev server only for UI development.
- Update docs/build scripts.

## 11. Compatibility Strategy

During migration:

- Keep current `improvements` branch stable.
- Build `new-arch` separately.
- Do not break current local backend until replacement APIs are working.
- Add feature flag/env:

```text
NEXT_PUBLIC_BACKEND_MODE=remote-middleware | local-legacy
```

Default on `new-arch` can be `remote-middleware`.

## 12. Success Metrics

- Desktop app starts without needing local Node server in production.
- User can connect to Middleware URL/token successfully.
- Git tab shows remote VPS repo state correctly.
- Terminal opens an interactive shell on Middleware host.
- Workspace file browser reflects Middleware host filesystem.
- No local/remote mode confusion in project selection.
- Middleware can be updated independently from Desktop.

## 13. Open Questions

1. New repo name: `openclaw-middleware`, `openclaw-control-server`, or `openclaw-desktop-backend`?
2. Should chat go directly Desktop → Gateway, or Desktop → Middleware → Gateway?
3. Should Middleware expose HTTPS itself or rely on Caddy/Nginx?
4. Should installer support systemd service from day one?
5. Should we support multi-user auth immediately or single-token first?
6. How much local offline cache should Desktop keep?

## 14. Recommendation

Use this architecture for the long term.

Desktop should become a thin client. Middleware should become the controlled Node.js backend that runs on the VPS/local machine where OpenClaw and the repos actually live.

This solves the biggest design problem: execution happens in one predictable place, and Desktop only renders/control it.
