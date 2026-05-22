# Desktop Middleware setup reliability notes

## Startup Gateway connection

The middleware should begin connecting to Gateway immediately after the HTTP server starts. Routes still keep lazy reconnect behavior, but startup auto-connect avoids a cold process sitting disconnected until the first desktop request.

Expected behavior:

- Middleware starts HTTP first.
- Gateway connect starts in the background.
- Failures are logged and retried with backoff.
- HTTP health/status routes remain available while Gateway is disconnected.

## Chat send contract

`/api/chat/send` requires `idempotencyKey` and forwards that key to Gateway `chat.send`.

`execPolicy` is middleware/session configuration, not a `chat.send` field. Middleware applies it with `sessions.patch` before sending the message.

## Cron/SSE streaming

`/api/stream/cron` is a Server-Sent Events endpoint. It emits a `cron.ready` event on connect, then cron events and heartbeats.

Known proxy limitation: Cloudflare/trycloudflare-style tunnels may buffer or interrupt SSE. Prefer direct LAN, localhost, Tailscale, or a WebSocket/polling fallback for streaming surfaces.

## Linux persistence

For Linux users, prefer the systemd user installer:

```bash
cd /path/to/openclaw-desktop
apps/middleware/scripts/install-systemd-user.sh
```

Useful commands:

```bash
systemctl --user status openclaw-desktop-middleware --no-pager
journalctl --user -u openclaw-desktop-middleware -f
systemctl --user restart openclaw-desktop-middleware
```

If the service must survive logout, enable linger:

```bash
loginctl enable-linger "$USER"
```

macOS and Windows should use equivalent launchd / scheduled-task wrappers until native installers ship.
