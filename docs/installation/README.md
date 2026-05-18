# OpenClaw Desktop Middleware Installation

Use this guide when OpenClaw Desktop asks you to prepare Middleware for a local computer or remote VPS/server.

## Source

- Repo: `https://github.com/Nextbasedev/openclaw-desktop.git`
- Branch: `dev-3`
- Middleware package: `@openclaw/desktop-middleware`
- Middleware app directory: `apps/middleware`

## Requirements

- Node.js 22+
- pnpm
- OpenClaw Gateway/runtime running on the same machine as Middleware
- Default Gateway URL: `ws://127.0.0.1:18789`

Check Gateway first:

```bash
openclaw gateway status
```

Start it if needed:

```bash
openclaw gateway start
```

## Install / Update

```bash
git clone https://github.com/Nextbasedev/openclaw-desktop.git
cd openclaw-desktop
git fetch origin dev-3
git checkout dev-3
git pull --ff-only origin dev-3
pnpm install --frozen-lockfile
pnpm --filter @openclaw/desktop-middleware build
```

If the repo already exists, update it instead of cloning again.

## Run Middleware

Set stable `MIDDLEWARE_TOKEN` and `MIDDLEWARE_PAIRING_CODE`. Desktop uses the pairing code once, then stores the token.

### Local mode

Use local mode when Desktop and Middleware are on the same computer.

```bash
cd apps/middleware
HOST=127.0.0.1 \
PORT=8787 \
NODE_ENV=production \
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789 \
WORKSPACE_ROOT="$HOME/.openclaw/workspace" \
MIDDLEWARE_TOKEN="<stable-random-secret>" \
MIDDLEWARE_PAIRING_CODE="<6-8-uppercase-code>" \
node dist/index.js
```

Middleware URL: `http://127.0.0.1:8787`

A service is preferred, but a foreground run is acceptable for local testing.

### Remote mode

Use remote mode when Desktop connects to Middleware on a VPS/server.

```bash
cd apps/middleware
HOST=0.0.0.0 \
PORT=8787 \
NODE_ENV=production \
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789 \
WORKSPACE_ROOT="$HOME/.openclaw/workspace" \
MIDDLEWARE_TOKEN="<stable-random-secret>" \
MIDDLEWARE_PAIRING_CODE="<6-8-uppercase-code>" \
node dist/index.js
```

Run remote Middleware as an auto-restarting service that survives crashes and reboot.

Pick the URL Desktop can actually reach, in this order:

1. HTTPS reverse proxy domain
2. Tailscale MagicDNS or `100.x.y.z`
3. Private IP / LAN URL
4. Public IP with `:8787` only if firewall/security group allows it

## Official OpenClaw Gateway scopes

Middleware must connect to OpenClaw Gateway with the official operator scopes used in the OpenClaw code (`apps/middleware/src/services/gateway.ts`):

- `operator.read`
- `operator.write`
- `operator.approvals`
- `operator.admin`

These are Gateway scopes only. Desktop workspace, git, terminal, and other Desktop features are verified through Middleware's own HTTP APIs, not as separate OpenClaw Gateway scopes.

## Mandatory smoke test

Run the smoke test before returning URL/code. It verifies health, OpenClaw Gateway connection, pairing/token, official Gateway operator scopes via chat/admin/approval paths, plus Middleware HTTP APIs for cron, `/api/stream/cron`, chat send, workspace, and terminal.

From repo root:

```bash
MIDDLEWARE_TEST_URL="<middleware-url>" \
MIDDLEWARE_PAIRING_CODE="<pairing-code>" \
docs/installation/desktop-middleware-smoke-test.sh
```

If you already know the token:

```bash
MIDDLEWARE_TEST_URL="<middleware-url>" \
MIDDLEWARE_TOKEN="<token>" \
docs/installation/desktop-middleware-smoke-test.sh
```

Success output must include:

```text
DESKTOP_MIDDLEWARE_SMOKE_TEST_OK
```

If the script fails because no model/API key is configured, report: Middleware is working, but chat model/provider configuration is the blocker.

For any other failure, fix it and rerun the smoke test before giving the URL/code.

## Final response format

```text
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: <local loopback | public domain | tailscale | private ip | public ip | reverse proxy>
Verified: desktop-smoke-test passed
Blocker: <none | exact blocker>
```
