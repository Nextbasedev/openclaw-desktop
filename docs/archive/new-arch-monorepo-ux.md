# New Architecture Monorepo UX

## Goal

OpenClaw Desktop is one open-source monorepo containing the desktop shell, web UI, shared packages, and Node.js middleware service.

The user chooses where execution happens:

- **Local mode:** middleware runs on this computer.
- **Remote mode:** middleware runs on a VPS/server and Desktop/Web connects to it.

Rust remains only the Tauri desktop shell. Backend/business logic is Node.js/TypeScript middleware.

## Folder Structure

```txt
openclaw-desktop/
  apps/
    middleware/              # Node.js middleware service

  packages/
    desktop/                 # Tauri/Rust shell
    ui/                      # Next.js/React UI
    middleware/              # legacy package during migration only
    server/                  # legacy local backend during migration only
    shared/                  # shared types/contracts

  scripts/
    dev-local.cjs            # local stack helper
    dev-remote.cjs           # remote instructions helper

  docs/
    new-arch-monorepo-ux.md
```

Target final structure after cleanup:

```txt
openclaw-desktop/
  apps/
    desktop/
    web/
    middleware/
  packages/
    ui/
    api-client/
    shared/
```

## First-Run UX

```txt
Welcome to OpenClaw Desktop

Where should OpenClaw run?

[ Use this computer ]
Best for local development and personal use.

[ Connect to VPS ]
Best for remote agents, remote terminal, and server repos.
```

### Local Mode

User chooses **Use this computer**.

Flow:

1. Desktop starts/uses local middleware.
2. Middleware reads local OpenClaw config.
3. Git/terminal/workspace run on local machine.
4. UI stores local middleware URL/token.

Expected command for developers:

```bash
pnpm dev:local
```

### Remote Mode

User chooses **Connect to VPS**.

Flow:

1. UI shows install command:

```bash
curl -fsSL https://raw.githubusercontent.com/Nextbasedev/openclaw-desktop/main/apps/middleware/scripts/install.sh | bash
```

2. VPS prints:

```txt
Middleware URL: http://SERVER:8787
Token: <generated-token>
```

3. User pastes URL/token into Desktop.
4. Desktop tests `/health` + `/api/version`.
5. Git/terminal/workspace run on VPS, not local machine.

Expected command for developers:

```bash
pnpm dev:remote
```

## Middleware URL Defines Execution Location

No separate local/remote profile mode is needed.

- `http://127.0.0.1:8787` means local execution.
- `https://vps.example.com` means remote execution.

## Required UX Signals

Every sensitive surface should show the execution host:

- Git tab: `Repo on <middleware-host>`
- Terminal: `Terminal on <middleware-host>`
- Workspace: `Workspace on <middleware-host>`

## Testing Checklist

### Local

```bash
pnpm install
pnpm dev:middleware
curl http://127.0.0.1:8787/health
pnpm test:middleware
pnpm build:middleware
```

### Remote

```bash
bash apps/middleware/scripts/install.sh
curl http://SERVER:8787/health
curl -H "Authorization: Bearer TOKEN" http://SERVER:8787/api/version
```

### Desktop Onboarding

- Empty state shows middleware URL/token fields.
- Bad URL shows connection error.
- Bad token shows auth error.
- Valid middleware saves connection.
- Disconnect clears saved connection.

## Migration Note

During migration, `packages/server` and `packages/middleware` may remain for reference/legacy dev. Production new-arch should route `middleware_*` UI calls to `apps/middleware` only.
