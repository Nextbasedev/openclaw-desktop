#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${OPENCLAW_DESKTOP_DIR:-$(pwd)}
PORT=${PORT:-8787}
HOST=${HOST:-0.0.0.0}
PAIRING_CODE=${MIDDLEWARE_PAIRING_CODE:-$(node -e "console.log(require('crypto').randomBytes(3).toString('hex').toUpperCase())")}
TOKEN=${MIDDLEWARE_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}
REPO_URL=${OPENCLAW_DESKTOP_REPO:-https://github.com/Nextbasedev/openclaw-desktop.git}
BRANCH=${OPENCLAW_DESKTOP_BRANCH:-main}
INSTALL_DIR=${OPENCLAW_DESKTOP_INSTALL_DIR:-/opt/openclaw-desktop}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd node
need_cmd corepack

if [[ ! -f "$APP_DIR/pnpm-workspace.yaml" ]]; then
  APP_DIR="$INSTALL_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  else
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
  fi
fi

cd "$APP_DIR"
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @openclaw/desktop-middleware build

cat <<EOF
OpenClaw Desktop Middleware installed.
Middleware URL: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1):$PORT
Local URL: http://127.0.0.1:$PORT

Pairing code: $PAIRING_CODE

Start explicitly with:
  cd $APP_DIR && HOST=$HOST PORT=$PORT MIDDLEWARE_PAIRING_CODE=$PAIRING_CODE MIDDLEWARE_TOKEN=$TOKEN pnpm --filter @openclaw/desktop-middleware start

Install as a Linux systemd user service:
  cd $APP_DIR && HOST=$HOST PORT=$PORT MIDDLEWARE_PAIRING_CODE=$PAIRING_CODE MIDDLEWARE_TOKEN=$TOKEN apps/middleware/scripts/install-systemd-user.sh

Smoke test after starting:
  cd $APP_DIR && MIDDLEWARE_TEST_URL=http://127.0.0.1:$PORT pnpm --filter @openclaw/desktop-middleware smoke
EOF
