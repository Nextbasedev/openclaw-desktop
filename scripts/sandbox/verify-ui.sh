#!/usr/bin/env bash
# verify-ui.sh — compatibility wrapper for the Node Chrome DevTools MCP verifier
#
# Usage: ./scripts/sandbox/verify-ui.sh [port] [path]
#   port  — dev server port (default: 3000)
#   path  — URL path to verify (default: /)

set -euo pipefail

PORT="${1:-3000}"
URL_PATH="${2:-/}"

node scripts/sandbox/verify-ui.mjs --port="${PORT}" --path="${URL_PATH}" "${@:3}"
