# Main Plan — Desktop Middleware Shared Gateway Reliability

**Date:** 2026-05-08 06:45 UTC  
**Branch:** `ui/new-feat`  
**Repo:** `Nextbasedev/openclaw-desktop`  
**Status:** Canonical combined plan before implementation  

---

## 1. Goal

Make OpenClaw Desktop middleware reliable under heavy tab switching, multiple chat tabs, repeated UI API calls, and long-lived chat streams — **without changing OpenClaw backend code**.

The fix must reduce two kinds of pressure:

1. **Gateway socket/handshake churn**
   - Current middleware opens many Gateway WebSockets under tab/API/stream load.
   - This caused failures like `gateway websocket closed waiting for connect.challenge`.

2. **UI tab-switch API bursts**
   - Switching between chats/settings/inspector/notifications triggers repeated reads like history, sessions, voice settings, usage, cron, workspace tree, and streams.

---

## 2. Hard constraints

- Change only `openclaw-desktop` / desktop middleware and UI code.
- Do **not** change `/root/.openclaw/workspace/openclaw` backend code.
- Do **not** push/merge to `main` until experiment is fully verified and explicitly approved.
- Keep work on `ui/new-feat` or a child experiment branch.
- New architecture must be feature-flagged:

```txt
MIDDLEWARE_SHARED_GATEWAY=true
```

- Flag off: preserve current behavior as much as possible.
- Flag on: use shared Gateway coordination.

---

## 3. Current code findings

### 3.1 Gateway transport opens per call

File: `apps/middleware/src/services/gateway.ts`

Current behavior:

- `connectGateway(scopes)` opens a new WebSocket for each call.
- It performs full challenge/connect handshake each time.
- `request()` waits for response on that socket.
- `close()` closes that socket.

Risk:

- Repeated commands and streams create many short-lived Gateway sockets.
- Concurrent handshakes can fail under load.

### 3.2 Chat streams open Gateway socket per UI stream

File: `apps/middleware/src/app.ts`

Route:

```txt
GET /api/stream/chat/:sessionKey
```

Current behavior:

- Each chat SSE route calls `connectGateway(...)`.
- Each route subscribes to session events separately.
- Closing the UI stream calls `gateway?.close()`.

Risk:

- Multiple tabs/chats/inspector streams create multiple Gateway event sockets.

### 3.3 Commands call Gateway repeatedly

File: `apps/middleware/src/services/commands.ts`

Examples:

- `middleware_chat_history`
- `middleware_usage` provider status
- `middleware_chat_send`
- `middleware_chat_stop`
- `middleware_chat_model_set`
- `middleware_chat_exec_policy`
- `middleware_exec_approval_resolve`

Risk:

- Many command handlers still assume a per-request socket and call `gw.close()`.
- Shared mode needs a safe no-op close/release wrapper.

### 3.4 Tab-switch repeated calls found in UI

#### Chat/editor tab switch or session change

Files:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/lib/chatStream.ts`

Repeated calls:

- `middleware_chat_history`
- `middleware_branch_list`
- `/api/stream/chat/:sessionKey`
- `middleware_pins_list`
- `middleware_voice_settings_get`

Current cache note:

- Chat bootstrap TTL is only `5s` via `CHAT_BOOTSTRAP_TTL_MS`.

#### Topic route activation

File: `packages/ui/components/AppPage.tsx`

Repeated calls:

- `middleware_projects_list`
- `middleware_topics_list`
- `middleware_sessions_list`

#### Chat route activation

File: `packages/ui/components/AppPage.tsx`

Repeated calls:

- `middleware_chats_list`
- possible `middleware_sessions_create` through session resolution.

#### Inspector/workspace tab

Files:

- `packages/ui/components/inspector/WorkspaceTab.tsx`
- `packages/ui/components/inspector/workspace-api.ts`

Repeated calls/streams:

- `middleware_sessions_list`
- `/api/workspace/tree`
- `/api/stream/chat/:sessionKey`
- repeated `/api/workspace/tree` on focus/tool/status refresh.

#### Settings usage tab

File: `packages/ui/components/settings/tabs/usage/useUsageData.ts`

Repeated calls:

- `middleware_usage`
- `middleware_usage_daily`
- repeats every `60s` while mounted.

#### Settings voice tab

File: `packages/ui/components/settings/tabs/VoiceTab.tsx`

Repeated calls:

- `middleware_voice_settings_get`

#### Notifications activity tab

File: `packages/ui/components/notifications/tabs/ActivityTab.tsx`

Repeated calls/streams:

- `middleware_cron_list_jobs`
- `middleware_cron_recent_activity`
- repeats every `1s` while mounted.
- `/api/stream/cron`

#### Notifications cron jobs tab

File: `packages/ui/components/notifications/tabs/CronJobsTab.tsx`

Repeated calls/streams:

- `middleware_cron_list_jobs`
- `/api/stream/cron`
- refetches jobs after completed/failed events.

---

## 4. Architecture decision

Use a middleware-owned Gateway coordinator, inspired by Telegram’s separation between session logic and disposable transports.

### 4.1 Normal shared mode socket model

With `MIDDLEWARE_SHARED_GATEWAY=true`, desktop middleware should normally use at most two Gateway sockets:

1. **Shared RPC Gateway socket**
   - Short request/response commands.
   - Concurrent requests multiplexed by request ID.
   - Safe reads may reconnect/retry once.
   - Writes are not blindly retried.

2. **Shared app-level event Gateway socket**
   - One long-lived Gateway event socket for the whole desktop app.
   - Middleware fans out Gateway events to UI SSE clients.
   - UI tabs do not each create their own Gateway event socket.

### 4.2 UI/middleware request dedupe

Shared Gateway fixes socket churn, but not all redundant HTTP/API bursts.

Add safe-read dedupe/cache for repeated tab-switch reads:

- same in-flight read key shares one promise.
- selected safe reads can use short TTL cache.
- rejected promises are not cached.
- writes/mutations are never cached.

---

## 5. Feature flag behavior

Add helper:

```ts
export function isSharedGatewayEnabled() {
  const value = String(process.env.MIDDLEWARE_SHARED_GATEWAY || "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}
```

When disabled:

- `connectGateway()` keeps legacy behavior.
- Chat stream route keeps legacy direct Gateway stream behavior.

When enabled:

- `connectGateway(..., { purpose: "rpc" })` uses shared RPC socket.
- `connectGateway(..., { purpose: "event" })` uses shared event socket.
- Shared handle `close()` is safe/no-op so legacy `finally { gw.close() }` blocks do not close the singleton.

---

## 6. Shared RPC rules

- Reuse only when socket is `OPEN` and authenticated handshake completed.
- Deduplicate concurrent connect attempts with one `connectingRpc` promise.
- Track pending requests by request ID.
- One socket `message` handler dispatches responses/events.
- Clean timers/listeners on success, timeout, close, or error.
- On close/error:
  - clear singleton.
  - reject pending requests exactly once.
  - allow future reconnect.

Safe read retry once after transient transport failure:

- `middleware_chat_history`
- `middleware_sessions_list` if Gateway-backed in active path
- `middleware_usage` provider status sub-call
- read-only status/config queries

Do not blindly retry:

- `chat.send`
- `chat.abort`
- `sessions.patch`
- approval resolution
- workspace/file writes
- any command with side effects unless proven idempotent.

If a write command socket closes after send and before response, surface clean unknown-outcome error.

---

## 7. Shared event stream rules

- One event Gateway socket for app-wide events.
- Subscribe once to session events.
- Middleware owns internal event fan-out.
- UI SSE clients register with a hub.
- Closing one UI SSE client must not close Gateway event socket.
- Slow/failing UI client must not block global event reader.
- Per-client state remains isolated: session key, subagent links, seen tool events.

---

## 8. Reconnect and recovery behavior

Middleware retries silently first.

Frontend thresholds:

- `0–10s`: completely silent.
- `10s–2min`: still silent to user; middleware logs/metrics only.
- `2min+ event stream down`: may show “Live updates delayed. Trying to reconnect…”
- `2min+ RPC down`: may show “Connection interrupted. Retrying…”
- `5min+ down`: may show retry/troubleshooting action.

On shared event stream reconnect, middleware refreshes:

1. sessions list
2. all currently open/visible chat histories
3. running status for those sessions

This compensates for missed events without backend protocol changes.

---

## 9. Safe-read dedupe/cache classification

Initial classification:

- `middleware_chat_history`: Gateway read, dedupe-only; optional very short TTL already exists.
- `middleware_branch_list`: dedupe-only.
- `middleware_pins_list`: local read, cacheable per session; invalidate on pin change.
- `middleware_voice_settings_get`: app-level config, cacheable; invalidate on `openclaw:voice-settings-changed`.
- `middleware_models_list`: local config, cacheable; invalidate on model set.
- `middleware_projects_list`: local read, cacheable; invalidate on project changes.
- `middleware_topics_list`: local read, cacheable per project; invalidate on topic changes.
- `middleware_chats_list`: local read, cacheable; invalidate on chat changes.
- `middleware_sessions_list`: live read, dedupe-only or very short TTL.
- `/api/stream/chat/:sessionKey`: shared stream through middleware event hub.
- `/api/stream/cron`: keep if local; consider shared/throttled if needed.
- `middleware_usage`: Gateway/local mixed read, short TTL.
- `middleware_usage_daily`: cacheable by period.
- `middleware_cron_list_jobs`: cacheable with event invalidation.
- `middleware_cron_recent_activity`: current 1s polling is aggressive; throttle or rely more on stream updates.
- `/api/workspace/tree`: dedupe-only per session/project/path; invalidate on tool/status/focus refresh.

---

## 10. Files likely to change

Middleware:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/commands.ts`
- `apps/middleware/src/app.ts`
- `apps/middleware/src/services/chat-stream-hub.ts` new
- `apps/middleware/src/services/gateway-recovery.ts` new
- `apps/middleware/scripts/load-test-tab-burst.cjs` new
- existing load scripts as needed

UI:

- `packages/ui/lib/requestDedupe.ts` new
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/components/settings/tabs/VoiceTab.tsx`
- `packages/ui/components/settings/tabs/usage/useUsageData.ts`
- `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- `packages/ui/components/notifications/tabs/CronJobsTab.tsx`
- `packages/ui/components/inspector/WorkspaceTab.tsx`

Tests:

- `apps/middleware/tests/gateway-shared-flag.test.ts`
- `apps/middleware/tests/gateway-shared-rpc.test.ts`
- `apps/middleware/tests/gateway-read-retry.test.ts`
- `apps/middleware/tests/chat-stream-hub.test.ts`
- `apps/middleware/tests/chat-stream-hub-events.test.ts`
- `apps/middleware/tests/gateway-recovery.test.ts`
- `packages/ui/lib/__tests__/requestDedupe.test.ts`
- `packages/ui/lib/__tests__/tabSwitchRequests.test.ts`

---

## 11. Stop conditions

Stop and ask before proceeding if:

- implementation appears to require OpenClaw backend changes.
- Gateway protocol lacks a required event/snapshot for safe recovery.
- shared event socket breaks existing chat/tool/subagent UI semantics.
- any write command appears to require retry for correctness.
- socket count still grows with UI clients after shared mode.
- two fix attempts fail for the same reliability symptom.
