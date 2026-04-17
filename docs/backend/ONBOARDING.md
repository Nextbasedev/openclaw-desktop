# ONBOARDING.md

Scope: document the current **backend/middleware contract** for Jarvis onboarding so frontend can build the UI without reading Rust code.

Goal:
- frontend knows the onboarding steps
- frontend knows which Tauri commands to call
- frontend knows request and response shapes
- frontend knows edge cases and recommended UI states

---

## 1. Current onboarding backend surface

The current onboarding backend lives in:
- `packages/desktop/src-tauri/src/middleware.rs`
- command registration in `packages/desktop/src-tauri/src/lib.rs`

Frontend should call these Tauri commands:
- `middleware_openclaw_check`
- `middleware_openclaw_install`
- `middleware_git_remote_add`
- `middleware_git_remote_list`
- `middleware_git_remote_remove`

These are the onboarding-related backend primitives currently available.

---

## 2. Recommended onboarding flow for UI

### Step 1, check OpenClaw status
Use this first when onboarding starts.

Command:
- `middleware_openclaw_check`

Purpose:
- detect whether `openclaw` CLI is installed
- detect whether the Gateway is reachable
- tell UI what the next recommended state is

### Step 2, install OpenClaw if missing
If check returns `recommendation: "install"`, show install UI.

Command:
- `middleware_openclaw_install`

Purpose:
- install OpenClaw to a default or custom location

### Step 3, move user into ready/start state
If check returns:
- `recommendation: "start"` → UI should tell user OpenClaw is installed but Gateway is not running yet
- `recommendation: "ready"` → UI can proceed to repo/project setup

### Step 4, configure git remote for project
Once project exists and has `repo_root`, frontend can manage remotes.

Commands:
- `middleware_git_remote_add`
- `middleware_git_remote_list`
- `middleware_git_remote_remove`

Purpose:
- connect a local repo to GitHub or another remote
- display current remotes in onboarding/repo setup UI

---

## 3. Tauri command contracts

## 3.1 `middleware_openclaw_check`

### Input
```json
{
  "gatewayUrl": "ws://127.0.0.1:3000"
}
```

All fields optional.

Behavior:
- if `gatewayUrl` is omitted, backend uses `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`

### Response
```json
{
  "installed": true,
  "running": true,
  "version": "openclaw 0.x.x",
  "gateway": {
    "url": "ws://127.0.0.1:3000",
    "status": "running"
  },
  "recommendation": "ready"
}
```

### Response fields
- `installed: boolean`
- `running: boolean`
- `version: string | null`
- `gateway: { url, status } | null`
- `recommendation: "install" | "start" | "ready"`

### UI mapping
- `install` → show install CTA
- `start` → show "installed, but not running" UI
- `ready` → show success state and continue onboarding

### Notes
- Gateway reachability is a short connection probe, not a deep health check
- `running: false` does not necessarily mean install failed, only that websocket connect did not succeed

---

## 3.2 `middleware_openclaw_install`

### Input
```json
{
  "installPath": "/custom/path/bin",
  "version": "stable"
}
```

Both fields optional.

### Defaults
- `installPath`
  - Linux/macOS default: `~/.openclaw/bin`
  - fallback: `/usr/local/bin`
- `version`
  - default: `stable`

### Platform behavior
- Linux/macOS uses:
  - `https://get.openclaw.ai/install.sh`
- Windows uses:
  - `https://get.openclaw.ai/install.ps1`

### Success response
```json
{
  "installed": true,
  "path": "/root/.openclaw/bin",
  "version": "stable",
  "output": "...installer stdout..."
}
```

### Failure shape
This command returns a rejected Tauri invoke with string error text, for example:
- `Installation failed: ...`
- `Failed to run installer: ...`
- `Unsupported OS: ...`
- `Failed to create install directory: ...`

### UI guidance
- show progress state while install is running
- show raw error text in expandable details block
- after success, immediately re-run `middleware_openclaw_check`
- do not assume install implies Gateway is already running

---

## 3.3 `middleware_git_remote_add`

### Input
```json
{
  "projectId": "proj_1",
  "remoteName": "origin",
  "remoteUrl": "https://github.com/example/repo.git"
}
```

### Success response
```json
{
  "added": true,
  "remoteName": "origin",
  "remoteUrl": "https://github.com/example/repo.git",
  "projectId": "proj_1"
}
```

### Behavior
- backend loads `repo_root` from the `projects` table
- if `.git` does not exist, backend runs `git init`
- backend runs `git remote add <name> <url>`
- backend also stores remote info in `projects.remotes_json`

### Failure cases
Possible string errors:
- `Project not found: ...`
- `Project has no repo_root configured`
- `Failed to init git: ...`
- `Git init failed: ...`
- `Failed to add remote: ...`
- `Git remote add failed: ...`
- `Failed to update project: ...`

### UI guidance
- disable this step until project exists
- require `projectId`
- allow user to enter remote name and URL
- default remote name can be `origin`

---

## 3.4 `middleware_git_remote_list`

### Input
```json
{
  "projectId": "proj_1"
}
```

### Success response
```json
{
  "remotes": [
    {
      "name": "origin",
      "url": "https://github.com/example/repo.git",
      "type": "fetch"
    },
    {
      "name": "origin",
      "url": "https://github.com/example/repo.git",
      "type": "push"
    }
  ]
}
```

### Behavior
- if project has no `repo_root`, returns empty list
- if `.git` does not exist, returns empty list
- backend reads from `git remote -v`

### UI guidance
- UI should group rows by `name`
- expect up to two rows per remote, usually `fetch` and `push`
- empty list is a valid state, not necessarily an error

---

## 3.5 `middleware_git_remote_remove`

### Input
```json
{
  "projectId": "proj_1",
  "remoteName": "origin"
}
```

### Success response
```json
{
  "removed": true,
  "remoteName": "origin",
  "projectId": "proj_1"
}
```

### Behavior
- backend runs `git remote remove <name>`
- backend removes the same key from `projects.remotes_json`

### Failure cases
Possible string errors:
- `Project not found: ...`
- `Project has no repo_root configured`
- `Failed to remove remote: ...`
- `Git remote remove failed: ...`
- `Failed to update project: ...`

### UI guidance
- use confirmation for remove action
- after success, refresh by calling `middleware_git_remote_list`

---

## 4. Backend state assumptions

Frontend should know these assumptions already exist in backend:

### Project requirement for git steps
Git remote commands require a valid `projects` row with:
- `id`
- `repo_root`

### SQLite schema dependency
The onboarding git remote flow depends on:
- `projects.remotes_json TEXT`

This is already added in middleware DB setup and migration.

---

## 5. Suggested frontend state machine

## Install status state
Use `middleware_openclaw_check` to map onboarding status into one of:
- `checking`
- `not_installed`
- `installed_not_running`
- `ready`
- `error`

Recommended mapping:
- `installed=false` → `not_installed`
- `installed=true && running=false` → `installed_not_running`
- `installed=true && running=true` → `ready`

## Repo setup state
For git remote setup:
- `idle`
- `adding_remote`
- `remote_added`
- `remote_error`
- `listing_remotes`
- `remotes_ready`
- `removing_remote`

---

## 6. Suggested frontend UX sections

A simple onboarding UI can be split into these cards/steps:

### A. OpenClaw status
Show:
- Installed / Not installed
- Running / Not running
- Version if available
- CTA based on recommendation

### B. Install action
Show only when needed:
- optional install path input
- optional version input
- install button
- output/error details accordion

### C. Repo remote setup
Show when project is ready:
- remote name input, default `origin`
- remote URL input
- add remote button
- list of current remotes
- remove button per remote group

---

## 7. Example frontend invoke usage

```ts
import { invoke } from "@tauri-apps/api/core";

export async function checkOpenClaw() {
  return invoke("middleware_openclaw_check", {});
}

export async function installOpenClaw(input?: {
  installPath?: string;
  version?: string;
}) {
  return invoke("middleware_openclaw_install", { input });
}

export async function addGitRemote(input: {
  projectId: string;
  remoteName: string;
  remoteUrl: string;
}) {
  return invoke("middleware_git_remote_add", { input });
}

export async function listGitRemotes(projectId: string) {
  return invoke("middleware_git_remote_list", {
    input: { projectId },
  });
}

export async function removeGitRemote(input: {
  projectId: string;
  remoteName: string;
}) {
  return invoke("middleware_git_remote_remove", { input });
}
```

---

## 8. Important implementation notes for frontend team

- treat all backend errors as displayable strings for now
- after install success, run check again instead of assuming ready
- git remote list can validly return an empty array
- add/remove remote should be followed by a list refresh
- remote commands depend on project creation happening earlier in onboarding
- current backend surface is Tauri-command based, not an HTTP onboarding API yet

---

## 9. Gaps still not covered by current onboarding backend

These UI needs are not yet fully covered by dedicated onboarding commands:
- starting the Gateway after install
- creating/selecting the project during onboarding
- validating auth for private git remotes
- testing remote reachability before add
- richer install progress events
- richer structured error codes

Frontend should design these as:
- current supported flow now
- expandable later without breaking layout

---

## 10. Recommended next backend additions

To make frontend implementation even easier later, add these commands next:
- `middleware_openclaw_start`
- `middleware_openclaw_status_verbose`
- `middleware_project_create_for_onboarding`
- `middleware_git_remote_validate`
- `middleware_git_clone_or_connect`

---

## 11. Source of truth

If behavior and this doc differ, current code source is:
- `packages/desktop/src-tauri/src/middleware.rs`
- `packages/desktop/src-tauri/src/lib.rs`

This doc is meant to save frontend time, not replace code verification for future backend changes.
