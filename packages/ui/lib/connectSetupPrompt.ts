export type ConnectSetupMode = "local" | "remote"

const REPO_URL = "https://github.com/Nextbasedev/openclaw-desktop.git"
const REPO_BRANCH = "dev-3"

function modeDetails(mode: ConnectSetupMode) {
  if (mode === "local") {
    return {
      label: "LOCAL",
      target: "OpenClaw Desktop and Middleware are on this same computer.",
      host: "127.0.0.1",
      urlRule: "Use http://127.0.0.1:8787 unless you had to change the port.",
      network: "local loopback",
      serviceRule: "A service is preferred, but a foreground run is acceptable for a local test.",
    }
  }

  return {
    label: "REMOTE",
    target: "OpenClaw Desktop will connect to Middleware running on this VPS/server.",
    host: "0.0.0.0",
    urlRule: "Use the URL Desktop can actually reach: HTTPS reverse proxy first, then Tailscale MagicDNS/100.x.y.z, then private IP/LAN, then public IP:8787 only if firewall/security-group allows it.",
    network: "public domain | tailscale | private ip | public ip | reverse proxy",
    serviceRule: "Run it as an auto-restarting service that survives crashes and reboot.",
  }
}

export function buildOpenClawSetupPrompt(mode: ConnectSetupMode) {
  const details = modeDetails(mode)
  return `Set up OpenClaw Desktop Middleware for ${details.label} mode.

Context:
- ${details.target}
- Desktop needs full OpenClaw access through Middleware: chats, sessions, operator.read/operator.write/operator.admin/operator.approvals, cron, projects, workspace files, git, terminal, streams, usage, and settings.
- Do not stop after only starting the server. Run the smoke test below and fix failures.

Source:
- Repo: ${REPO_URL}
- Branch: ${REPO_BRANCH}

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway on this machine:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout ${REPO_BRANCH}, install, and build:
   - pnpm install --frozen-lockfile
   - pnpm --filter @openclaw/desktop-middleware build
4. Run apps/middleware on port 8787:
   - HOST=${details.host}
   - PORT=8787
   - NODE_ENV=production
   - OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   - WORKSPACE_ROOT=$HOME/.openclaw/workspace
   - MIDDLEWARE_TOKEN=<stable random secret>
   - MIDDLEWARE_PAIRING_CODE=<short readable code, 6-8 uppercase chars>
5. ${details.serviceRule}
6. Middleware URL rule: ${details.urlRule}

Mandatory verification:
Run the repo smoke-test script. It uses curl and checks health, pairing/token, auth APIs, admin commands, cron, /api/stream/cron, chat send, workspace, and terminal.

Command:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_PAIRING_CODE=<pairing-code> apps/middleware/scripts/desktop-smoke-test.sh

If you already know the token, you can use:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_TOKEN=<token> apps/middleware/scripts/desktop-smoke-test.sh

If the script fails because no model/API key is configured, say Middleware is working but chat model/provider is the blocker. For any other failure, fix it and rerun the script. Do not give the URL/code until the script prints DESKTOP_MIDDLEWARE_SMOKE_TEST_OK or you have one exact blocker.

When finished, reply only:
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: ${details.network}
Verified: desktop-smoke-test passed
Blocker: <none | exact blocker>`
}

export const LOCAL_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("local")
export const VPS_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("remote")
