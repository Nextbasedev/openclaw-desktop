# OpenClaw Desktop Middleware Connectivity Guide

> **Goal:** prepare a VPS OpenClaw Middleware, discover one existing safe network path, return a usable URL and pairing code, and verify both before Desktop connects.

## Fast path: target one minute

Use this guide as a **read-only, bounded discovery pass** first. Give each local command and HTTP request a short timeout (about five seconds), check methods in order, and stop at the first fully verified method:

1. Tailscale
2. Cloudflare Tunnel
3. ngrok

Do **not** install packages, log in, create tunnels, restart services, change DNS, or change firewall settings during discovery. Those actions can take longer than a minute and need user intent. If no method is ready, return the exact blocker plus the smallest next step.

> A full first-time install/build can exceed one minute. The one-minute target applies to finding and validating an already-running Middleware and configured network path.

## 1. Confirm the server is ready

1. Confirm Node.js 22+ and pnpm are available.
2. Confirm OpenClaw Gateway is running:

   ```bash
   openclaw gateway status
   ```

   Middleware connects to the local Gateway at `ws://127.0.0.1:18789`.
3. Ensure Middleware is running on port `8787` with:

   ```text
   HOST=0.0.0.0
   PORT=8787
   NODE_ENV=production
   OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   WORKSPACE_ROOT=$HOME/.openclaw/workspace
   MIDDLEWARE_TOKEN=<stable-random-secret>
   MIDDLEWARE_PAIRING_CODE=<6-8-uppercase-code>
   ```

4. If Middleware is not running, build and start `apps/middleware` using the repository installation instructions, preferably as an auto-restarting service. Do not claim a network URL until Middleware is healthy.

## 2. Create or recover a pairing code

Set `MIDDLEWARE_PAIRING_CODE` to a short, readable, randomly generated 6–8 character uppercase code when starting Middleware. Keep it available only for pairing. If the service is already running, recover the code from its approved service configuration or generate a new one and restart only when the user requested that change.

Never return a token or pairing code before the chosen network URL is fully verified.

## 3. Discover a network method

For each method, first confirm it is configured and live, then derive its URL from live status/configuration. Never invent a hostname, Tailscale IP, or tunnel URL.

### Tailscale

Use only when all are true:

- `tailscale` CLI exists.
- `tailscale status` or `tailscale status --json` shows a logged-in, running backend and an online VPS.
- It reports a real MagicDNS name or `100.x.y.z` Tailscale IP.

Build the candidate as `http://<actual-tailscale-host-or-ip>:8787` unless existing configured HTTPS routing says otherwise.

**Missing / failed states**

- CLI missing → install Tailscale on the VPS.
- Logged out → run `sudo tailscale up` and sign in.
- Desktop is not in the same tailnet → sign in on Desktop with the same account/tailnet.
- URL health check fails → confirm Middleware is listening on `0.0.0.0:8787`; do not return the URL.

### Cloudflare Tunnel

Use only when all are true:

- `cloudflared` exists and its named tunnel/service is running.
- A real, configured public HTTPS hostname routes to this Middleware on port `8787`.
- The exact hostname health check succeeds.

Read the existing service/configuration or Cloudflare tunnel status to obtain the hostname. Do **not** create a temporary `trycloudflare.com` tunnel and do not guess a public hostname.

**Missing / failed states**

- `cloudflared` missing or logged out → report it and provide the Cloudflare login/configuration step.
- Tunnel stopped → report the service/tunnel name and ask the user to start it.
- Hostname missing or routes to the wrong port → report that exact routing issue.

### ngrok

Use only when all are true:

- ngrok is authenticated and running.
- Its local API/status reports an active public **HTTPS** tunnel forwarding to Middleware port `8787`.
- The exact public URL health check succeeds.

Read the actual URL from the running ngrok status/API. Never guess an ngrok URL.

**Missing / failed states**

- ngrok missing/not authenticated → report the missing install or auth configuration.
- No active tunnel → ask the user to run a persistent `ngrok http 8787` service.
- Tunnel points to another port or health fails → report the forwarding/health failure; do not return its URL.

## 4. Validate the final URL

For every candidate URL, use that exact URL for both checks:

1. Request `<middleware-url>/health` from the current runtime with a bounded timeout.
2. Require healthy JSON with all of:
   - `ok: true`
   - `service: "openclaw-middleware"`
   - `gateway.connected: true`
3. Run the repository smoke test:

   ```bash
   MIDDLEWARE_TEST_URL=<middleware-url> \
   MIDDLEWARE_PAIRING_CODE=<pairing-code> \
   docs/installation/desktop-middleware-smoke-test.sh
   ```

   It must print `DESKTOP_MIDDLEWARE_SMOKE_TEST_OK`.

4. If the agent can access the Desktop device, open the same `<middleware-url>/health` there too. If it cannot, do not call a server-verified URL broken solely for that reason: return it with a required Desktop check.

## 5. Return the result

### Ready

```text
Connection method: <tailscale | cloudflared | ngrok>
Middleware URL: <verified-url>
Pairing code: <code>
Network note: <tailscale | public domain | ngrok>
Verified: final URL health check and desktop-smoke-test passed
Desktop check: <passed | required — open <middleware-url>/health from the Desktop device>
Blocker: none
```

### No method is ready

```text
Connection method: none found
Middleware URL: not available
Pairing code: not available
Network note: <exact network blocker>
Checks:
- Tailscale: <missing | logged out | stopped | unhealthy | passed>
- Cloudflare Tunnel: <missing | logged out | stopped | wrongly routed | unhealthy | passed>
- ngrok: <missing | unauthenticated | stopped | wrongly routed | unhealthy | passed>
Next steps: <the smallest safe configuration action>
Verified: not run
Blocker: <exact blocker>
```

## Troubleshooting rules

- A valid-looking URL is not valid until its own `/health` response and smoke test pass.
- If Middleware health succeeds but `gateway.connected` is false, the network path is not ready; fix/start the local OpenClaw Gateway.
- If the smoke test only fails because no model/API key is configured, report that Middleware/networking works and identify model/provider configuration as the blocker.
- For every other smoke-test failure, report the exact failure and do not return URL/code as ready.
- Do not expose the OpenClaw Gateway directly. Desktop connects only to Middleware.
