#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${OPENCLAW_MIDDLEWARE_DIR:-/opt/openclaw-middleware}
PORT=${PORT:-8787}
HOST=${HOST:-0.0.0.0}
TOKEN=${MIDDLEWARE_TOKEN:-$(openssl rand -hex 32)}
PAIRING_CODE=${MIDDLEWARE_PAIRING_CODE:-$(openssl rand -hex 3 | tr '[:lower:]' '[:upper:]')}
REPO_URL=${OPENCLAW_DESKTOP_REPO:-https://github.com/Nextbasedev/openclaw-desktop.git}
BRANCH=${OPENCLAW_DESKTOP_BRANCH:-main}
SERVICE_NAME=${OPENCLAW_MIDDLEWARE_SERVICE:-openclaw-middleware}
ENV_FILE=/etc/openclaw-middleware.env
SERVICE_FILE=/etc/systemd/system/${SERVICE_NAME}.service
URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Please run this installer as root so it can create the auto-start service."
  echo "Example: sudo bash apps/middleware/scripts/install.sh"
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

need_cmd git
need_cmd node
need_cmd corepack
need_cmd openssl
need_cmd systemctl

mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
fi

corepack enable
cd "$APP_DIR"
pnpm install --frozen-lockfile
pnpm --filter @openclaw/desktop-middleware build

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=$HOST
PORT=$PORT
MIDDLEWARE_TOKEN=$TOKEN
MIDDLEWARE_PAIRING_CODE=$PAIRING_CODE
MIDDLEWARE_DB=/var/lib/openclaw-middleware/state.sqlite
WORKSPACE_ROOT=/root/.openclaw/workspace
EOF

mkdir -p /var/lib/openclaw-middleware /root/.openclaw/workspace
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=OpenClaw Middleware
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/apps/middleware
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/apps/middleware/dist/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 1
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Service failed to start. Logs:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 80
  exit 1
fi

echo "OpenClaw Middleware installed and auto-start enabled."
echo "Middleware URL: $URL"
echo "Pairing code: $PAIRING_CODE"
echo ""
echo "Paste the Middleware URL and pairing code into OpenClaw Desktop."
echo "Advanced token: $TOKEN"
echo ""
echo "Service commands:"
echo "  systemctl status $SERVICE_NAME --no-pager"
echo "  systemctl restart $SERVICE_NAME"
echo "  journalctl -u $SERVICE_NAME -f"
