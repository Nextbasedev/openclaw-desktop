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

---

# Detailed Execution Plan

## Execution Principles

1. Keep `improvements` stable while `new-arch` evolves.
2. Do not remove legacy local backend until the replacement path is verified.
3. Every phase must have a runnable test gate.
4. Prefer adapter compatibility before big rewrites.
5. Ship thin vertical slices: connect → projects → git → workspace → terminal → chat.
6. UI should always show which backend it is connected to.

## Phase 0 — Baseline Audit and API Inventory

### Objective

Create a complete inventory of current Desktop backend commands and classify which ones move to Middleware, which stay in Desktop, and which are deleted.

### Implementation tasks

- List all `middleware_*` commands in `packages/server/src/dispatch/registry.ts`.
- Group commands by domain:
  - profiles/connect/onboarding
  - projects/topics/chats/sessions
  - git/repos
  - workspace/files
  - terminal/pty
  - skills/models/usage
  - cron
  - settings/UI-only helpers
- Mark each command as:
  - `move-to-middleware`
  - `desktop-only`
  - `legacy-compat`
  - `delete-later`
- Create a contract map doc:
  - old command name
  - new HTTP endpoint
  - request shape
  - response shape
  - migration notes

### Deliverables

- `docs/prd/new-arch-api-inventory.md`
- No runtime behavior changes.

### Tests

- Static verification:

```bash
grep -R "middleware_" -n packages/server/src/dispatch/registry.ts packages/ui | tee /tmp/new-arch-middleware-commands.txt
```

- Manual review that every command is categorized.

### Done when

- Every current backend command has an explicit migration decision.
- No implementation starts with unknown command ownership.

---

## Phase 1 — Create Middleware Service Repository/Skeleton

### Objective

Create the standalone Node.js/TypeScript Middleware Service with auth, health, config, and development scripts.

### Implementation tasks

In new repo, create:

```text
openclaw-middleware/
  package.json
  tsconfig.json
  src/index.ts
  src/config.ts
  src/auth.ts
  src/routes/health.ts
  src/routes/index.ts
  src/lib/errors.ts
  src/lib/logger.ts
  src/db/schema.ts
  src/db/connection.ts
  scripts/install.sh
  README.md
```

Core service:

- Express or Fastify server.
- `PORT` env default, e.g. `8787`.
- `MIDDLEWARE_TOKEN` env required except dev.
- JSON body limits for file operations.
- CORS config for Desktop/web origins.
- Request logging with token redaction.

### API

```http
GET /health
GET /api/version
```

### Tests

Automated:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
curl -fsS http://127.0.0.1:8787/health
```

Expected health:

```json
{
  "ok": true,
  "service": "openclaw-middleware",
  "version": "0.1.0"
}
```

Auth tests:

```bash
curl -i http://127.0.0.1:8787/api/version
curl -i -H "Authorization: Bearer $MIDDLEWARE_TOKEN" http://127.0.0.1:8787/api/version
```

Expected:

- no token → 401
- valid token → 200

### Done when

- Service runs standalone.
- Auth works.
- Health is public and stable.
- Version endpoint is protected.

---

## Phase 2 — Installer and Service Management

### Objective

Make VPS setup one-command simple.

### Implementation tasks

Installer script should:

1. Check dependencies:
   - Node >= 22
   - pnpm
   - git
2. Clone/pull middleware repo to `/opt/openclaw-middleware` or `~/.openclaw/middleware`.
3. Generate strong random token.
4. Write `.env`:

```env
PORT=8787
HOST=0.0.0.0
MIDDLEWARE_TOKEN=<token>
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
```

5. Install deps.
6. Build service.
7. Install systemd unit:

```text
openclaw-middleware.service
```

8. Start/restart service.
9. Print:

```text
Middleware URL: http://<server-ip>:8787
Token: <token>
```

### Tests

On clean test VPS/container:

```bash
bash scripts/install.sh
systemctl status openclaw-middleware --no-pager
curl -fsS http://127.0.0.1:8787/health
curl -fsS -H "Authorization: Bearer <token>" http://127.0.0.1:8787/api/version
```

Restart test:

```bash
systemctl restart openclaw-middleware
sleep 2
curl -fsS http://127.0.0.1:8787/health
```

### Done when

- A fresh VPS can install and run middleware with one command.
- The script prints a usable URL/token.
- Restart survives.

---

## Phase 3 — Desktop Connection Client and Onboarding

### Objective

Desktop connects to Middleware URL/token instead of local backend/Gateway for core app data.

### Implementation tasks in `openclaw-desktop`

Add:

```text
packages/ui/lib/middleware-client.ts
packages/ui/hooks/useMiddlewareConnection.ts
```

Client responsibilities:

- base URL normalization
- bearer token injection
- JSON helpers
- SSE helper
- standard error format
- connection test

Update onboarding/connect screen:

- replace “Gateway URL” mental model with “Middleware URL”.
- fields:
  - Middleware URL
  - Token
- buttons:
  - Test connection
  - Save connection
  - Show install command
- store locally:
  - `openclaw.middleware.url`
  - token via secure storage if Tauri, fallback localStorage only for dev

### Tests

Unit/logic:

```bash
pnpm --filter ui typecheck
```

Manual with local middleware:

1. Start middleware.
2. Open Desktop.
3. Enter URL/token.
4. Click Test.
5. Confirm success state shows:
   - service version
   - host
   - OpenClaw Gateway connected/not connected

Negative tests:

- wrong token → clear 401 error
- bad URL → connection error
- middleware offline → offline message

### Done when

- Desktop can save/test Middleware connection.
- No Gateway URL/token is required directly in UI for the new architecture path.

---

## Phase 4 — Projects and Repo Discovery

### Objective

Project list and selection come from Middleware, not the Desktop machine.

### Middleware implementation

Add APIs:

```http
GET /api/projects
POST /api/projects
PATCH /api/projects/:projectId
DELETE /api/projects/:projectId
GET /api/repos/recent
POST /api/repos/scan
POST /api/repos/select
POST /api/repos/clone
```

Use SQLite tables similar to current Desktop backend:

- `projects`
- `recent_repos`

Repo scan runs on Middleware host only.

### Desktop implementation

- Replace project list loading with Middleware API.
- Repo picker reads `/api/projects` and `/api/repos/*` from Middleware.
- Remove local filesystem filtering from project picker.
- UI labels should say “Projects on <middleware host>”.

### Tests

Middleware:

```bash
pnpm typecheck
pnpm test -- projects repos
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/projects
```

Integration:

1. Create test repo on Middleware host:

```bash
mkdir -p /tmp/oc-test-repo && cd /tmp/oc-test-repo && git init
```

2. Scan/select repo from API.
3. Confirm Desktop shows that repo.

Expected:

- Windows Desktop selecting project should show Linux/VPS path if Middleware runs on Linux.
- No local Windows paths should appear unless Middleware itself runs on Windows.

### Done when

- Project selection is remote-environment correct.
- No local filesystem access is used for repo picker in new architecture mode.

---

## Phase 5 — Git Service

### Objective

Git tab is fully powered by Middleware host filesystem.

### Middleware implementation

Add:

```http
GET /api/projects/:projectId/git/status
GET /api/projects/:projectId/git/diff?path=<path>
GET /api/projects/:projectId/git/branches
POST /api/projects/:projectId/git/checkout
```

Use current `git.service.ts` logic as source, simplified because local/remote split disappears. There is only “where Middleware runs”.

Status returns:

```json
{
  "projectId": "proj_x",
  "repoRoot": "/root/.openclaw/workspace/repo",
  "branch": "main",
  "upstream": "origin/main",
  "ahead": 0,
  "behind": 0,
  "dirty": true,
  "files": [
    {
      "path": "src/index.ts",
      "status": "modified"
    }
  ]
}
```

Diff returns:

```json
{
  "path": "src/index.ts",
  "patch": "...",
  "oldContent": "... optional",
  "newContent": "... optional",
  "additions": 10,
  "deletions": 2
}
```

### Desktop implementation

- Git tab calls Middleware API.
- Remove current mode inference hacks.
- Keep diff rendering UI.
- Show backend host/repo root in Git tab header.

### Tests

Middleware fixture repo test:

```bash
mkdir -p /tmp/git-fixture
cd /tmp/git-fixture
git init
echo hello > README.md
git add README.md
git commit -m init
echo change >> README.md
```

Then:

```bash
curl -H "Authorization: Bearer $TOKEN" "$URL/api/projects/$PROJECT_ID/git/status"
curl -H "Authorization: Bearer $TOKEN" "$URL/api/projects/$PROJECT_ID/git/diff?path=README.md"
```

Expected:

- status sees modified README.
- diff includes `+change`.

Desktop test:

- Open Git tab.
- Confirm modified file visible.
- Click file.
- Confirm diff visible.

### Done when

- Git tab always reflects Middleware host repo state.
- No GitHub token/API needed.
- No local/remote profile mode exists in Git logic.

---

## Phase 6 — Workspace Files

### Objective

Workspace browser reads/writes files through Middleware.

### Middleware implementation

Add:

```http
GET /api/projects/:projectId/workspace/tree?path=<path>&all=false
GET /api/projects/:projectId/workspace/stat?path=<path>
GET /api/projects/:projectId/workspace/file?path=<path>
PUT /api/projects/:projectId/workspace/file
POST /api/projects/:projectId/workspace/directory
PATCH /api/projects/:projectId/workspace/move
DELETE /api/projects/:projectId/workspace/path
```

Security:

- Normalize paths.
- Prevent traversal outside `project.workspaceRoot`.
- Explicitly reject `../` escapes.
- Optional max file size.

### Desktop implementation

- Workspace tab uses Middleware APIs.
- Remove local `middleware_fs_*` dependency in new architecture mode.
- Show readonly/error states clearly.

### Tests

Path traversal test:

```bash
curl -i -H "Authorization: Bearer $TOKEN" "$URL/api/projects/$PROJECT_ID/workspace/file?path=../../etc/passwd"
```

Expected: 400/403.

Read/write test:

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"test.txt","content":"hello"}' \
  "$URL/api/projects/$PROJECT_ID/workspace/file"

curl -H "Authorization: Bearer $TOKEN" "$URL/api/projects/$PROJECT_ID/workspace/file?path=test.txt"
```

Expected: content `hello`.

Desktop test:

- Create file.
- Edit file.
- Reload workspace tree.
- Confirm persistence on Middleware host.

### Done when

- Workspace tab reflects remote/VPS files.
- Safe path boundaries are enforced.

---

## Phase 7 — Terminal

### Objective

Interactive terminal runs on Middleware host through `node-pty`.

### Middleware implementation

Add terminal manager:

```text
src/services/terminal.service.ts
```

APIs:

```http
POST /api/projects/:projectId/terminal/spawn
POST /api/terminal/:terminalId/write
POST /api/terminal/:terminalId/resize
POST /api/terminal/:terminalId/kill
GET /api/terminal/:terminalId/stream
```

Behavior:

- Spawn shell with cwd = project repo root/workspace root.
- Track active terminals in memory.
- Limit sessions per token/user.
- Kill terminals on idle timeout.
- Stream data via SSE initially.

### Desktop implementation

- `XTerminal/usePty` connects to Middleware endpoints.
- Pass active `projectId`.
- Terminal header shows:

```text
Terminal on <middleware-host> · <repo-root>
```

### Tests

API test:

1. Spawn terminal.
2. Write:

```bash
printf TERMINAL_OK && pwd && exit
```

3. Read stream.
4. Confirm output includes `TERMINAL_OK` and project path.

Desktop test:

- Open terminal.
- Run `pwd`.
- Confirm path is Middleware host project path, not Desktop local path.
- Run `git status`.
- Confirm output matches Git tab.

Security tests:

- invalid token cannot spawn terminal.
- terminal count limit works.
- killed terminal stops stream.

### Done when

- Remote terminal is real interactive PTY on Middleware host.
- No OpenClaw Gateway terminal RPC is required.

---

## Phase 8 — Chat and OpenClaw Gateway Integration

### Objective

Unify chat/session behavior through Middleware, or clearly decide direct Gateway path.

### Recommended direction

Route chat through Middleware for consistency.

Why:

- Desktop only needs one backend URL/token.
- Middleware can normalize model/usage metadata.
- Middleware can manage Gateway URL/token locally on VPS.
- Better for web client too.

### Middleware implementation

Add:

```http
GET /api/chat/sessions
POST /api/chat/sessions
GET /api/chat/sessions/:sessionKey/history
POST /api/chat/sessions/:sessionKey/send
GET /api/chat/sessions/:sessionKey/stream
POST /api/chat/sessions/:sessionKey/edit-preview
POST /api/chat/sessions/:sessionKey/select-edit-branch
```

Use existing Gateway protocol logic.

Important metadata source:

- use `session.message` and `chat.history` for `message.model`, `message.usage`, `message.stopReason`
- do not rely only on Gateway `chat final` event because it lacked usage/model in live tests

### Desktop implementation

- Replace chat stream with Middleware SSE.
- Keep current UI message rendering.
- Keep latest-message edit preview flow.

### Tests

Automated Gateway integration script:

- create session
- send prompt “Reply exactly CHAT_OK”
- stream until done
- fetch history
- assert assistant text exists
- assert model/usage captured if provider returns it

Desktop test:

- Send chat.
- Confirm streaming text.
- Confirm model/usage badge appears when available.
- Edit latest user message.
- Confirm comparison panel works.
- Select edited branch.
- Send next message; confirm context follows edited branch.

### Done when

- Chat works with only Middleware URL/token in Desktop.
- Usage/model metadata remains correct.

---

## Phase 9 — Skills, Models, Usage, Cron

### Objective

Move remaining OpenClaw-dependent surfaces behind Middleware APIs.

### Domains

- Models/auth status
- Skills installed/search/install/uninstall
- Usage summaries
- Cron jobs/runs
- Settings maintenance actions

### Implementation pattern

For each domain:

1. Add Middleware route.
2. Port existing server service logic.
3. Replace Desktop invoke calls.
4. Add tests.
5. Remove legacy command usage.

### Tests

For each domain:

- protected endpoint auth test
- happy path with Gateway available
- graceful error when Gateway unavailable
- UI state for loading/error/empty

### Done when

- No core UI feature depends on local `packages/server` in new architecture mode.

---

## Phase 10 — Remove Legacy Local Backend from Production Desktop

### Objective

Stop requiring local Node backend for packaged Desktop.

### Implementation tasks

- Remove production dependency on `packages/server`.
- Remove production dependency on internal `packages/middleware`.
- Keep Next static export / bundled UI as needed for Tauri.
- Tauri loads UI and UI calls external Middleware URL.
- Dev can still run Next locally.

### Build tests

```bash
pnpm install
pnpm --filter ui typecheck
pnpm --filter ui build
pnpm --filter desktop tauri build
```

Runtime tests:

- install app
- launch app
- no local backend server required
- connect to Middleware URL
- use projects/git/terminal/chat

### Done when

- Packaged Desktop works as thin client.
- No local backend process must be started for normal use.

---

## Phase 11 — Migration and Backward Compatibility

### Objective

Avoid breaking current users during transition.

### Implementation tasks

- Add migration screen:
  - “This version uses Middleware Service.”
  - “Install/connect Middleware.”
- If old local config exists:
  - show existing Gateway URL as helper text
  - offer “Install Middleware locally” / “Connect remote Middleware”
- Keep legacy mode behind feature flag for one release if needed:

```env
NEXT_PUBLIC_BACKEND_MODE=local-legacy
```

### Tests

- Fresh install path.
- Existing user with old config.
- Bad/expired token path.
- Middleware unavailable on launch.

### Done when

- Users understand what changed.
- Existing configs do not silently produce wrong local/remote behavior.

---

## Phase 12 — CI/CD and Release

### Objective

Make both repos independently shippable.

### Middleware CI

- typecheck
- tests
- build
- Docker image optional
- release artifact
- installer smoke test

### Desktop CI

- UI typecheck
- build
- Tauri build
- API client contract tests against mocked Middleware

### End-to-end release test

On test VPS:

1. Install OpenClaw/Gateway.
2. Install Middleware.
3. Launch Desktop app on local machine.
4. Connect URL/token.
5. Verify:
   - health
   - projects
   - git
   - workspace
   - terminal
   - chat

### Done when

- We can release Middleware and Desktop separately.
- A new user can follow docs and connect successfully.

---

# Testing Matrix

## Environments

### Local developer machine

- Middleware local
- Desktop local
- Gateway local

Expected:

- paths are local
- terminal local
- git local

### Remote VPS

- Middleware on VPS
- Gateway on VPS
- Desktop on developer/user machine

Expected:

- paths are VPS paths
- terminal VPS shell
- git VPS repo
- no accidental local filesystem usage

### Middleware offline

Expected:

- Desktop shows disconnected state
- no infinite loading
- retry works

### Bad token

Expected:

- 401 shown clearly
- user can update token

### Gateway offline but Middleware online

Expected:

- projects/git/workspace may still work
- chat/models/skills show Gateway unavailable
- health reports Gateway disconnected

## Feature Gates

Before considering `new-arch` ready:

- Connect: pass
- Projects: pass
- Git: pass
- Workspace: pass
- Terminal: pass
- Chat: pass
- Packaged Desktop thin-client launch: pass

---

# Rollout Recommendation

1. Build Middleware repo privately first.
2. Keep `new-arch` branch experimental.
3. Once project/git/terminal are working, dogfood on one VPS.
4. Then migrate chat.
5. Only after chat is stable, remove local backend from production Desktop.

