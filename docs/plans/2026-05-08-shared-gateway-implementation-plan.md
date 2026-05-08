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
