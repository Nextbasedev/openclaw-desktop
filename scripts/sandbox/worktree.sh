#!/usr/bin/env bash
# worktree.sh — Manage git worktrees for parallel agent work
#
# Usage:
#   ./scripts/sandbox/worktree.sh create <branch-name> [port]
#   ./scripts/sandbox/worktree.sh destroy <branch-name>
#   ./scripts/sandbox/worktree.sh list
#
# Each worktree gets:
#   - Isolated git working directory at ../.worktrees/<branch-name>
#   - Dev server on specified port (default: auto-assigned 8787-8806)
#   - Own node_modules (pnpm install)

set -euo pipefail

WORKTREE_ROOT="$(git rev-parse --show-toplevel)/../.worktrees"
ACTION="${1:-list}"

_next_port() {
  local port=8787
  while [ $port -le 8806 ]; do
    if ! lsof -i ":${port}" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  echo "ERROR: No free ports in range 8787-8806" >&2
  exit 1
}

case "$ACTION" in
  create)
    BRANCH="${2:?Usage: worktree.sh create <branch-name> [port]}"
    PORT="${3:-$(_next_port)}"
    WORKTREE_PATH="${WORKTREE_ROOT}/${BRANCH}"

    if [ -d "$WORKTREE_PATH" ]; then
      echo "Worktree already exists: $WORKTREE_PATH"
      exit 1
    fi

    echo "=== Creating Worktree ==="
    echo "Branch: $BRANCH"
    echo "Path: $WORKTREE_PATH"
    echo "Port: $PORT"

    mkdir -p "$WORKTREE_ROOT"

    # Create branch and worktree
    git branch "$BRANCH" 2>/dev/null || true
    git worktree add "$WORKTREE_PATH" "$BRANCH"

    # Install dependencies
    cd "$WORKTREE_PATH"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install

    # Write port config
    echo "$PORT" > "$WORKTREE_PATH/.sandbox-port"

    echo ""
    echo "=== Worktree Ready ==="
    echo "Path: $WORKTREE_PATH"
    echo "Port: $PORT"
    echo ""
    echo "Start dev server:"
    echo "  cd $WORKTREE_PATH && pnpm --filter ui dev -- --port $PORT"
    echo ""
    echo "Verify UI:"
    echo "  ./scripts/sandbox/verify-ui.sh $PORT"
    ;;

  destroy)
    BRANCH="${2:?Usage: worktree.sh destroy <branch-name>}"
    WORKTREE_PATH="${WORKTREE_ROOT}/${BRANCH}"

    if [ ! -d "$WORKTREE_PATH" ]; then
      echo "Worktree not found: $WORKTREE_PATH"
      exit 1
    fi

    # Kill dev server if running
    PORT_FILE="${WORKTREE_PATH}/.sandbox-port"
    if [ -f "$PORT_FILE" ]; then
      PORT=$(cat "$PORT_FILE")
      lsof -ti ":${PORT}" 2>/dev/null | xargs kill 2>/dev/null || true
    fi

    # Remove worktree
    git worktree remove "$WORKTREE_PATH" --force
    git branch -D "$BRANCH" 2>/dev/null || true

    echo "Destroyed worktree: $BRANCH"
    ;;

  list)
    echo "=== Active Worktrees ==="
    git worktree list
    echo ""
    if [ -d "$WORKTREE_ROOT" ]; then
      echo "=== Sandbox Worktrees ==="
      for dir in "$WORKTREE_ROOT"/*/; do
        if [ -d "$dir" ]; then
          name=$(basename "$dir")
          port="N/A"
          [ -f "${dir}.sandbox-port" ] && port=$(cat "${dir}.sandbox-port")
          echo "  $name (port: $port)"
        fi
      done
    else
      echo "No sandbox worktrees."
    fi
    ;;

  *)
    echo "Usage: worktree.sh {create|destroy|list} [args...]"
    exit 1
    ;;
esac
