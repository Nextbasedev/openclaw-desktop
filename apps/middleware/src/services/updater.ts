import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

export type MiddlewareUpdateStatus = {
  state: "idle" | "running" | "restarting" | "succeeded" | "failed"
  startedAt?: string
  updatedAt: string
  message?: string
  repoRoot?: string
  branch?: string
  logPath?: string
}

const REPO_URL = "https://github.com/Nextbasedev/openclaw-desktop.git"
const BRANCH = "main"
const SERVICE_NAME = process.env.OPENCLAW_MIDDLEWARE_SERVICE || "openclaw-middleware"
const STATUS_PATH = process.env.OPENCLAW_MIDDLEWARE_UPDATE_STATUS || path.join(os.tmpdir(), "openclaw-middleware-update-status.json")
const LOG_PATH = process.env.OPENCLAW_MIDDLEWARE_UPDATE_LOG || path.join(os.tmpdir(), "openclaw-middleware-update.log")

function now() {
  return new Date().toISOString()
}

function findRepoRoot() {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, ".git")) && fs.existsSync(path.join(dir, "package.json"))) return dir
    const next = path.dirname(dir)
    if (next === dir) break
    dir = next
  }
  return path.resolve(process.cwd(), "../..")
}

function readStatus(): MiddlewareUpdateStatus {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as MiddlewareUpdateStatus
    if (parsed?.state && parsed?.updatedAt) return parsed
  } catch {}
  return { state: "idle", updatedAt: now(), branch: BRANCH, logPath: LOG_PATH }
}

function writeStatus(status: MiddlewareUpdateStatus) {
  fs.writeFileSync(STATUS_PATH, JSON.stringify({ ...status, updatedAt: now() }, null, 2))
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function middlewareUpdateStatus() {
  return readStatus()
}

export function startMiddlewareUpdate() {
  const current = readStatus()
  if (current.state === "running" || current.state === "restarting") {
    return { ok: true, accepted: false, status: current, message: "Middleware update is already running" }
  }

  const repoRoot = findRepoRoot()
  const startedAt = now()
  const status: MiddlewareUpdateStatus = {
    state: "running",
    startedAt,
    updatedAt: startedAt,
    message: `Updating OpenClaw Desktop Middleware from ${BRANCH}`,
    repoRoot,
    branch: BRANCH,
    logPath: LOG_PATH,
  }
  writeStatus(status)
  fs.writeFileSync(LOG_PATH, `[${startedAt}] Starting OpenClaw Middleware update\n`)

  const script = `
set -euo pipefail
STATUS=${shellQuote(STATUS_PATH)}
LOG=${shellQuote(LOG_PATH)}
REPO=${shellQuote(repoRoot)}
BRANCH=${shellQuote(BRANCH)}
REPO_URL=${shellQuote(REPO_URL)}
SERVICE=${shellQuote(SERVICE_NAME)}
write_status() {
  node -e "const fs=require('fs'); const p=process.argv[1]; const state=process.argv[2]; const message=process.argv[3]; const repo=process.argv[4]; const branch=process.argv[5]; const log=process.argv[6]; fs.writeFileSync(p, JSON.stringify({state, message, repoRoot: repo, branch, logPath: log, updatedAt: new Date().toISOString()}, null, 2))" "$STATUS" "$1" "$2" "$REPO" "$BRANCH" "$LOG"
}
exec >>"$LOG" 2>&1
trap 'code=$?; write_status failed "Middleware update failed with exit code $code; see $LOG"; exit $code' ERR
cd "$REPO"
echo "[$(date -u +%FT%TZ)] Fetching $BRANCH from $REPO_URL"
git remote set-url origin "$REPO_URL" || true
git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[$(date -u +%FT%TZ)] Preserving local changes in git stash"
  git stash push -u -m "openclaw-middleware-update-$(date -u +%Y%m%dT%H%M%SZ)" || true
fi
git checkout -B "$BRANCH" "refs/remotes/origin/$BRANCH"
git reset --hard "refs/remotes/origin/$BRANCH"
if command -v corepack >/dev/null 2>&1; then corepack enable || true; fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found; trying corepack pnpm"
fi
echo "[$(date -u +%FT%TZ)] Installing dependencies"
pnpm install --frozen-lockfile
echo "[$(date -u +%FT%TZ)] Building middleware"
pnpm --filter @openclaw/desktop-middleware build
write_status restarting "Build completed; restarting ${SERVICE_NAME}"
echo "[$(date -u +%FT%TZ)] Restarting $SERVICE"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1; then
  systemctl restart "$SERVICE"
else
  write_status failed "systemd service $SERVICE was not found; build succeeded but restart is manual"
  exit 1
fi
`

  const child = spawn("bash", ["-lc", script], { detached: true, stdio: "ignore" })
  child.unref()

  return { ok: true, accepted: true, status }
}
