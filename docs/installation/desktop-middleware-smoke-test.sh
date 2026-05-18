#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MIDDLEWARE_TEST_URL:-${1:-http://127.0.0.1:8787}}"
PAIRING_CODE="${MIDDLEWARE_PAIRING_CODE:-${2:-}}"
TOKEN="${MIDDLEWARE_TOKEN:-${3:-}}"
BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "BLOCKER: curl is required" >&2
  exit 1
fi

json_get() {
  node -e "const fs=require('fs'); const path=process.argv[1].split('.'); let value=JSON.parse(fs.readFileSync(0,'utf8')); for (const key of path) value=value?.[key]; if (value===undefined||value===null) process.exit(1); process.stdout.write(String(value));" "$1"
}

curl_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      --data "$body"
  else
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "Authorization: Bearer $TOKEN"}
  fi
}

assert_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  if [[ "$value" != *"$expected"* ]]; then
    echo "BLOCKER: $label did not include $expected" >&2
    echo "$value" >&2
    exit 1
  fi
}

echo "== health =="
HEALTH="$(curl -fsS "$BASE_URL/health")"
assert_contains "$HEALTH" '"service":"openclaw-middleware"' "health"
assert_contains "$HEALTH" '"connected":true' "OpenClaw Gateway connection"

if [[ -z "$TOKEN" ]]; then
  if [[ -z "$PAIRING_CODE" ]]; then
    echo "BLOCKER: provide MIDDLEWARE_TOKEN or MIDDLEWARE_PAIRING_CODE" >&2
    exit 1
  fi
  echo "== pairing =="
  PAIRING="$(curl -fsS -X POST "$BASE_URL/pairing/claim" -H 'Content-Type: application/json' --data "{\"code\":\"$PAIRING_CODE\"}")"
  assert_contains "$PAIRING" '"ok":true' "pairing"
  TOKEN="$(printf '%s' "$PAIRING" | json_get token)"
fi

SESSION_KEY="agent:main:desktop-smoke-$(date +%s)-$RANDOM"
CRON_JOB_ID=""
TERMINAL_ID=""

cleanup() {
  if [[ -n "$TERMINAL_ID" ]]; then
    curl_json POST "/api/terminal/$TERMINAL_ID/kill" '{}' >/dev/null 2>&1 || true
  fi
  if [[ -n "$CRON_JOB_ID" ]]; then
    curl_json POST "/api/commands/middleware_cron_delete_job" "{\"input\":{\"id\":\"$CRON_JOB_ID\"}}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== authenticated desktop APIs =="
assert_contains "$(curl_json GET /api/version)" '"service":"openclaw-middleware"' "version"
curl_json GET /api/bootstrap >/dev/null
curl_json GET /api/workspace/capabilities >/dev/null
curl_json GET /api/projects >/dev/null
curl_json POST /api/commands/middleware_commands_list '{"input":{}}' >/dev/null
curl_json POST /api/commands/middleware_usage '{"input":{"days":1}}' >/dev/null

echo "== cron =="
CRON_CREATE="$(curl_json POST /api/commands/middleware_cron_create_job '{"input":{"name":"Desktop smoke test","schedule":"* * * * *","message":"DESKTOP_MIDDLEWARE_CRON_SMOKE","enabled":false,"paused":true}}')"
CRON_JOB_ID="$(printf '%s' "$CRON_CREATE" | node -e "const b=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(b.jobId||b.job?.jobId||b.job?.id||''));")"
[[ -n "$CRON_JOB_ID" ]] || { echo "BLOCKER: cron job id missing" >&2; exit 1; }
curl_json POST /api/commands/middleware_cron_list_jobs '{"input":{}}' >/dev/null
curl_json POST /api/commands/middleware_cron_list_runs "{\"input\":{\"jobId\":\"$CRON_JOB_ID\"}}" >/dev/null
CRON_STREAM_OUTPUT="$(timeout 3s curl -fsS -N "$BASE_URL/api/stream/cron" -H "Authorization: Bearer $TOKEN" 2>/dev/null || true)"
if ! printf '%s' "$CRON_STREAM_OUTPUT" | grep -q 'cron stream ready'; then
  echo "BLOCKER: cron event stream did not open" >&2
  exit 1
fi

echo "== workspace and terminal =="
curl_json GET '/api/workspace/tree?path=' >/dev/null
TERM_RESPONSE="$(curl_json POST /api/terminal/spawn '{"cols":80,"rows":24,"command":"pwd"}')"
TERMINAL_ID="$(printf '%s' "$TERM_RESPONSE" | json_get terminalId)"
[[ -n "$TERMINAL_ID" ]] || { echo "BLOCKER: terminal id missing" >&2; exit 1; }

echo "== chat send smoke =="
CHAT_BODY="$(node -e "console.log(JSON.stringify({input:{sessionKey:process.argv[1],message:'Reply exactly DESKTOP_MIDDLEWARE_SMOKE_OK',execPolicy:{security:'allowlist',ask:'on-miss'},timeoutMs:60000}}))" "$SESSION_KEY")"
if ! CHAT_RESPONSE="$(curl_json POST /api/commands/middleware_chat_send "$CHAT_BODY" 2>&1)"; then
  if echo "$CHAT_RESPONSE" | grep -Eiq 'model|provider|api key|auth|credit|quota|rate'; then
    echo "BLOCKER: Middleware is reachable, but chat model/provider is not configured: $CHAT_RESPONSE" >&2
    exit 2
  fi
  echo "BLOCKER: chat send failed: $CHAT_RESPONSE" >&2
  exit 1
fi
assert_contains "$CHAT_RESPONSE" '"ok":true' "chat send"

echo "DESKTOP_MIDDLEWARE_SMOKE_TEST_OK"
echo "Middleware URL: $BASE_URL"
echo "Verified: health, pairing/token, auth APIs, admin commands, cron, stream, chat send, workspace, terminal"
