# OpenClaw Desktop Middleware Connectivity Guide

> **Goal:** prepare a VPS OpenClaw Middleware, discover one existing safe network path, return a usable URL and pairing code, and verify both before Desktop connects.

## Fast path: target one minute

Use this guide as a **read-only, bounded discovery pass** first. Give each local command and HTTP request a short timeout (about five seconds), check methods in order, and stop at the first fully verified method:

1. Tailscale
2. Cloudflare Tunnel
3. ngrok

Do **not** install packages, log in, create tunnels, restart services, change DNS, or change firewall settings during discovery. Those actions can take longer than a minute and need user intent. If no method is ready, return the exact blocker plus the smallest next step.

> A full first-time install/build can exceed one minute. The one-minute target applies to finding and validating an already-running Middleware and configured network path.

## Required repository state

Build and run Middleware only from the repository's up-to-date `master` branch. Before installing dependencies, building, or starting Middleware in an existing checkout, run:

```bash
git fetch origin master
git checkout master
git pull --ff-only origin master
```

If any command fails because the checkout has local changes or cannot fast-forward, stop and report that exact blocker. Do not use another branch, a stale `master`, or uncommitted code to run Middleware.

## Setup mode versus discovery mode

The fast path is a read-only discovery pass. A user may explicitly authorize a first-time setup, build, or Middleware restart. That authorization permits only the requested Middleware work; it does **not** authorize changing Tailscale, Cloudflare Tunnel, ngrok, DNS, firewall rules, or the managed OpenClaw Gateway.

Always validate local Middleware-to-Gateway compatibility before treating a remote network method as the blocker. A reachable Tailscale or tunnel URL does not make Desktop ready when `gateway.connected` is false.

## 1. Confirm the server and Gateway integration are ready

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

4. If Middleware is not running and setup/start was authorized, build and start `apps/middleware` using the repository installation instructions, preferably as an auto-restarting service. Do not claim a Desktop-ready network URL until Middleware is healthy.
5. Request the local Middleware `/health` endpoint before network discovery. Require:
   - `ok: true`
   - `service: "openclaw-middleware"`
   - `gateway.connected: true`
6. If `gateway.connected` is false, classify the local integration failure before checking or blaming the network:
   - **Gateway unavailable** — Gateway process, endpoint, or local reachability failed.
   - **Gateway authentication/configuration failure** — device approval, identity, token, or scope configuration failed.
   - **Gateway compatibility failure** — the WebSocket handshake reports protocol or version mismatch.
   - **Middleware startup/configuration failure** — Middleware cannot bind, start, or load its configuration.

For a compatibility failure, preserve the Middleware Git SHA/version, OpenClaw Gateway version, Gateway endpoint, and exact handshake error. Do not restart, upgrade, downgrade, or reconfigure the managed Gateway unless the user explicitly authorizes that change.

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

### Middleware reachable but not Desktop-ready

Use this format when a local Gateway failure prevents Desktop pairing, including when Tailscale or another network path has already been verified. The candidate URL is useful for diagnosis but is **not** a Desktop-ready URL.

```text
Setup status: blocked — <Gateway unavailable | Gateway authentication/configuration | Gateway compatibility | Middleware startup/configuration>
Middleware process: <running | failed>
Gateway integration: <unavailable | authentication/configuration failure | incompatible | not checked>
Middleware revision: <Git SHA/version | unavailable>
Gateway version: <version | unavailable>
Gateway endpoint: <ws://127.0.0.1:18789 | actual endpoint>
Gateway error: <exact error>
Network status: <verified | unavailable | not tested>
Candidate URL: <verified reachable URL | not available>
Desktop-ready URL: not available
Pairing code: withheld — Gateway integration not validated
Required action: <smallest safe remediation>
Verified: <checks that actually passed>
Blocker: <exact blocker>
```

## Troubleshooting rules

- A valid-looking URL is not valid until its own `/health` response and smoke test pass.
- If Middleware health succeeds but `gateway.connected` is false, the **Gateway integration** is not ready. Report a verified remote URL as a candidate URL when applicable, but do not return it or its pairing code as Desktop-ready.
- If the Gateway error says `protocol mismatch` or otherwise identifies a protocol/version incompatibility, use the `Middleware reachable but not Desktop-ready` response. Include both component versions and the exact error; do not label Tailscale, a tunnel, DNS, or firewall as the root blocker unless its own check failed.
- If the smoke test only fails because no model/API key is configured, report that Middleware/networking works and identify model/provider configuration as the blocker.
- For every other smoke-test failure, report the exact failure and do not return URL/code as ready.
- Do not expose the OpenClaw Gateway directly. Desktop connects only to Middleware.

## 6. Desktop connection flow

Desktop connects in this order:

1. It requests `<middleware-url>/health` with a three-second probe timeout.
2. It claims a pairing code at `POST <middleware-url>/pairing/claim`, unless the user supplied an existing token.
3. It validates the returned token with `GET <middleware-url>/api/version`.
4. It saves the returned URL/token only after the validation succeeds.

Give users a complete URL with its scheme and no trailing path, for example `http://100.x.y.z:8787` or `https://middleware.example.com`. Do not return `ws://`, an OpenClaw Gateway URL, a URL ending in `/health`, or a bare hostname.

Middleware permits Desktop browser/WebView origins through its CORS configuration. A failed Desktop connection is therefore usually a reachability, TLS, pairing, token, or proxy-routing problem—not a CORS workaround request. Do not ask users to disable browser security.

## 7. URL and pairing failure matrix

| User symptom | Required check | Correct handling |
| --- | --- | --- |
| URL has no `http://` or `https://` | Parse the final URL before testing | Return no credentials; provide the complete URL format. |
| `/health` times out, refuses connection, or returns HTML | Check Middleware process, host binding, port `8787`, DNS, firewall, and proxy route | Mark the method unhealthy and continue Auto discovery. Never return the URL. |
| `/health` returns JSON but `gateway.connected` is false | Run `openclaw gateway status` and preserve the health/handshake error | Classify Gateway unavailable, authentication/configuration, or compatibility failure. Report a verified remote URL only as a candidate; do not mark setup ready. |
| Gateway error says `protocol mismatch` or a version incompatibility | Record Middleware Git SHA/version, Gateway version, endpoint, and exact error | Report `Gateway integration: incompatible`; do not change a managed Gateway without explicit authorization and do not blame networking. |
| `/health` redirects or has TLS/certificate failure | Confirm the exact HTTPS hostname and certificate validity | Return the exact certificate/proxy blocker; do not downgrade HTTPS or bypass certificate validation. |
| Pairing claim is `401`, `403`, or says invalid/expired | Verify the current `MIDDLEWARE_PAIRING_CODE` and claim it only once | Return no saved connection. Generate/recover a current code only with user approval. |
| `/api/version` is `401` or `403` after pairing | Confirm the pair response token is used against the same URL | Treat the pairing/token as invalid; do not tell the user to retry an old code indefinitely. |
| Smoke test fails only for model/provider/API key | Read the smoke-test blocker text | Report networking and Middleware as working, with model/provider configuration as the remaining blocker. |
| Smoke test fails for any other API, cron, workspace, terminal, or chat check | Preserve the exact failing step | Do not return setup as complete; fix or clearly report that blocker. |
| Desktop cannot reach an otherwise verified server URL | Test from Desktop when available | Report the Desktop-side network/ACL/DNS issue separately. Do not label the VPS URL fake if server validation passed. |

## 8. Method-specific edge cases

### Tailscale

- Logged in is not enough: require a running backend, online VPS, and an actual Tailscale IP or MagicDNS name.
- The Desktop must use the same tailnet and be allowed by Tailscale ACLs. If a Desktop-side test fails, check its login state, `tailscale status`, and ACL policy before changing Middleware.
- Use the exact Tailscale address returned by status. Do not reuse a stale `100.x.y.z` address from an earlier login.

### Cloudflare Tunnel

- Require a named tunnel and a configured public hostname; a running connector without hostname routing is not usable.
- A `502`, `1033`, redirect-to-login page, or HTML response from `/health` is a failed route—not a healthy Middleware URL.
- If Cloudflare Access protects the hostname, verify Desktop has a supported authentication path before returning it. Do not claim the generic Desktop pairing token satisfies Cloudflare Access.
- Confirm the tunnel targets `http://127.0.0.1:8787` (or the actual local Middleware listener), not the OpenClaw Gateway port.

### ngrok

- Require an active HTTPS tunnel whose live forwarding target is Middleware port `8787`.
- A free-tier browser warning/interstitial, expired tunnel, changed hostname, or HTML response from `/health` is a failed route.
- ngrok URLs can change after restart. Re-read the live ngrok status/API every time; never reuse a cached URL.

## 9. Auto decision rules and progress messages

Auto must emit short progress updates so users know what is happening:

```text
Checking server and Middleware health…
Checking Middleware ↔ OpenClaw Gateway compatibility… <passed | unavailable | authentication/configuration failure | incompatible>
Checking Tailscale… <passed | logged out | offline | no usable address | unhealthy>
Checking Cloudflare Tunnel… <passed | missing | stopped | no hostname | wrongly routed | unhealthy>
Checking ngrok… <passed | missing | unauthenticated | stopped | wrongly routed | unhealthy>
Validating <selected-url>/health…
Running Desktop smoke test…
```

- Stop immediately after the first method passes the full health and smoke-test validation.
- If a method is configured but fails, keep its exact failure in `Checks` and continue to the next method.
- If a remote method passes its URL health request but local Gateway integration fails, preserve the passing network result and return the partial-response format above. Withhold the pairing code until Gateway integration and the smoke test pass.
- If nothing passes, return the blocked response format from this guide. Never return a plausible-looking URL, a stale pairing code, or a blank success message.
- The final response must name the selected method, exact URL, Desktop check status, and one actionable blocker when incomplete.
