# Local/Remote Git Status Plan

## Goal

Project Git status should follow the selected OpenClaw environment mode:

- **Local OpenClaw**: inspect the selected project workspace on the desktop machine with local git commands.
- **Remote OpenClaw**: do not inspect the desktop filesystem. Ask the connected remote OpenClaw/Gateway for git status inside the remote workspace.

The frontend must call one stable Jarvis command and receive one normalized response shape.

## User flow

1. User selects/opens a project.
2. Jarvis reads the project's `profile_id`.
3. Jarvis loads the profile's `mode`, `gateway_url`, and `workspace_root`.
4. Jarvis chooses the git adapter:
   - `mode === "local"` or local gateway URL (`127.0.0.1`, `localhost`, `::1`) -> local adapter.
   - remote gateway URL / remote profile mode -> remote adapter.
5. UI renders the returned status.

## Normalized API

Add/standardize:

```ts
middleware_git_status({ projectId })
```

Response:

```ts
type GitStatus = {
  mode: "local" | "remote"
  source: "local-fs" | "openclaw-gateway"
  repoRoot: string | null
  hasGit: boolean
  branch: string | null
  upstream: string | null
  remoteUrl: string | null
  ahead: number
  behind: number
  clean: boolean
  changedFiles: Array<{
    path: string
    fileName: string
    dirPath: string
    state: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked"
    additions: number
    deletions: number
  }>
  recentCommits: Array<{
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  }>
  checkedAt: string
  error?: string
}
```

## Local adapter

Use current direct git implementation in `packages/server/src/services/git.service.ts` and `git-parsers.ts`.

Commands:

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git remote get-url <remote>
git status --porcelain -u
git diff --numstat
git diff --cached --numstat
git rev-list --left-right --count HEAD...@{upstream}
git log --numstat -10
```

Important: local mode must not run `git fetch` automatically for this requirement. It only reports local workspace state.

## Remote adapter

Remote mode must use the connected OpenClaw Gateway, not local filesystem paths.

Constraint: **do not change OpenClaw/Gateway**. The desktop app must use only existing Gateway behavior.

Current implementation path:

1. Connect using existing Gateway websocket + token (`connectGateway()` / `ensureGatewayClient()`).
2. Create a temporary hidden-ish utility session labelled `Jarvis Git Status Probe`.
3. Send a deterministic probe prompt through existing `sessions.send` asking the remote agent to run read-only git commands in the remote project cwd.
4. Read the final assistant JSON from `chat.history`.
5. Normalize response into `GitStatus`.
6. Best-effort delete the temporary probe session.

This keeps all changes inside `openclaw-desktop`. No new Gateway method such as `git.status` is required.

Caveat: this is less ideal than a first-class Gateway RPC because it depends on an agent/tool run. It is acceptable as a desktop-only bridge until OpenClaw exposes deterministic remote workspace APIs.

## Current Gateway capability test

On this machine, OpenClaw Gateway is reachable at:

```txt
ws://127.0.0.1:18789
```

Config has a gateway token in `~/.openclaw/openclaw.json`.

Curl probe:

```bash
curl -i --max-time 5 http://127.0.0.1:18789/
```

Result: HTTP 200 control dashboard.

WebSocket upgrade probe:

```bash
curl -i --max-time 5 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: http://127.0.0.1:3000' \
  http://127.0.0.1:18789/
```

Result: HTTP 101 Switching Protocols and `connect.challenge` event received.

Known protocol docs list these relevant methods:

- `agents.files.list/get/set` for agent workspace files
- `sessions.*`, `chat.*`, `tools.*`, `commands.list`, `config.*`, etc.

The docs do **not** currently list a deterministic remote `git.status` or remote shell command API for middleware use.

## Implementation steps

### Step 1 — Normalize local git status

- Add `middleware_git_status` to `packages/server/src/dispatch/registry.ts`.
- Refactor `gitContext()` internals into `buildLocalGitStatus(projectId)`.
- Keep `middleware_git_context` for compatibility.

### Step 2 — Add environment resolver

In `git.service.ts`:

```ts
function resolveProjectEnvironment(projectId: string) {
  // join projects.profile_id -> profiles.id
  // return mode, gatewayUrl, workspaceRoot, repoRoot
}
```

### Step 3 — Add remote adapter boundary

```ts
async function buildRemoteGitStatus(projectId: string) {
  const gw = await ensureGatewayClient()
  const session = await gw.request("sessions.create", { label: "Jarvis Git Status Probe" })
  await gw.request("sessions.send", { key: session.key, message: probePrompt, timeoutMs: 90000 })
  const history = await gw.request("chat.history", { sessionKey: session.key, limit: 20 })
  return normalizeAssistantJson(history)
}
```

### Step 4 — UI behavior

- `GitTab` should call `middleware_git_status` only.
- If `mode: local`, label as `Local workspace`.
- If `mode: remote`, label as `Remote OpenClaw workspace`.
- If remote capability missing, show actionable message: `Remote git status is not available on this Gateway yet`.

### Step 5 — Tests

Unit tests:

- local profile returns local git status.
- local non-git dir returns `hasGit: false`.
- remote profile does not read local `.git`.
- remote gateway method-not-found returns structured unsupported result.

Integration/curl tests:

- `POST /api/ipc/middleware_git_status` with local project -> returns local changed files.
- websocket probe confirms Gateway reachable and auth challenge exists.
- once Gateway exposes `git.status`, `POST /api/ipc/middleware_git_status` with remote project -> returns `source: openclaw-gateway`.

## Key decision

Do not mix local and remote status in one project. The selected project's profile decides the source:

- local profile: local only
- remote profile: remote only
