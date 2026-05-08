# Gateway Reliability Plan — Heavy Tab/API Load

**Branch:** `ui/new-feat`

## Problem

Under stronger load, long-lived SSE streams were stable, but concurrent API calls that touch gateway-backed commands had intermittent failures.

Observed heavy test:

```txt
5 SSE streams for 90s: PASS
5 VUs API/tab load for 60s: 5 failures / 1032 requests = 0.48%
Failed endpoint: POST /api/commands/middleware_chat_history
Error: gateway websocket closed waiting for connect.challenge
RAM stayed safe: MemAvailable stayed ~5.7GB, far above 1GB
```

This is a backend/middleware reliability issue, not a React tab-state issue.

## Root Cause Hypothesis

Current middleware gateway client (`apps/middleware/src/services/gateway.ts`) opens a new WebSocket and performs a full gateway auth handshake for each `connectGateway()` call.

During concurrent tab/API load:

- `middleware_chat_history` calls can open many short-lived gateway connections.
- Chat streams also call `connectGateway()` and keep gateway connections open.
- Handshake race/connection churn causes some sockets to close before receiving `connect.challenge`.
- The failure then bubbles as a 500 to UI/API.

The server package has a better pattern in `packages/server/src/gateway/client.ts`: singleton client + connecting promise + reconnect/backoff. The middleware should follow the same idea.

---

## Fix Strategy

Move middleware gateway access from “new socket per request” to “shared resilient gateway client.”

### 1. Add singleton gateway connection manager

File: `apps/middleware/src/services/gateway.ts`

Implement:

- `sharedGateway: GatewayClient | null`
- `connectingGateway: Promise<GatewayClient> | null`
- `connectGateway(scopes)` returns existing open client when possible.
- Concurrent callers await the same `connectingGateway` promise.
- If socket closes/errors, clear singleton.
- Retry handshake with exponential backoff + jitter.

Important: scopes are currently passed per call. Use a superset scope connection by default:

```txt
operator.read
operator.write
operator.admin
operator.approvals
```

This avoids creating separate sockets per scope set. If we need strict scope minimization later, key the singleton by normalized scope set, but reliability comes first.

### 2. Make request handling resilient

Current `request()` writes to the socket and waits for response.

Improve:

- If socket is closing/closed before send, reconnect once and retry request.
- If waitFor fails with close/error during request, clear singleton and retry idempotent read commands once.
- Do **not** blindly retry write commands like send/stop without idempotency.

For this issue, `middleware_chat_history` is read-only and should be safe to retry once.

### 3. Add read-only command retry wrapper

File: `apps/middleware/src/services/commands.ts`

For read-only gateway commands such as:

- `middleware_chat_history`
- `middleware_sessions_list`
- `middleware_models_list`
- `middleware_connect_status` if applicable

Use a helper:

```ts
async function withGatewayReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() }
  catch (error) {
    if (!isGatewayTransientError(error)) throw error
    resetGatewayConnection()
    return await fn()
  }
}
```

Transient errors include:

- `closed waiting for connect.challenge`
- `gateway websocket closed before open`
- `timeout waiting for connect.challenge`
- `WebSocket is not open`
- socket close/error during response wait

### 4. Add focused tests

Add unit tests for `apps/middleware/src/services/gateway.ts` if feasible:

- 5 concurrent `connectGateway()` calls share one in-flight connect promise.
- transient close during challenge retries and succeeds.
- singleton is cleared on close.
- request retries read-only command once after transient close.

If mocking `ws` is too heavy, add integration-style script/load test gate first and keep code simpler.

### 5. Strengthen load scripts

Existing scripts:

```bash
pnpm --filter @openclaw/desktop-middleware load:test:streams
pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

Add/adjust thresholds:

- `http_req_failed: rate==0` for reliability gate, not `<1%`.
- Keep local exploratory threshold separate if needed.
- Add `GATEWAY_HISTORY_REQUIRED=true` mode so failures in `middleware_chat_history` always fail the test.

### 6. Verification gate before push/merge

Run sequentially, RAM-safe:

```bash
# UI state tests
pnpm --filter ui exec vitest run \
  lib/__tests__/chatStream.test.ts \
  lib/__tests__/chatSessionStore.test.ts \
  lib/__tests__/chatSessionLoad.test.ts

pnpm --filter ui typecheck

# Middleware tests
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test

# Load tests against isolated middleware
STREAMS=5 DURATION_MS=90000 pnpm --filter @openclaw/desktop-middleware load:test:streams
VUS=5 DURATION=60s SPACE_COUNT=3 pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

Required pass criteria:

- 5/5 SSE streams stay open for 90s.
- API load has 0 failed requests.
- `middleware_chat_history` has 0 failures.
- MemAvailable never drops below 1GB.
- No leftover k6/docker/middleware test process.

---

## Recommended Implementation Order

1. Refactor middleware gateway client to singleton + in-flight connection dedupe.
2. Add transient gateway error classification + reset helper.
3. Add safe read-only retry for `middleware_chat_history` first.
4. Run 5 VU / 60s load test.
5. If clean, expand retry wrapper to other read-only gateway commands.
6. Run full verification gate.
7. Commit and push.

---

## What Not To Do

- Do not increase concurrency blindly.
- Do not retry write commands without idempotency.
- Do not hide failures in load tests by allowing `<1%` failure rate for reliability gate.
- Do not treat the React shared-session fix as sufficient; this failure is gateway connection churn.
- Do not run multiple heavy tests concurrently on this VPS; keep sequential and monitor RAM.
