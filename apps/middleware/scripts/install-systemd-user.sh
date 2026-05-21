#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${OPENCLAW_DESKTOP_DIR:-$(pwd)}
PORT=${PORT:-8787}
HOST=${HOST:-0.0.0.0}
PAIRING_CODE=${MIDDLEWARE_PAIRING_CODE:-$(node -e "console.log(require('crypto').randomBytes(3).toString('hex').toUpperCase())")}
TOKEN=${MIDDLEWARE_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}
SERVICE_NAME=${OPENCLAW_MIDDLEWARE_SERVICE_NAME:-openclaw-desktop-middleware}
SYSTEMD_USER_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
ENV_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/openclaw
ENV_FILE=$ENV_DIR/desktop-middleware.env
SERVICE_FILE=$SYSTEMD_USER_DIR/$SERVICE_NAME.service

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for systemd user install" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/pnpm-workspace.yaml" ]]; then
  echo "Run this from the openclaw-desktop repo, or set OPENCLAW_DESKTOP_DIR=/path/to/openclaw-desktop" >&2
  exit 1
fi

mkdir -p "$SYSTEMD_USER_DIR" "$ENV_DIR"
cd "$APP_DIR"
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @openclaw/desktop-middleware build

cat > "$ENV_FILE" <<EOF
HOST=$HOST
PORT=$PORT
MIDDLEWARE_PAIRING_CODE=$PAIRING_CODE
MIDDLEWARE_TOKEN=$TOKEN
EOF
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenClaw Desktop Middleware
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v pnpm) --filter @openclaw/desktop-middleware start
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME.service"

cat <<EOF
OpenClaw Desktop Middleware systemd user service installed.
Service: $SERVICE_NAME
Status: systemctl --user status $SERVICE_NAME --no-pager
Logs: journalctl --user -u $SERVICE_NAME -f
Local URL: http://127.0.0.1:$PORT
Pairing code: $PAIRING_CODE

Optional: keep user services running after logout:
  loginctl enable-linger "$USER"
EOF
