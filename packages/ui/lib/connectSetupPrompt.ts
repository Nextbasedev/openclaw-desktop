export type ConnectSetupMode = "local" | "remote"

const REPO_URL = "https://github.com/Nextbasedev/openclaw-desktop.git"
const REPO_BRANCH = "dev-3"

function modeDetails(mode: ConnectSetupMode) {
  if (mode === "local") {
    return {
      label: "LOCAL",
      target: "OpenClaw Desktop and Middleware are on this same computer.",
      host: "127.0.0.1",
      urlRule: "Use http://127.0.0.1:8787 as the Middleware URL unless you had to change the port.",
      network: "local loopback",
    }
  }

  return {
    label: "REMOTE",
    target: "OpenClaw Desktop will connect to Middleware running on this VPS/server.",
    host: "0.0.0.0",
    urlRule: "Choose the URL that Desktop can actually reach: reverse-proxy HTTPS domain first, then Tailscale MagicDNS/100.x.y.z, then private IP/LAN, then public IP with port 8787 only if firewall/security-group allows it.",
    network: "public domain | tailscale | private ip | public ip | reverse proxy",
  }
}

export function buildOpenClawSetupPrompt(mode: ConnectSetupMode) {
  const details = modeDetails(mode)
  return `Set up OpenClaw Desktop Middleware for ${details.label} connection mode.

Context:
- ${details.target}
- Desktop needs full OpenClaw access through Middleware: chats, sessions, operator.read/operator.write/operator.admin/operator.approvals operations, cron, projects, workspace files, git, terminal, streams, usage, and settings.
- Do not stop after just starting the server. Verify the authenticated APIs that Desktop uses.

Use this exact source unless a newer branch was explicitly requested by the user:
- Repo: ${REPO_URL}
- Branch: ${REPO_BRANCH}

Setup:
1. Check Node.js 22+ and pnpm are available. Install only if missing.
2. Check whether OpenClaw Gateway/runtime is running locally on this machine. Start it if needed.
   - Verify with: openclaw gateway status
   - Default gateway URL expected by Middleware: ws://127.0.0.1:18789
3. Clone or update the repo, checkout ${REPO_BRANCH}, install dependencies, and build Middleware:
   - pnpm install --frozen-lockfile
   - pnpm --filter @openclaw/desktop-middleware build
4. Run Middleware from apps/middleware on port 8787 with a stable token and pairing code:
   - HOST=${details.host}
   - PORT=8787
   - NODE_ENV=production
   - OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   - WORKSPACE_ROOT=$HOME/.openclaw/workspace
   - MIDDLEWARE_TOKEN=<stable random secret>
   - MIDDLEWARE_PAIRING_CODE=<short readable code, 6-8 uppercase chars>
5. For remote mode, run it as an auto-restarting service that survives crashes and reboot. For local mode, service is preferred but a foreground run is acceptable for testing.
6. ${details.urlRule}

Required verification before you answer:
1. Public health works:
   - curl -fsS <middleware-url>/health
   - Confirm JSON has ok=true, service=openclaw-middleware, and openclaw.connected=true.
2. Pairing works:
   - curl -fsS -X POST <middleware-url>/pairing/claim -H 'Content-Type: application/json' -d '{"code":"<pairing-code>"}'
   - Confirm it returns ok=true and a token.
3. Authenticated Desktop APIs work using the returned token:
   - GET /api/version
   - GET /api/bootstrap
   - GET /api/workspace/capabilities
   - GET /api/projects
   - POST /api/commands/middleware_commands_list
   - POST /api/commands/middleware_usage
4. Cron works end-to-end through Middleware:
   - POST /api/commands/middleware_cron_create_job with a harmless paused/disabled smoke job
   - POST /api/commands/middleware_cron_list_jobs
   - POST /api/commands/middleware_cron_run_job for that smoke job if it is safe
   - POST /api/commands/middleware_cron_list_runs
   - Check GET /api/stream/cron opens an event-stream and returns the initial ready comment.
5. Chat/session send API works:
   - Create one temporary smoke session by calling POST /api/commands/middleware_chat_send with message: Reply exactly DESKTOP_MIDDLEWARE_SMOKE_OK
   - Use execPolicy {"security":"allowlist","ask":"on-miss"} and timeoutMs 60000.
   - If no model/API key is configured, do not hide it. Report that Middleware is working but chat model provider is the blocker.
6. Terminal/workspace access works:
   - GET /api/workspace/tree?path=
   - POST /api/terminal/spawn with a harmless command like pwd, then kill the terminal.
7. If any check fails, fix it and rerun the checks. Do not give the URL/code until the required checks pass or you have a specific blocker.

When finished, reply only in this format:
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: ${details.network}
Verified: health, pairing, auth APIs, admin commands, cron, stream, chat send, workspace, terminal
Blocker: <none | exact blocker>`
}

export const LOCAL_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("local")
export const VPS_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("remote")
