# OpenClaw Desktop Local Middleware Setup Guide

> **Goal:** connect OpenClaw Desktop to Middleware running on the same computer, or clearly route the user to Remote setup when another device/network is involved.

## Choose the correct connection mode first

| Where Desktop and Middleware run | Use this form | URL | Pairing code |
| --- | --- | --- | --- |
| Same computer | **Local connection** | `http://127.0.0.1:8787` | Not needed |
| Different computers on the same LAN | **Remote connection** | Actual LAN URL, for example `http://192.168.x.x:8787` | Required |
| Different computers over Tailscale, Cloudflare Tunnel, or ngrok | **Remote connection** | Verified network URL | Required |

**Important:** Local connection is only for the same computer. A LAN IP, Tailscale address, Cloudflare hostname, or ngrok URL is not local from Desktop's point of view. Do not paste those into the Local form; use Remote connection and the VPS/network setup guide instead.

## 1. Fast local setup

1. Confirm Node.js 22+ and pnpm are installed.
2. Confirm the local OpenClaw Gateway is running:

   ```bash
   openclaw gateway status
   ```

3. Run Middleware locally on loopback port `8787`:

   ```text
   HOST=127.0.0.1
   PORT=8787
   NODE_ENV=production
   OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   WORKSPACE_ROOT=$HOME/.openclaw/workspace
   ```

4. In Desktop, choose **Local connection** and use **Start / detect local backend**. If auto-detect does not find it, enter:

   ```text
   http://127.0.0.1:8787
   ```

5. Verify `http://127.0.0.1:8787/health` returns healthy Middleware JSON with `ok: true` and `gateway.connected: true`.

Local setup does not need a pairing code because Desktop and Middleware are on the same computer.

## 2. Dynamic local discovery

Check these local URLs quickly, in order, with short timeouts:

1. `http://127.0.0.1:8787`
2. `http://localhost:8787`
3. The configured local Middleware URL, if the port was changed

Choose the first URL whose `/health` response is healthy and has a connected OpenClaw Gateway. Do not guess a port or mark a URL ready from a process list alone.

## 3. When local setup must not be used

Move to **Remote connection** if any condition below is true:

- Desktop and Middleware are not on the same computer.
- You need a LAN IP, Tailscale, Cloudflare Tunnel, ngrok, domain, or public URL.
- Middleware is bound to another machine or a VM/container that Desktop cannot reach through loopback.
- You need a pairing code or token to connect.

Follow the remote guide for those cases:

https://github.com/Nextbasedev/openclaw-desktop/blob/prompt-fix/docs/setup/setup.md

The Remote guide discovers Tailscale, Cloudflare Tunnel, and ngrok; creates/requires a pairing code; validates the exact URL; and handles network failures.

## 4. Local error handling

| Symptom | Check | Correct response |
| --- | --- | --- |
| No local Middleware found | Confirm process/service and `HOST=127.0.0.1`, port `8787` | Start Middleware, then retry detection. |
| Connection refused or timeout | Check port, local firewall, and URL scheme | Do not switch to a guessed LAN/public URL. |
| Health is healthy but `gateway.connected` is false | Run `openclaw gateway status` | Start/fix the local Gateway before connecting. |
| `/api/version` fails after health | Check local Middleware configuration/version | Report the exact API error; do not call setup complete. |
| URL is a LAN/Tailscale/domain/tunnel address | Confirm topology | Use Remote connection with a pairing code instead. |
| Existing saved local URL stopped working | Re-run local detection | Keep the URL only if health and Gateway checks pass again. |

## 5. Final response format

### Same-computer local setup ready

```text
Middleware URL: http://127.0.0.1:8787
Pairing code: not required (same computer)
Network note: local loopback
Verified: health and local Desktop API checks passed
Blocker: none
```

### Local setup blocked

```text
Middleware URL: not available
Pairing code: not required for local setup
Network note: local loopback
Next steps: <exact local process, port, or Gateway action>
Verified: not run
Blocker: <exact blocker>
```

### Another device/network is required

```text
Middleware URL: not available from Local connection
Pairing code: required in Remote connection
Network note: remote network required
Next steps: choose Remote connection and follow docs/setup/setup.md
Blocker: Middleware is not running on this same computer
```
