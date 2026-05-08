# Tab-switch API Audit — Shared Gateway Reliability

**Date:** 2026-05-08 06:55 UTC  
**Branch:** `ui/new-feat`  
**Scope:** Read-only audit of UI/middleware calls that repeat during tab/session switches.  

This audit is Task 0 from `2026-05-08-shared-gateway-execution-k6-plan.md`.

---

## Classification legend

- `local-read-cacheable`: local/config read; safe to cache briefly with invalidation.
- `gateway-read-dedupe-only`: live Gateway-backed read; dedupe in-flight, avoid stale TTL unless tiny/explicit.
- `gateway-read-cache-short-ttl`: Gateway/local mixed read; short TTL acceptable for tab-switch burst reduction.
- `write-never-cache`: mutation; never cache or blindly retry.
- `stream-shared`: should share middleware/Gateway event stream where possible.
- `polling-needs-throttle`: repeated polling; reduce frequency, dedupe, or rely on stream invalidation.

---

## Chat/editor tab switch or session change

### `middleware_chat_history`

- Source: `packages/ui/hooks/useChatMessages.ts`
- Path: `loadChatBootstrap(sessionKey)` → `fetchStableChatBootstrap()` → `fetchChatBootstrap()`.
- Trigger: `useChatMessages()` effect on `sessionKey`, `initialMessages`, `streamGeneration`.
- Current cache: `CHAT_BOOTSTRAP_TTL_MS = 5000` in UI hook.
- Classification: `gateway-read-dedupe-only` with existing very short UI TTL.
- Action:
  - Keep freshness on session switch.
  - Ensure concurrent same-session calls share one in-flight promise.
  - In middleware shared mode, use shared RPC and one safe retry on transient Gateway close.

### `middleware_branch_list`

- Source: `packages/ui/hooks/useChatMessages.ts`
- Path: same `fetchChatBootstrap()` Promise as history.
- Trigger: chat bootstrap on session change.
- Classification: `gateway-read-dedupe-only` or `local-read-cacheable` depending command implementation; treat as dedupe-only until confirmed.
- Action:
  - Share in-flight bootstrap request with history by session key.

### `/api/stream/chat/:sessionKey`

- Source: `packages/ui/lib/chatStream.ts`
- Path: `subscribeChatStream(sessionKey)` opens one browser `EventSource` per session key.
- Trigger: `useChatMessages()` after bootstrap; also `WorkspaceTab` opens its own EventSource.
- Current UI behavior: one EventSource per same session key in `chatStream.ts`; different session keys create separate streams.
- Middleware current behavior: each stream opens its own Gateway WebSocket.
- Classification: `stream-shared`.
- Action:
  - Browser EventSource sharing can remain.
  - Middleware must fan out all chat streams from one shared Gateway event socket when `MIDDLEWARE_SHARED_GATEWAY=true`.
  - `WorkspaceTab` direct stream should also benefit from middleware event hub.

### `middleware_pins_list`

- Source: `packages/ui/components/ChatView/index.tsx`
- Trigger: `useEffect` on `sessionKey`.
- Classification: `local-read-cacheable` per session.
- Action:
  - Dedupe same-session in-flight call.
  - Cache briefly per session.
  - Invalidate on pin/unpin mutation.

### `middleware_voice_settings_get`

- Source 1: `packages/ui/components/ChatBox/index.tsx`
- Source 2: `packages/ui/components/settings/tabs/VoiceTab.tsx`
- Trigger: ChatBox mount and VoiceTab mount; can repeat when tab/session remounts.
- Classification: `local-read-cacheable` app-level config.
- Action:
  - Dedupe/cache app-wide under key `voice-settings`.
  - Invalidate on `openclaw:voice-settings-changed` and `middleware_voice_settings_set` success.
  - Must not open Gateway sockets.

---

## Topic route activation

### `middleware_projects_list`

- Source: `packages/ui/components/AppPage.tsx`
- Trigger: activating topic route `/:projectId/:topicId`.
- Classification: `local-read-cacheable`.
- Action:
  - Cache/dedupe list briefly.
  - Invalidate on project create/update/archive/delete.

### `middleware_topics_list`

- Source: `packages/ui/components/AppPage.tsx`
- Trigger: topic route activation.
- Params: `projectId`.
- Classification: `local-read-cacheable` per project.
- Action:
  - Cache/dedupe per `projectId`.
  - Invalidate on topic create/update/archive/delete for that project.

### `middleware_sessions_list`

- Source: `packages/ui/components/AppPage.tsx`, `WorkspaceTab.tsx`, `TopicView`, `CommandPalette`, `sessionNavigation`.
- Trigger: topic route activation, workspace fallback, command palette/session navigation.
- Classification: `gateway-read-dedupe-only` unless implementation proves it is purely local.
- Action:
  - Dedupe in-flight by params.
  - Avoid long TTL because sessions are live state.
  - In middleware shared mode, use shared RPC if Gateway-backed.

---

## Chat route activation

### `middleware_chats_list`

- Source: `packages/ui/components/AppPage.tsx`
- Trigger: opening chat route and cron navigation.
- Classification: `local-read-cacheable`.
- Action:
  - Cache/dedupe briefly.
  - Invalidate on chat create/update/archive/delete.

### `middleware_sessions_create`

- Source: `ensureChatSession(...)` paths via AppPage/session navigation.
- Trigger: chat/topic needing a backing session.
- Classification: `write-never-cache`.
- Action:
  - Never cache.
  - Never blindly retry after unknown socket outcome.
  - Use idempotency only if existing command contract supports it.

---

## Inspector/workspace tab

### `middleware_sessions_list`

- Source: `packages/ui/components/inspector/WorkspaceTab.tsx`
- Trigger: no workspace session cached and gateway active.
- Classification: `gateway-read-dedupe-only`.
- Action: same as sessions list above.

### `/api/workspace/tree`

- Source: `packages/ui/components/inspector/WorkspaceTab.tsx` and `workspace-api.ts`.
- Trigger: effective session/project changes, expanded dirs, focus refresh, tool/status scheduled refresh.
- Classification: `gateway-read-dedupe-only` per `projectId/sessionKey/path`.
- Action:
  - Dedupe same path in-flight.
  - No long TTL; workspace tree changes after tools.
  - Invalidate prefix on tool/status refresh.

### `/api/workspace/file`

- Source: `WorkspaceTab.tsx` via `fetchRemoteWorkspaceFile()`.
- Trigger: selecting file.
- Classification: `gateway-read-dedupe-only` per file path; optional tiny TTL.
- Action:
  - Dedupe in-flight same file.
  - Invalidate on save/write.

### `PUT /api/workspace/file`

- Source: `WorkspaceTab.tsx` via `saveRemoteWorkspaceFile()`.
- Classification: `write-never-cache`.
- Action: never cache/retry blindly.

---

## Settings

### Usage tab: `middleware_usage`

- Source: `packages/ui/components/settings/tabs/usage/useUsageData.ts`
- Trigger: Usage tab mount, selected period change, interval every 60s.
- Classification: `gateway-read-cache-short-ttl` because provider status sub-call may touch Gateway.
- Action:
  - Dedupe/cache per period briefly.
  - Existing 60s polling is acceptable; avoid duplicate same-period calls during remount.

### Usage tab: `middleware_usage_daily`

- Source: `useUsageData.ts`
- Trigger: same as above.
- Classification: `local-read-cacheable` per period.
- Action: cache/dedupe per period.

### Voice tab: `middleware_voice_settings_get`

- Source: `VoiceTab.tsx`.
- Classification: `local-read-cacheable`; same as ChatBox.

### Voice tab: `middleware_voice_settings_set`

- Source: `VoiceTab.tsx`.
- Classification: `write-never-cache`.
- Action: invalidate `voice-settings` after success.

---

## Notifications

### Activity tab: `middleware_cron_list_jobs`

- Source: `packages/ui/components/notifications/tabs/ActivityTab.tsx`.
- Trigger: Activity tab mount; part of `hydrateActivity()`.
- Classification: `local-read-cacheable` with event invalidation.
- Action:
  - Cache/dedupe briefly.
  - Invalidate on cron job create/update/delete or cron stream completed/failed events.

### Activity tab: `middleware_cron_recent_activity`

- Source: `ActivityTab.tsx`.
- Trigger: Activity tab mount and `setInterval(..., 1000)`.
- Classification: `polling-needs-throttle`.
- Action:
  - Current 1s polling is aggressive.
  - Prefer event stream updates plus slower fallback polling.
  - At minimum dedupe in-flight and prevent overlapping `hydrateActivity()` calls.

### Activity/Cron tabs: `/api/stream/cron`

- Source: `ActivityTab.tsx`, `CronJobsTab.tsx`, notification popover paths.
- Classification: `stream-shared` if it ever becomes Gateway-backed; currently middleware route is local keepalive-only in `app.ts`.
- Action:
  - No Gateway socket concern today.
  - Avoid duplicate cron polling where possible.

### Cron Jobs tab: `middleware_cron_list_jobs`

- Source: `packages/ui/components/notifications/tabs/CronJobsTab.tsx`.
- Trigger: mount and completed/failed stream events.
- Classification: `local-read-cacheable` with event invalidation.
- Action:
  - Dedupe/cache briefly.
  - Refetch after completed/failed remains valid, but avoid duplicate overlapping fetches.

---

## Commands that must never be cached/blind retried

- `middleware_sessions_create`
- `middleware_chat_send`
- `middleware_chat_stop`
- `middleware_chat_regenerate`
- `middleware_chat_fork`
- `middleware_chat_model_set`
- `middleware_chat_exec_policy`
- `middleware_exec_approval_resolve`
- `middleware_models_set_default`
- `middleware_voice_settings_set`
- workspace/file writes
- cron create/update/delete/run actions

---

## Test implications

The tab-switch regression/load test must include:

1. Chat A open → history, branch list, pins, voice, stream.
2. Chat B open → same sequence.
3. Switch back Chat A within TTL → dedupe/cache should reduce duplicate reads.
4. Inspector open → sessions, workspace tree, stream.
5. Settings voice → voice settings shares app-level cache.
6. Settings usage → usage/daily dedupe per period.
7. Notifications activity → cron jobs/activity without overlapping 1s poll requests.

Pass gates:

- local config reads do not open Gateway sockets.
- same-key safe reads dedupe in-flight.
- write commands are not cached/retried.
- Gateway sockets stay bounded by shared Gateway plan.
