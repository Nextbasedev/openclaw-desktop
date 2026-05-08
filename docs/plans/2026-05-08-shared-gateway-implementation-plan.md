# Shared Gateway Middleware Implementation Plan

**Goal:** Make desktop middleware reliable under heavy tab/API load without changing OpenClaw backend code.

**Architecture:** Add a feature-flagged middleware-owned Gateway coordinator. With `MIDDLEWARE_SHARED_GATEWAY=true`, desktop middleware uses one shared RPC Gateway socket and one shared app-level event Gateway socket, then fans events out to UI SSE clients. Short read requests retry once after transient transport failure; writes never retry blindly.

**Tech Stack:** Node.js, TypeScript, Express, `ws`, Vitest, existing middleware load scripts.

---

## Scope and hard constraints

- Repo: `Nextbasedev/openclaw-desktop`.
- Branch: `ui/new-feat` or a child experiment branch from it.
- Do not modify OpenClaw backend repo `/root/.openclaw/workspace/openclaw`.
- Do not merge/push to `main` until explicitly approved after full verification.
- Gate new behavior behind `MIDDLEWARE_SHARED_GATEWAY=true`.
- Preserve old behavior when flag is absent/false.
- Implement via TDD: write failing test, verify red, implement, verify green, commit.

---

## Current code map

### Gateway transport

File: `apps/middleware/src/services/gateway.ts`

Current behavior:

- `connectGateway(scopes)` reads config/token/identity.
- Opens a new `WebSocket` for each call.
- Performs challenge/connect handshake.
- Returns `{ request, on, close }` tied to that one socket.
- `request()` attaches per-request `waitFor()` listeners.
- No shared socket, no connection dedupe, no transport role.

### Command users

File: `apps/middleware/src/services/commands.ts`

Current behavior:

- Many commands call `connectGateway(...)` and then `gw.close()` in `finally`.
- Read examples:
  - `middleware_chat_history`
  - `middleware_usage` provider status
- Write examples:
  - `middleware_chat_send`
  - `middleware_chat_stop`
  - `middleware_chat_exec_policy`
  - `middleware_exec_approval_resolve`

### Chat SSE stream

File: `apps/middleware/src/app.ts`

Current behavior:

- `/api/stream/chat/:sessionKey` opens a Gateway socket per UI EventSource stream.
- Calls `sessions.subscribe` and `sessions.messages.subscribe` on that socket.
- Filters Gateway events and writes `chat.message`, `chat.tool`, `chat.status` SSE events.
- On UI request close, it calls `gateway?.close()`.

### Tests/scripts

Existing middleware scripts:

```bash
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter @openclaw/desktop-middleware load:test:streams
pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

Existing test files to extend or mirror:

- `apps/middleware/tests/commands-fork.test.ts`
- `apps/middleware/tests/commands-production.test.ts`
- `apps/middleware/tests/health.test.ts`

---

## Design details

### Feature flag

Add helper in `gateway.ts`:

```ts
export function isSharedGatewayEnabled() {
  const value = String(process.env.MIDDLEWARE_SHARED_GATEWAY || "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}
```

When disabled, `connectGateway()` keeps current per-call behavior.

When enabled, callers use shared clients depending on purpose:

```ts
export type GatewayPurpose = "rpc" | "event"

export async function connectGateway(
  scopes = DEFAULT_SCOPES,
  opts: { purpose?: GatewayPurpose; shared?: boolean } = {},
) { ... }
```

Default purpose is `rpc`.

### Public gateway handle contract

Keep compatibility with existing callers:

```ts
type MiddlewareGatewayHandle = {
  request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<GatewayResponse<T>>
  on(listener: (m: GatewayMessage) => void): () => void
  close(): void
  release?(): void
}
```

For shared handles:

- `close()` must **not** close the shared socket.
- `release()` is a no-op initially.
- Real shutdown is controlled by coordinator reset/test helpers.

This lets old `finally { gw.close() }` blocks stay safe during incremental migration.

### Shared RPC socket

Rules:

- One in-flight connection promise.
- One open RPC socket after handshake.
- Reuse only if socket is `OPEN` and handshake completed.
- Multiplex concurrent requests by request ID.
- Clean pending listeners/timers on success, timeout, close, and error.
- If socket closes, reject/settle pending requests exactly once and clear singleton.
- Safe read commands may reconnect and retry once.
- Write commands surface clean error if outcome is unknown.

### Shared event socket

Rules:

- One in-flight connection promise.
- One open event socket after handshake.
- Subscribe once to Gateway session events.
- Middleware owns event fan-out to UI SSE clients.
- UI tabs must not each open a Gateway event socket when flag is enabled.
- Event reader must never block on a slow UI SSE client.
- On event reconnect, trigger recovery refresh:
  - sessions list
  - all visible/open chat histories
  - running status for those sessions

### SSE fan-out registry

Add a middleware-local registry for active chat stream clients.

Suggested new file:

`apps/middleware/src/services/chat-stream-hub.ts`

Responsibilities:

- Track active SSE clients by requested session key and effective active session key.
- Track visible/open sessions.
- Send `chat.ready`, `chat.message`, `chat.tool`, `chat.status` to matching clients.
- Subscribe/unsubscribe UI clients without closing Gateway sockets.
- Maintain subagent matching/linking state per UI stream where needed.
- Drop/close only the slow UI client if writes fail; never block global event dispatch.

### Recovery state

Suggested new file:

`apps/middleware/src/services/gateway-recovery.ts`

Responsibilities:

- Track event/RPC connection state timestamps.
- Silent reconnect windows:
  - `0–10s`: no UI status.
  - `10s–2min`: internal logs only.
  - `2min+`: emit delayed/interrupted status to active UI clients.
  - `5min+`: emit retry/troubleshooting status.
- On event reconnect, ask hub for open session keys and refresh:
  - sessions list
  - chat history for open sessions
  - running status if available through existing commands/events.

If running status is not cleanly available yet, implement the refresh hook as a typed TODO with test coverage for invocation, not guessed UI behavior.

---

## Task 1 — Add shared-gateway flag and legacy-safe handle contract

### Files

Modify:

- `apps/middleware/src/services/gateway.ts`

Create tests:

- `apps/middleware/tests/gateway-shared-flag.test.ts`

### RED test

Test names:

- `isSharedGatewayEnabled returns true for true-like values`
- `isSharedGatewayEnabled returns false by default`
- `shared handle close does not close underlying socket`

Test approach:

- Import `isSharedGatewayEnabled`.
- Stub env values with Vitest.
- For handle close, use a fake shared handle factory or exported test helper after adding minimal structure.

Run expected failing command:

```bash
pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-flag.test.ts
```

Expected RED:

- Import/export missing for `isSharedGatewayEnabled`, or behavior not implemented.

### GREEN implementation

In `gateway.ts`:

- Add `DEFAULT_SCOPES`.
- Add `GatewayPurpose` type.
- Add `isSharedGatewayEnabled()`.
- Add internal distinction between legacy and shared mode, but do not switch callers yet.
- Make shared wrapper `close()` a no-op for future shared clients.

### Verify

```bash
pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-flag.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/gateway.ts apps/middleware/tests/gateway-shared-flag.test.ts
git commit -m "test: cover shared gateway feature flag"
```

---

## Task 2 — Build shared RPC Gateway coordinator

### Files

Modify:

- `apps/middleware/src/services/gateway.ts`

Create tests:

- `apps/middleware/tests/gateway-shared-rpc.test.ts`

### RED tests

Test names:

- `dedupes concurrent shared rpc connects into one websocket handshake`
- `multiplexes concurrent rpc requests by response id`
- `clears shared rpc singleton after socket close`
- `rejects pending rpc requests exactly once on socket close`
- `does not reuse a half-open websocket before connect response`

Test approach:

- Mock `ws` with a controllable fake WebSocket.
- Simulate Gateway frames:
  - open
  - `connect.challenge`
  - connect `res ok`
  - RPC response frames.
- Start 5 concurrent `connectGateway(DEFAULT_SCOPES, { purpose: "rpc" })` calls under `MIDDLEWARE_SHARED_GATEWAY=true`.
- Assert only one fake socket was created.

Run expected failing command:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-rpc.test.ts
```

### GREEN implementation

In `gateway.ts`:

- Add shared state:

```ts
let sharedRpc: SharedGatewayClient | null = null
let connectingRpc: Promise<SharedGatewayClient> | null = null
```

- Add `SharedGatewayClient` class or module-local object that owns:
  - `ws`
  - `ready`
  - `pendingRequests: Map<string, PendingRequest>`
  - `eventListeners: Set<(m: GatewayMessage) => void>`
  - `request()`
  - `on()`
  - `reset()`

- Route all incoming frames through one `message` listener:
  - response frames resolve matching pending request by ID.
  - event frames go to listeners.
  - malformed frames ignored.

- On `close`/`error`:
  - clear singleton if it matches.
  - reject all pending exactly once.
  - remove timers.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-rpc.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/gateway.ts apps/middleware/tests/gateway-shared-rpc.test.ts
git commit -m "feat: add shared rpc gateway coordinator"
```

---

## Task 3 — Add transient error classifier and safe read retry helper

### Files

Modify:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/commands.ts`

Create tests:

- `apps/middleware/tests/gateway-read-retry.test.ts`

### RED tests

Test names:

- `retries middleware_chat_history once after transient gateway close`
- `does not retry chat.send after transient gateway close`
- `does not retry application errors from gateway response`
- `retry resets shared rpc connection before second attempt`

### GREEN implementation

In `gateway.ts`, export:

```ts
export function isGatewayTransientError(error: unknown): boolean { ... }
export function resetSharedGatewayForTestsOrRecovery(purpose?: GatewayPurpose): void { ... }
export async function withGatewayReadRetry<T>(fn: () => Promise<T>): Promise<T> { ... }
```

Transient strings/codes:

- `gateway websocket closed before open`
- `gateway websocket closed waiting for`
- `timeout waiting for connect.challenge`
- `gateway websocket open timeout`
- `WebSocket is not open`
- socket close/error during response wait

Do not classify:

- `INVALID_REQUEST`
- `BAD_REQUEST`
- auth/token/scope denial
- command-specific application errors

In `commands.ts`, wrap only safe reads first:

- `middleware_chat_history` Gateway fallback path.
- `middleware_usage` provider status read if easy.

Do not wrap writes.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-read-retry.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/gateway.ts apps/middleware/src/services/commands.ts apps/middleware/tests/gateway-read-retry.test.ts
git commit -m "fix: retry safe gateway reads after transient reconnect"
```

---

## Task 4 — Add shared event socket and chat stream hub skeleton

### Files

Modify:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/app.ts`

Create:

- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/tests/chat-stream-hub.test.ts`

### RED tests

Test names:

- `uses one shared event gateway for multiple chat stream clients`
- `fanout sends matching session messages to subscribed clients`
- `does not send unrelated session events to a client`
- `closing one UI SSE client does not close shared event gateway`
- `write failure removes only the failing UI client`

### GREEN implementation

In `gateway.ts`:

- Add separate shared event state:

```ts
let sharedEvent: SharedGatewayClient | null = null
let connectingEvent: Promise<SharedGatewayClient> | null = null
```

- `connectGateway(scopes, { purpose: "event" })` uses event singleton.

In `chat-stream-hub.ts`:

- Define `ChatStreamClient` with:
  - requestedSessionKey
  - activeSessionKey
  - `send(event, data)`
  - `close()` cleanup
  - per-client matching/subagent state

- Implement:

```ts
export function registerChatStreamClient(...): () => void
export function handleGatewayEvent(message: GatewayMessage): void
export function getOpenChatSessionKeys(): string[]
```

In `app.ts`:

- When flag disabled: keep legacy route.
- When flag enabled:
  - route registers UI client in hub.
  - ensure shared event socket is started once.
  - do not close Gateway socket on UI request close.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/chat-stream-hub.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/gateway.ts apps/middleware/src/services/chat-stream-hub.ts apps/middleware/src/app.ts apps/middleware/tests/chat-stream-hub.test.ts
git commit -m "feat: fan out chat streams from shared event gateway"
```

---

## Task 5 — Port existing chat stream event behavior into hub

### Files

Modify:

- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/src/app.ts`

Create/extend:

- `apps/middleware/tests/chat-stream-hub-events.test.ts`

### RED tests

Test current route behavior before moving logic:

- `emits chat.message for assistant session.message`
- `emits chat.status done for final assistant message`
- `emits chat.tool for session.tool events`
- `links subagent sessions to sessions_spawn tool call events`
- `ignores user messages for visible assistant output`
- `ignores unrelated subagent events except link bookkeeping`

### GREEN implementation

- Move pure event mapping helpers from `app.ts` into `chat-stream-hub.ts` or supporting helpers.
- Preserve current event names/payload shapes expected by UI.
- Keep per-client subagent state isolated.
- Keep existing legacy path available when feature flag is off.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/chat-stream-hub-events.test.ts
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/chat-stream-hub.ts apps/middleware/src/app.ts apps/middleware/tests/chat-stream-hub-events.test.ts
git commit -m "refactor: preserve chat stream mapping in shared hub"
```

---

## Task 6 — Add silent reconnect state and recovery refresh hooks

### Files

Create:

- `apps/middleware/src/services/gateway-recovery.ts`
- `apps/middleware/tests/gateway-recovery.test.ts`

Modify:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/src/services/commands.ts` if shared read helpers are reused

### RED tests

Test names:

- `does not emit UI reconnect status before two minutes`
- `emits live updates delayed after event stream is down for two minutes`
- `emits retry/troubleshooting status after five minutes`
- `on event reconnect refreshes sessions list and open chat histories`
- `recovery refresh uses read retry helper and does not retry writes`

### GREEN implementation

- Add connection state timestamps for RPC and event sockets.
- Gateway shared client calls recovery hooks on disconnect/reconnect.
- Hub exposes open/visible session keys.
- Recovery refresh calls existing Gateway read requests:
  - sessions list/status equivalent if available.
  - chat history for open keys.
  - running status if available; otherwise emit neutral refresh status and document TODO.
- UI-visible reconnect status only after configured thresholds.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-recovery.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

### Commit

```bash
git add apps/middleware/src/services/gateway-recovery.ts apps/middleware/src/services/gateway.ts apps/middleware/src/services/chat-stream-hub.ts apps/middleware/tests/gateway-recovery.test.ts
git commit -m "feat: recover shared gateway streams silently"
```

---

## Task 7 — Strengthen load scripts and socket-count assertions

### Files

Modify:

- `apps/middleware/scripts/load-test-tabs.cjs`
- `apps/middleware/scripts/load-test-streams.cjs`

Possibly create:

- `apps/middleware/scripts/load-test-shared-gateway.cjs`

### RED checks

Before implementation, current load scripts should not assert shared socket count.

Add test/script behavior that fails if:

- read request failures > 0 in normal load.
- persistent Gateway socket count grows with VUs/tabs.
- `middleware_chat_history` failures are ignored.

### GREEN implementation

Add env controls:

```txt
MIDDLEWARE_SHARED_GATEWAY=true
GATEWAY_SOCKET_MAX=2
GATEWAY_HISTORY_REQUIRED=true
```

Add process/socket cleanup checks where feasible.

If exact OS socket count is not portable in script, add middleware debug endpoint under test-only env or log marker from shared coordinator:

- active RPC socket count
- active event socket count
- pending request count
- active UI SSE clients

Do not expose this in production unless behind test/debug flag.

### Verify

```bash
MIDDLEWARE_SHARED_GATEWAY=true STREAMS=5 DURATION_MS=90000 pnpm --filter @openclaw/desktop-middleware load:test:streams
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s SPACE_COUNT=3 GATEWAY_HISTORY_REQUIRED=true pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

### Commit

```bash
git add apps/middleware/scripts/load-test-tabs.cjs apps/middleware/scripts/load-test-streams.cjs apps/middleware/scripts/load-test-shared-gateway.cjs
git commit -m "test: assert shared gateway reliability under load"
```

---

## Task 8 — Full verification pass

Run from repo root:

```bash
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware build
pnpm --filter ui exec vitest run \
  lib/__tests__/chatStream.test.ts \
  lib/__tests__/chatSessionStore.test.ts \
  lib/__tests__/chatSessionLoad.test.ts
pnpm --filter ui typecheck
```

Then run load gates sequentially:

```bash
MIDDLEWARE_SHARED_GATEWAY=true STREAMS=5 DURATION_MS=90000 pnpm --filter @openclaw/desktop-middleware load:test:streams
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s SPACE_COUNT=3 GATEWAY_HISTORY_REQUIRED=true pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

If 5 VU load passes, run higher confidence:

```bash
MIDDLEWARE_SHARED_GATEWAY=true VUS=25 DURATION=120s SPACE_COUNT=5 GATEWAY_HISTORY_REQUIRED=true pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

Manual/process checks after load:

```bash
ps -eo pid,cmd | grep -E 'load-test|k6|desktop-middleware' | grep -v grep || true
ss -tan state established '( sport = :18789 )' | wc -l
```

Pass criteria:

- 0 failed read requests in normal 5 VU load.
- No event stream failures for 5 streams / 90s.
- Middleware Gateway sockets remain at expected count during shared mode.
- No memory/listener/process leak observed.
- Legacy mode smoke still passes with flag off.

### Commit verification notes

After successful verification, update the plan with a `Verification Results` section and commit:

```bash
git add docs/plans/2026-05-08-shared-gateway-implementation-plan.md
git commit -m "docs: record shared gateway verification results"
```

---

## Stop conditions

Stop and ask before continuing if any of these happen:

- Implementing requires OpenClaw backend changes.
- Gateway protocol lacks an event/snapshot needed for recovery.
- Shared event socket breaks existing chat/tool/subagent UI semantics.
- Any write command appears to need retry for correctness.
- Load tests show socket count still grows with UI clients.
- Two fix attempts fail for the same reliability symptom.

---

## Review workflow per Superpowers

For each task:

1. Implementer subagent receives the exact task text.
2. Implementer writes failing tests first and verifies RED.
3. Implementer writes minimal code and verifies GREEN.
4. Implementer commits.
5. Spec reviewer subagent reads actual code and checks against this plan.
6. Quality reviewer subagent reviews diff for architecture, edge cases, security, and test quality.
7. Fix review issues before moving to the next task.

No task is complete without fresh command output proving tests/typecheck passed.

---

## Addendum — Multi-tab API burst coverage

Added after review question: switching/opening multiple UI tabs can re-trigger many API calls at once — chat history, sessions, models, voice settings, usage, cron, projects/topics/chats, and stream subscriptions. The reliability plan must verify this explicitly, not only generic Gateway load.

### What must be covered

When 5–25 UI tabs or chat views are opened/switched quickly, the middleware should handle repeated calls to:

- Gateway-backed or potentially Gateway-backed reads:
  - `middleware_chat_history`
  - `middleware_sessions_list` if routed through Gateway/client index in the active flow
  - `middleware_usage` provider status sub-call
  - any session/status/running-state reads used by recovery
- Local/config reads that still create HTTP/API load:
  - `middleware_models_list`
  - `middleware_voice_settings_get`
  - `middleware_usage_daily`
  - `middleware_projects_list`
  - `middleware_topics_list`
  - `middleware_chats_list`
  - `middleware_cron_list_jobs`
  - `middleware_pins_list`
  - workspace/tree reads if visible tabs trigger them
- Stream endpoints:
  - `/api/stream/chat/:sessionKey`
  - `/api/stream/cron`

### Required behavior

- Local/config reads must stay fast and must not open Gateway sockets.
- Gateway-backed reads must use the shared RPC socket when `MIDDLEWARE_SHARED_GATEWAY=true`.
- Multiple chat EventSource clients must use middleware fan-out and must not create one Gateway socket per UI tab.
- Repeated identical startup reads should not cause unbounded concurrency or listener growth.
- Read failures under normal 5-tab load must be `0`.
- Socket count must stay bounded: normally 1 RPC + 1 event Gateway socket.

### New audit task before implementation

Before coding Task 2, add a short read-only audit of UI-triggered middleware commands:

1. Grep UI code for `invoke("middleware_` and `streamUrl(`.
2. Classify each command as:
   - local/config only
   - Gateway read
   - Gateway write/mutation
   - SSE stream
3. Add the classification to this plan or a small `docs/plans/2026-05-08-tab-api-burst-audit.md` file.
4. Use the classification to decide which commands get read retry and which must never retry.

### New test/load requirement

Add or extend a load script to simulate tab-switch startup bursts, not just one endpoint loop.

Suggested script:

```txt
apps/middleware/scripts/load-test-tab-burst.cjs
```

It should repeatedly call a realistic mix:

```txt
middleware_projects_list
middleware_topics_list
middleware_chats_list
middleware_sessions_list
middleware_chat_history
middleware_models_list
middleware_voice_settings_get
middleware_usage
middleware_cron_list_jobs
/api/stream/chat/:sessionKey open/close
```

Expected command:

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=5 \
DURATION=60s \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Then scale:

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=25 \
DURATION=120s \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

### Additional pass/fail gates

- `middleware_models_list` and `middleware_voice_settings_get` must not open Gateway sockets.
- `middleware_chat_history` failures must fail the test, not be ignored.
- Opening/closing many `/api/stream/chat/:sessionKey` clients must not grow Gateway sockets beyond the shared event socket.
- If a slow UI SSE client is simulated, only that client should be dropped; other clients and the shared event reader must continue.
- After the burst test, active UI SSE client count and pending RPC count must return to zero.

This addendum makes the tab-switch/API-burst scenario a first-class verification target, not an implied side effect of the generic load tests.

---

## Addendum — Exact tab-switch repeated call map and mitigation

Added after code inspection of current UI tab/session switch paths.

### Exact repeated calls found in current code

#### Chat/editor tab switch or session change

Source files:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/lib/chatStream.ts`

Repeated calls/streams:

- `middleware_chat_history`
  - called by `loadChatBootstrap(sessionKey)`.
  - cache TTL is currently only `5s` via `CHAT_BOOTSTRAP_TTL_MS`.
- `middleware_branch_list`
  - called in the same bootstrap Promise.
- `/api/stream/chat/:sessionKey`
  - opened by `subscribeChatStream(sessionKey)`.
  - UI already shares one EventSource per same session key, but each different session key opens a separate middleware SSE stream.
- `middleware_pins_list`
  - called by `ChatView` whenever `sessionKey` changes.
- `middleware_voice_settings_get`
  - called by `ChatBox` on mount to check voice readiness.
  - If `ChatBox` remounts on tab/session switches, this repeats even though it is app-level config.

#### Topic route activation

Source file:

- `packages/ui/components/AppPage.tsx`

Repeated calls:

- `middleware_projects_list`
- `middleware_topics_list`
- `middleware_sessions_list`

These run when activating a topic route like `/:projectId/:topicId`.

#### Chat route activation

Source file:

- `packages/ui/components/AppPage.tsx`

Repeated calls:

- `middleware_chats_list`
- possible `middleware_sessions_create` through `ensureChatSession(...)` depending on cache/session state.

Important current behavior:

- `handleEditorTabSelect()` uses `resolvedChatCacheRef` if a chat is already resolved.
- If not cached, it calls `handleChatSelect()`, which can trigger session resolution and chat bootstrap.

#### Inspector/workspace tab

Source files:

- `packages/ui/components/inspector/WorkspaceTab.tsx`
- `packages/ui/components/inspector/workspace-api.ts`

Repeated calls/streams:

- `middleware_sessions_list`
  - when no workspace session is cached.
- `/api/workspace/tree`
  - on effective session/project change.
- `/api/stream/chat/:sessionKey`
  - WorkspaceTab opens its own EventSource to refresh workspace on tool/status events.
- `/api/workspace/tree`
  - repeats on window focus and scheduled refresh after tool/status events.

#### Settings usage tab

Source file:

- `packages/ui/components/settings/tabs/usage/useUsageData.ts`

Repeated calls:

- `middleware_usage`
- `middleware_usage_daily`

Also repeats every `60s` while mounted.

#### Settings voice tab

Source file:

- `packages/ui/components/settings/tabs/VoiceTab.tsx`

Repeated calls:

- `middleware_voice_settings_get` on mount.

#### Notifications activity tab

Source file:

- `packages/ui/components/notifications/tabs/ActivityTab.tsx`

Repeated calls/streams:

- `middleware_cron_list_jobs`
- `middleware_cron_recent_activity`
- refresh loop every `1s` while mounted.
- `/api/stream/cron`

#### Notifications cron jobs tab

Source file:

- `packages/ui/components/notifications/tabs/CronJobsTab.tsx`

Repeated calls/streams:

- `middleware_cron_list_jobs`
- `/api/stream/cron`
- refetches jobs after completed/failed cron events.

### Mitigation scope

The shared Gateway architecture fixes Gateway socket churn, but tab switching can still cause unnecessary HTTP/API bursts. Add a UI/middleware request dedupe layer for safe reads.

Goals:

- Avoid duplicate in-flight requests for the same safe read key.
- Add short TTL caching for app-level config reads.
- Do not cache or dedupe writes/mutations unless explicitly safe.
- Preserve freshness where it matters: chat history should refresh on session switch, but duplicate simultaneous history calls for the same session should share one in-flight promise.

### New Task 0 — Audit/classify tab-switch commands before coding shared Gateway

This task must run before Task 1 of implementation.

#### Files

Create:

- `docs/plans/2026-05-08-tab-switch-api-audit.md`

#### Work

Document every repeated call above and classify each as:

- `local-read-cacheable`
- `gateway-read-dedupe-only`
- `gateway-read-cache-short-ttl`
- `write-never-cache`
- `stream-shared`
- `polling-needs-throttle`

Initial classification:

- `middleware_chat_history`: `gateway-read-dedupe-only`, optional very short TTL already exists in UI.
- `middleware_branch_list`: `local/gateway-read-dedupe-only` depending implementation.
- `middleware_pins_list`: `local-read-cacheable` per session with invalidation on pin change.
- `middleware_voice_settings_get`: `local-read-cacheable`, app-level TTL/invalidation on `openclaw:voice-settings-changed`.
- `middleware_models_list`: `local-read-cacheable`, app-level TTL/invalidation on model set.
- `middleware_projects_list`: `local-read-cacheable` with invalidation on project create/update/delete.
- `middleware_topics_list`: `local-read-cacheable` per project with invalidation on topic create/update/delete.
- `middleware_chats_list`: `local-read-cacheable` with invalidation on chat create/update/archive.
- `middleware_sessions_list`: `gateway/local-read-dedupe-only` because it may represent live session state.
- `/api/stream/chat/:sessionKey`: `stream-shared` through middleware event hub.
- `/api/stream/cron`: `stream-shared` or leave as-is if it does not touch Gateway.
- `middleware_usage`: `gateway-read-cache-short-ttl` because provider status is not critical every tab switch.
- `middleware_usage_daily`: `local-read-cacheable` for current selected period.
- `middleware_cron_list_jobs`: `local-read-cacheable` with event invalidation.
- `middleware_cron_recent_activity`: `polling-needs-throttle`; current 1s polling is aggressive and should be reduced or event-driven.
- `/api/workspace/tree`: `gateway/local-read-dedupe-only` per session/project/path; refresh on tool/status/focus remains allowed.

#### Verify

No code verification needed. Commit audit doc before implementation.

---

## New Task 1A — Add UI/middleware safe-read dedupe for tab-switch bursts

This task can run after the audit and before/alongside shared Gateway RPC.

### Files

Create:

- `packages/ui/lib/requestDedupe.ts`
- `packages/ui/lib/__tests__/requestDedupe.test.ts`

Modify likely callers:

- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/components/settings/tabs/VoiceTab.tsx`
- `packages/ui/components/settings/tabs/usage/useUsageData.ts`
- `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- `packages/ui/components/notifications/tabs/CronJobsTab.tsx`
- `packages/ui/components/inspector/WorkspaceTab.tsx`

### RED tests

Test names:

- `dedupes concurrent requests with the same key`
- `does not dedupe different keys`
- `returns cached value within ttl for cacheable reads`
- `drops cache entry after ttl`
- `does not cache rejected promise`
- `supports explicit invalidation by prefix`

### GREEN implementation

Implement generic helper:

```ts
type DedupeOptions = {
  ttlMs?: number
  cacheRejected?: false
}

export function dedupeRequest<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: DedupeOptions,
): Promise<T>

export function invalidateDedupe(keyOrPrefix: string): void
export function clearDedupeForTests(): void
```

Rules:

- Same key while in-flight returns same promise.
- If `ttlMs` is set, resolved value is reused until expiry.
- Rejections are not cached.
- Invalidation supports exact key or prefix.

### Apply to repeated callers

Use dedupe/cache keys such as:

- `chat-bootstrap:${sessionKey}` around existing `loadChatBootstrap()` or replace/extend current `chatBootstrapCache`.
- `pins:${sessionKey}` around `middleware_pins_list`.
- `voice-settings` around `middleware_voice_settings_get` in both ChatBox and VoiceTab.
- `usage:${period}` around `middleware_usage`/`middleware_usage_daily` while Usage tab is mounted.
- `cron-jobs` around `middleware_cron_list_jobs`.
- `cron-activity` throttle/dedupe around `middleware_cron_recent_activity`.
- `workspace-tree:${projectId}:${sessionKey}:${path}` around workspace tree loads.

Invalidation hooks:

- Voice save dispatches `openclaw:voice-settings-changed` and invalidates `voice-settings`.
- Model set invalidates `models-list` if model list is cached.
- Chat/session create/archive invalidates `chats`, `sessions`, and affected chat-bootstrap keys.
- Cron event completed/failed invalidates `cron-jobs` / `cron-activity`.
- Workspace tool/status events invalidate affected `workspace-tree` prefix.

### Verify

```bash
pnpm --filter ui exec vitest run lib/__tests__/requestDedupe.test.ts
pnpm --filter ui exec vitest run lib/__tests__/chatSessionLoad.test.ts lib/__tests__/chatStream.test.ts
pnpm --filter ui typecheck
```

### Commit

```bash
git add packages/ui/lib/requestDedupe.ts packages/ui/lib/__tests__/requestDedupe.test.ts packages/ui/hooks/useChatMessages.ts packages/ui/components/ChatView/index.tsx packages/ui/components/ChatBox/index.tsx packages/ui/components/settings/tabs/VoiceTab.tsx packages/ui/components/settings/tabs/usage/useUsageData.ts packages/ui/components/notifications/tabs/ActivityTab.tsx packages/ui/components/notifications/tabs/CronJobsTab.tsx packages/ui/components/inspector/WorkspaceTab.tsx
git commit -m "feat: dedupe safe reads during tab switches"
```

---

## New Task 1B — Add tab-switch burst regression tests

### Files

Create/extend:

- `packages/ui/lib/__tests__/tabSwitchRequests.test.ts`
- `apps/middleware/scripts/load-test-tab-burst.cjs`

### RED tests

Test names:

- `switching between two cached chat tabs does not refetch chat session resolution`
- `mounting two ChatBoxes shares one voice settings request`
- `switching to usage tab dedupes usage requests for the same period`
- `workspace focus refresh dedupes same path tree request`

### Load script scenario

Simulate realistic calls generated by tab switching:

1. Open chat A: history, branch list, pins, voice settings, chat stream.
2. Switch chat B: history, branch list, pins, voice settings, chat stream.
3. Switch back chat A within TTL: should reuse/dedupe safe reads where allowed.
4. Open inspector: sessions list, workspace tree, chat stream.
5. Open settings voice: voice settings.
6. Open settings usage: usage + usage daily.
7. Open notifications activity: cron jobs + recent activity + cron stream.

Pass gates:

- duplicate in-flight safe reads collapse to one call per key.
- chat history has no failed requests.
- voice/model/local config reads do not open Gateway sockets.
- Gateway socket count remains bounded when combined with shared Gateway tasks.

### Verify

```bash
pnpm --filter ui exec vitest run lib/__tests__/tabSwitchRequests.test.ts
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

### Commit

```bash
git add packages/ui/lib/__tests__/tabSwitchRequests.test.ts apps/middleware/scripts/load-test-tab-burst.cjs apps/middleware/package.json
git commit -m "test: cover tab switch request bursts"
```
