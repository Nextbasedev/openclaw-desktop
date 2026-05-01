#!/usr/bin/env bash
set -euo pipefail
APP_DIR=${OPENCLAW_MIDDLEWARE_DIR:-/opt/openclaw-middleware}
PORT=${PORT:-8787}
HOST=${HOST:-0.0.0.0}
TOKEN=${MIDDLEWARE_TOKEN:-$(openssl rand -hex 32)}
PAIRING_CODE=${MIDDLEWARE_PAIRING_CODE:-$(openssl rand -hex 3 | tr '[:lower:]' '[:upper:]')}
URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "OpenClaw Middleware installer"
echo "Install dir: $APP_DIR"
echo "Middleware URL: $URL"
echo "Pairing code: $PAIRING_CODE"
echo ""
echo "Paste the Middleware URL and pairing code into OpenClaw Desktop."
echo "Advanced token: $TOKEN"
