#!/usr/bin/env bash
# check-build.sh — Full build verification for agents
#
# Usage: ./scripts/sandbox/check-build.sh
#
# Runs all checks and outputs structured results agents can parse.
# Exit code 0 = all passed, non-zero = failures exist.

set -uo pipefail

PASS=0
FAIL=0
RESULTS=""

_check() {
  local name="$1"
  shift
  echo "--- Checking: $name ---"
  if "$@" 2>&1; then
    RESULTS="${RESULTS}\n✅ ${name}"
    PASS=$((PASS + 1))
  else
    RESULTS="${RESULTS}\n❌ ${name}"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

echo "=== Jarvis Build Check ==="
echo ""

# TypeScript type checking
_check "TypeScript" pnpm --filter ui exec tsc --noEmit

# ESLint
_check "ESLint" pnpm --filter ui lint

# Architecture lint (custom)
_check "Architecture" pnpm lint:architecture

# Unit tests
_check "Unit Tests" pnpm test -- --run

# Build
_check "Build" pnpm --filter ui build

echo ""
echo "=== Results ==="
echo -e "$RESULTS"
echo ""
echo "Passed: $PASS | Failed: $FAIL"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
