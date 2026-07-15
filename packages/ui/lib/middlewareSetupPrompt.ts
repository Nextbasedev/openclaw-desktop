export const REMOTE_CONNECTIVITY_METHODS = [
  "auto",
  "tailscale",
  "cloudflared",
  "ngrok",
] as const

export type RemoteConnectivityMethod = (typeof REMOTE_CONNECTIVITY_METHODS)[number]

const methodInstructions: Record<RemoteConnectivityMethod, string> = {
  auto: `Connection method: AUTO.
Inspect these existing connectivity methods in order: Tailscale, Cloudflare Tunnel, then ngrok. For each method, inspect its actual local configuration/status, obtain its real reachable URL, and request <middleware-url>/health from this runtime. Select the first method whose health response is successful.
- Tailscale: require a logged-in VPS and an actual MagicDNS name or 100.x.y.z address from tailscale status. Never invent a Tailscale URL.
- Cloudflare Tunnel: require an existing named cloudflared tunnel with a configured public hostname that routes to this Middleware. Do not create a temporary trycloudflare.com tunnel or invent a hostname.
- ngrok: require a running ngrok tunnel that forwards to this Middleware and use its actual public URL. Do not invent an ngrok URL.
If no method is configured and healthy, do not return a Middleware URL or pairing code. Explain the result of each check and give the smallest next step for the user to configure one method.`,
  tailscale: `Connection method: TAILSCALE.
Use a Tailscale MagicDNS name or 100.x.y.z address only when Tailscale is configured and logged in on this VPS. Run tailscale status, obtain the actual hostname/IP, then request <middleware-url>/health from this runtime and require a successful response. Never invent or guess a Tailscale URL.
If Tailscale is not configured or the URL fails health verification, do not return a Middleware URL or pairing code. Tell the user to log in to Tailscale on this VPS and their Desktop device with the same account/tailnet, then retry.`,
  cloudflared: `Connection method: CLOUDFLARE TUNNEL.
Use Cloudflare only when cloudflared has an existing named tunnel with a configured public hostname that routes to this Middleware. Inspect the running service/configuration, obtain the real HTTPS hostname, then request <middleware-url>/health from this runtime and require a successful response. Never invent a Cloudflare hostname and do not create a temporary trycloudflare.com tunnel.
If no configured, healthy tunnel exists, do not return a Middleware URL or pairing code. State whether cloudflared is missing, logged out, stopped, missing a public hostname, or failing health verification, then give the next configuration step.`,
  ngrok: `Connection method: NGROK.
Use ngrok only when a running ngrok tunnel forwards to this Middleware. Inspect the local ngrok tunnel status/API, obtain its real public URL, then request <middleware-url>/health from this runtime and require a successful response. Never invent an ngrok URL.
If no running, healthy ngrok tunnel exists, do not return a Middleware URL or pairing code. State whether ngrok is missing, not authenticated, not running, forwarding to the wrong port, or failing health verification, then give the next configuration step.`,
}

export function buildVpsOpenClawPrompt(method: RemoteConnectivityMethod): string {
  return `Set up OpenClaw Desktop Middleware for REMOTE/VPS mode.

Context:
- OpenClaw Desktop will connect to Middleware running on this VPS/server.
- Desktop needs full OpenClaw access through Middleware: chats, sessions, cron, projects, workspace files, git, terminal, streams, usage, settings, and approvals.
- Do not stop after only starting the server. Run the smoke test below and fix failures.

Source:
- Repo: https://github.com/Nextbasedev/openclaw-desktop.git
- Branch: master

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway on this VPS:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout master, install, and build:
   - pnpm install --frozen-lockfile
   - pnpm --filter @openclaw/desktop-middleware build
4. Run apps/middleware on port 8787:
   - HOST=0.0.0.0
   - PORT=8787
   - NODE_ENV=production
   - OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   - WORKSPACE_ROOT=$HOME/.openclaw/workspace
   - MIDDLEWARE_TOKEN=<stable random secret>
   - MIDDLEWARE_PAIRING_CODE=<short readable code, 6-8 uppercase chars>
5. Run it as an auto-restarting service that survives crashes and reboot.
6. ${methodInstructions[method]}

Mandatory verification:
1. Run the repo smoke-test script using the final URL. It checks health, pairing/token, auth APIs, admin commands, cron, stream, chat send, workspace, and terminal.
2. Before the final response, independently request <middleware-url>/health from this runtime and confirm it returns a healthy Middleware response. Do not return a URL that fails this check.
3. If you have access to the Desktop device, verify the same URL there too. If you do not, do not call the URL broken or withhold valid credentials solely for that reason: return the server-verified URL, state that the Desktop check is still required, and give the exact <middleware-url>/health check for the user to run.

Command:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_PAIRING_CODE=<pairing-code> docs/installation/desktop-middleware-smoke-test.sh

If you already know the token, use:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_TOKEN=<token> docs/installation/desktop-middleware-smoke-test.sh

If the script fails because no model/API key is configured, say Middleware is working but chat model/provider is the blocker. For any other failure, fix it and rerun the script. Do not give the URL/code until the script prints DESKTOP_MIDDLEWARE_SMOKE_TEST_OK or you have one exact blocker.

When finished, reply only:
- If verified from this runtime:
  Connection method: <tailscale | cloudflared | ngrok>
  Middleware URL: <reachable-url>
  Pairing code: <code>
  Network note: <public domain | tailscale | reverse proxy | ngrok>
  Verified: final URL health check and desktop-smoke-test passed
  Desktop check: <passed | required — open <middleware-url>/health from the Desktop device>
  Blocker: none
- If blocked:
  Connection method: <requested method | none found>
  Middleware URL: not available
  Pairing code: not available
  Network note: <exact network blocker>
  Checks: <method-by-method results when Auto>
  Next steps: <specific configuration steps>
  Verified: not run
  Blocker: <exact blocker>`
}
