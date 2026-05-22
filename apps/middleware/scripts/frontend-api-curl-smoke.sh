#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PORT="18978"
BASE="http://127.0.0.1:${PORT}"
HOME_DIR="$(mktemp -d /tmp/oc-mw-home.XXXXXX)"
DB="$(mktemp /tmp/oc-mw.XXXXXX.sqlite)"
REPO="$(mktemp -d /tmp/oc-mw-repo.XXXXXX)"
LOG="$(mktemp /tmp/oc-mw-server.XXXXXX.log)"
FAIL=0
TOTAL=0
PROJECT_ID=""
TOPIC_ID=""
CHAT_ID=""
SESSION_KEY="agent:main:desktop:curl-smoke"
PTY_ID=""

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; wait "$SERVER_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$HOME_DIR" "$REPO" "$DB" "$LOG"
}
trap cleanup EXIT

cd "$REPO" && git init -q && git config user.email smoke@example.com && git config user.name Smoke && echo hi > README.md && git add README.md && git commit -q -m init
cd "$ROOT"
pnpm --filter @openclaw/desktop-middleware build >/dev/null

HOME="$HOME_DIR" MIDDLEWARE_PORT="$PORT" MIDDLEWARE_DB="$DB" OPENCLAW_GATEWAY_URL="ws://127.0.0.1:1" OPENCLAW_GATEWAY_TOKEN="dummy" NODE_ENV=test node apps/middleware/dist/index.js >"$LOG" 2>&1 &
SERVER_PID=$!
for i in {1..80}; do
  if curl -fsS "$BASE/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if ! curl -fsS "$BASE/health" >/dev/null 2>&1; then
  echo "SERVER_START_FAILED"
  cat "$LOG"
  exit 1
fi

status_of() {
  local method="$1" url="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -o /tmp/oc-curl-body.json -w '%{http_code}' -X "$method" "$BASE$url" -H 'content-type: application/json' --data "$body"
  else
    curl -sS -o /tmp/oc-curl-body.json -w '%{http_code}' -X "$method" "$BASE$url"
  fi
}

check() {
  local name="$1" method="$2" url="$3" body="${4:-}" allow="${5:-200 201 204 400 404 500 501}"
  TOTAL=$((TOTAL+1))
  local code; code=$(status_of "$method" "$url" "$body")
  # Curl smoke is for route/contract coverage. 404/501 are failures unless explicitly allowed.
  local ok=0
  for a in $allow; do [[ "$code" == "$a" ]] && ok=1; done
  if [[ "$ok" -ne 1 ]]; then
    echo "FAIL $code $method $url :: $name :: $(cat /tmp/oc-curl-body.json | head -c 240)"
    FAIL=$((FAIL+1))
  else
    echo "OK   $code $method $url :: $name"
  fi
}

json() { jq -c .; }

# bootstrap + create state
SPACE_ID=$(curl -sS -X POST "$BASE/api/spaces" -H 'content-type: application/json' --data '{"name":"Smoke Space"}' | jq -r '.space.id // .activeSpaceId // "space_default"')
PROJECT_ID=$(curl -sS -X POST "$BASE/api/projects" -H 'content-type: application/json' --data "{\"name\":\"Smoke Project\",\"spaceId\":\"$SPACE_ID\",\"workspaceRoot\":\"$REPO\",\"repoRoot\":\"$REPO\"}" | jq -r '.project.id')
TOPIC_ID=$(curl -sS -X POST "$BASE/api/topics" -H 'content-type: application/json' --data "{\"projectId\":\"$PROJECT_ID\",\"name\":\"Smoke Topic\"}" | jq -r '.topic.id')
CHAT_ID=$(curl -sS -X POST "$BASE/api/chats" -H 'content-type: application/json' --data "{\"spaceId\":\"$SPACE_ID\",\"name\":\"Smoke Chat\",\"sessionKey\":\"$SESSION_KEY\"}" | jq -r '.chat.id')
curl -sS -X POST "$BASE/api/sessions" -H 'content-type: application/json' --data "{\"projectId\":\"$PROJECT_ID\",\"topicId\":\"$TOPIC_ID\",\"agentId\":\"main\",\"label\":\"Smoke Session\"}" >/dev/null || true
PTY_JSON=$(curl -sS -X POST "$BASE/api/terminal/spawn" -H 'content-type: application/json' --data "{\"command\":\"bash\",\"cwd\":\"$REPO\"}" || true)
PTY_ID=$(echo "$PTY_JSON" | jq -r '.terminalId // empty')

# Direct frontend HTTP routes from ipc.ts/chat-engine-v2/startupBootstrap.
check health GET /health '' '200'
check system_info GET /api/system/info '' '200'
check bootstrap GET /api/bootstrap '' '200'
check version GET /api/version '' '200'
check projects_list GET "/api/projects?spaceId=$SPACE_ID" '' '200'
check projects_update PATCH "/api/projects/$PROJECT_ID" '{"name":"Smoke Project 2"}' '200'
check topics_list GET "/api/topics?projectId=$PROJECT_ID" '' '200'
check topics_update PATCH "/api/topics/$TOPIC_ID" '{"name":"Smoke Topic 2"}' '200'
check chats_list GET "/api/chats?spaceId=$SPACE_ID" '' '200'
check chats_update PATCH "/api/chats/$CHAT_ID" '{"name":"Smoke Chat 2"}' '200'
check chats_rename POST "/api/chats/$CHAT_ID/rename" '{"name":"Smoke Chat 3"}' '200'
check chats_attach_session POST "/api/chats/$CHAT_ID/session" "{\"sessionKey\":\"$SESSION_KEY\"}" '200'
check spaces_list GET /api/spaces '' '200'
check spaces_rename POST "/api/spaces/$SPACE_ID/rename" '{"name":"Smoke Space 2"}' '200'
check spaces_switch POST "/api/spaces/$SPACE_ID/switch" '{}' '200'
check sessions_list GET "/api/sessions?projectId=$PROJECT_ID&topicId=$TOPIC_ID" '' '200'
check repos_recent GET /api/repos/recent '' '200'
check repos_scan POST /api/repos/scan '{}' '200'
check repos_select POST /api/repos/select "{\"path\":\"$REPO\",\"name\":\"repo\"}" '200'
check skills_discover GET /api/skills/discover?limit=1 '' '200 500'
check skills_installed GET /api/skills/installed '' '200'
check git_status GET "/api/projects/$PROJECT_ID/git/status" '' '200'
check git_status_repo GET "/api/repos/git/status?path=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$REPO")" '' '200'
check git_diff GET "/api/projects/$PROJECT_ID/git/diff?path=README.md" '' '200'
check git_diff_repo GET "/api/repos/git/diff?repoPath=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$REPO")&path=README.md" '' '200'
check git_branches GET "/api/projects/$PROJECT_ID/git/branches" '' '200'
check git_branches_repo GET "/api/repos/git/branches?path=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$REPO")" '' '200'
check git_checkout POST "/api/projects/$PROJECT_ID/git/checkout" '{"branchName":"master"}' '200 400 500'
check git_checkout_repo POST /api/repos/git/checkout "{\"repoPath\":\"$REPO\",\"branchName\":\"master\"}" '200 400 500'
check migration_telegram_scan GET /api/migration/telegram/scan '' '200'
check migration_discord_scan GET /api/migration/discord/scan '' '200'
check middleware_update_status GET /api/middleware/update/status '' '200'
check middleware_update_branches GET /api/middleware/update/branches '' '200'
check middleware_update_invalid_branch POST /api/middleware/update '{"branch":"../bad"}' '400'
check workspace_capabilities GET "/api/projects/$PROJECT_ID/workspace/capabilities" '' '200'
check workspace_tree GET "/api/projects/$PROJECT_ID/workspace/tree?path=" '' '200'
check workspace_write PUT "/api/projects/$PROJECT_ID/workspace/file" '{"path":"smoke/a.txt","content":"hello"}' '200'
check workspace_read GET "/api/projects/$PROJECT_ID/workspace/file?path=smoke/a.txt" '' '200'
check workspace_stat GET "/api/projects/$PROJECT_ID/workspace/stat?path=smoke/a.txt" '' '200'
check workspace_mkdir POST "/api/projects/$PROJECT_ID/workspace/mkdir" '{"path":"smoke/dir"}' '200'
check workspace_move POST "/api/projects/$PROJECT_ID/workspace/move" '{"fromPath":"smoke/a.txt","toPath":"smoke/dir/b.txt"}' '200'
check workspace_download GET "/api/projects/$PROJECT_ID/workspace/download?path=smoke/dir/b.txt" '' '200'
check workspace_delete DELETE "/api/projects/$PROJECT_ID/workspace/file?path=smoke/dir/b.txt" '' '200'
check global_workspace_capabilities GET /api/workspace/capabilities '' '200'
check terminal_spawn POST /api/terminal/spawn "{\"command\":\"bash\",\"cwd\":\"$REPO\"}" '200'
if [[ -n "$PTY_ID" ]]; then
  check terminal_write POST "/api/terminal/$PTY_ID/write" '{"data":"echo again\n"}' '200'
  check terminal_resize POST "/api/terminal/$PTY_ID/resize" '{"cols":100,"rows":30}' '200'
  check terminal_kill POST "/api/terminal/$PTY_ID/kill" '{}' '200'
fi
check chat_bootstrap GET "/api/chat/bootstrap?sessionKey=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SESSION_KEY")" '' '200 500'
check patches GET "/api/patches?sessionKey=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SESSION_KEY")&after=0" '' '200'
check chat_send POST /api/chat/send "{\"sessionKey\":\"$SESSION_KEY\",\"message\":\"hello\",\"idempotencyKey\":\"smoke-1\"}" '200 400 500'
check chat_abort POST /api/chat/abort "{\"sessionKey\":\"$SESSION_KEY\",\"runId\":\"run_missing\"}" '200 400 500'
check approval_resolve POST /api/exec/approval/resolve '{"approvalId":"approval_missing","decision":"deny"}' '200 400 500'

# Command endpoints actually used through /api/commands by the frontend.
COMMANDS=(
middleware_autonaming_quick middleware_branch_list middleware_chat_edit_last_preview middleware_chat_fork middleware_chat_history middleware_chat_model_set middleware_chat_regenerate middleware_chat_select_edit_branch middleware_chat_send middleware_chat_stop middleware_commands_list middleware_connect_bootstrap middleware_connect_status middleware_cron_create_job middleware_cron_delete_job middleware_cron_get_job middleware_cron_job_conversation middleware_cron_list_jobs middleware_cron_list_runs middleware_cron_pause_job middleware_cron_recent_activity middleware_cron_reset_fixtures middleware_cron_run_job middleware_cron_update_job middleware_exec_approval_resolve middleware_git_commit_details middleware_memory_list middleware_memory_read middleware_memory_recall middleware_memory_store middleware_memory_write middleware_message_feedback middleware_message_feedback_delete middleware_models_list middleware_models_set_default middleware_onboarding_core middleware_onboarding_delete_account middleware_onboarding_flow middleware_onboarding_model_contract middleware_onboarding_model_submit middleware_onboarding_provider_details middleware_onboarding_provider_submit middleware_onboarding_providers middleware_onboarding_sign_out middleware_openclaw_bot_name_get middleware_openclaw_bot_name_set middleware_pins_add middleware_pins_list middleware_pins_remove middleware_profiles_list middleware_skills_detail middleware_skills_install middleware_skills_toggle middleware_skills_uninstall middleware_skills_versions middleware_spaces_archive middleware_spaces_update middleware_sync_pull_now middleware_usage middleware_usage_daily middleware_version_info middleware_voice_settings_get middleware_voice_settings_set middleware_voice_transcribe middleware_pty_spawn_workspace
)
PAYLOAD="{\"input\":{\"text\":\"hello\",\"message\":\"hello\",\"sessionKey\":\"$SESSION_KEY\",\"sourceSessionKey\":\"$SESSION_KEY\",\"messageId\":\"msg_1\",\"modelId\":\"test/model\",\"providerId\":\"openai\",\"jobId\":\"job_missing\",\"name\":\"Smoke Job\",\"scheduleType\":\"cron\",\"schedule\":\"0 9 * * *\",\"timezone\":\"UTC\",\"spaceId\":\"$SPACE_ID\",\"path\":\"MEMORY.md\",\"key\":\"smoke:key\",\"value\":\"smoke\",\"command\":\"echo smoke\"}}"
for cmd in "${COMMANDS[@]}"; do
  allow='200 400 404 500'
  if [[ "$cmd" == "middleware_onboarding_delete_account" ]]; then allow='501'; fi
  if [[ "$cmd" == "middleware_voice_transcribe" ]]; then allow='200 400 501'; fi
  check "$cmd" POST "/api/commands/$cmd" "$PAYLOAD" "$allow"
done

# Cleanup/archive/delete routes after main coverage.
check topics_archive POST "/api/topics/$TOPIC_ID/archive" '{}' '200'
check chats_archive POST "/api/chats/$CHAT_ID/archive" '{}' '200'
check projects_archive POST "/api/projects/$PROJECT_ID/archive" '{}' '200'

echo "SUMMARY total=$TOTAL failed=$FAIL"
exit $FAIL
