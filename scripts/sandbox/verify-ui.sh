#!/usr/bin/env bash
# verify-ui.sh — Agent UI verification via chrome-devtools-axi
#
# Usage: ./scripts/sandbox/verify-ui.sh [port] [path]
#   port  — dev server port (default: 3000)
#   path  — URL path to verify (default: /)
#
# Output: DOM snapshot + screenshot saved to .sandbox/screenshots/
#
# Prerequisites: chrome-devtools-axi installed (npx chrome-devtools-axi)

set -euo pipefail

PORT="${1:-3000}"
URL_PATH="${2:-/}"
SCREENSHOT_DIR=".sandbox/screenshots"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$SCREENSHOT_DIR"

echo "=== Jarvis UI Verification ==="
echo "Target: http://localhost:${PORT}${URL_PATH}"
echo ""

# Check if dev server is running
if ! curl -s -o /dev/null "http://localhost:${PORT}" 2>/dev/null; then
  echo "ERROR: Dev server not running on port ${PORT}"
  echo "Start it with: pnpm --filter ui dev -- --port ${PORT}"
  exit 1
fi

# Navigate and snapshot
echo "--- Opening page ---"
npx chrome-devtools-axi open "http://localhost:${PORT}${URL_PATH}" 2>/dev/null

echo ""
echo "--- DOM Snapshot ---"
npx chrome-devtools-axi snapshot -i 2>/dev/null

echo ""
echo "--- Screenshot ---"
SCREENSHOT_FILE="${SCREENSHOT_DIR}/verify_${TIMESTAMP}.png"
npx chrome-devtools-axi screenshot "${SCREENSHOT_FILE}" 2>/dev/null
echo "Saved: ${SCREENSHOT_FILE}"

echo ""
echo "--- Console Errors ---"
npx chrome-devtools-axi console errors 2>/dev/null || echo "(no console errors)"

echo ""
echo "--- Closing ---"
npx chrome-devtools-axi close 2>/dev/null

echo ""
echo "=== Verification Complete ==="
