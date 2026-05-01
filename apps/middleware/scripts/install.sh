#!/usr/bin/env bash
set -euo pipefail
APP_DIR=${OPENCLAW_MIDDLEWARE_DIR:-/opt/openclaw-middleware}
PORT=${PORT:-8787}
HOST=${HOST:-0.0.0.0}
TOKEN=${MIDDLEWARE_TOKEN:-$(openssl rand -hex 32)}
echo "OpenClaw Middleware installer draft"
echo "Install dir: $APP_DIR"
echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "Token: $TOKEN"
