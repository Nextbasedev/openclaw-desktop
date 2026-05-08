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

---

## Additional Edge Cases To Cover Before Implementation

I re-checked the plan against the current middleware and server gateway-client code. The main direction is still correct, but implementation should explicitly cover these edge cases so the fix does not create a new class of bugs.

### Connection lifecycle edge cases

- **Do not return a half-open singleton.** Reuse only when `ws.readyState === WebSocket.OPEN` and the gateway handshake has completed.
- **Clear `connectingGateway` in both success and failure paths.** Otherwise a rejected in-flight promise can poison future requests.
- **Stale singleton after gateway restart.** If the gateway restarts while middleware stays up, the next request must detect close/error, clear the singleton, reconnect, then retry safe reads once.
- **Listeners must not leak per request.** `waitFor()` listeners for each request must always clean up on success, timeout, close, or error.
- **Shared socket + concurrent requests.** Multiple in-flight requests on one socket must correlate strictly by request id. Event frames and unrelated responses must be ignored without consuming the caller's response.
- **Long-lived stream vs short API calls.** Chat/SSE streams may keep listeners attached while history/model/session calls run. The shared client must support both without one caller closing the socket out from under another.
- **Do not call `gw.close()` in command handlers after moving to singleton.** Existing handlers close per-request clients in `finally`; those closes must be removed/replaced with no-op release semantics for shared connections.

### Scope/auth edge cases

- **Scope superset must match real gateway policy.** Current code uses `operator.admin` for exec policy/session patch/history in places, and docs list admin as part of middleware operator scopes. If setup/pairing grants only non-admin scopes, admin will reintroduce pairing/scope-upgrade problems. Decide one durable rule before implementation:
  - either bootstrap/setup grants the full middleware scope set including admin, or
  - commands that do not need admin stop requesting admin.
- **Scope changes while singleton is open.** If a future command requires scopes outside the current singleton, fail clearly or reconnect with the normalized superset. Do not silently run a command with insufficient scopes.
- **Token/identity rotation.** If `~/.openclaw/openclaw.json` token or device identity changes, the singleton must be reset; otherwise middleware can keep using a stale authenticated socket.

### Retry/idempotency edge cases

- **Retry read-only commands only.** Safe initial list: `middleware_chat_history`, `middleware_sessions_list`, `middleware_models_list`, connection/status reads. Do not retry `chat.send`, `chat.abort`, `sessions.patch`, approval resolve, file writes, or workspace mutations unless they have a proven idempotency key.
- **Retry after send ambiguity.** If the socket closes after writing a request but before receiving the response, treat write commands as unknown outcome and surface an error instead of retrying.
- **Retry budget must be small.** One reconnect + one read retry is enough; avoid infinite reconnect loops inside HTTP request handlers.
- **Error classifier must be narrow.** Retry only gateway transport errors: closed before open, closed waiting for challenge/response, challenge timeout, `WebSocket is not open`, socket close/error. Do not retry application errors like bad auth, scope denied, 4xx validation, missing session, or command-specific failures.

### Load/test edge cases

- **Test with gateway restart during load.** Add a short test where gateway/middleware socket is closed mid-run and read-only calls recover.
- **Test token/scope denial separately.** Confirm bad token/scope-denied errors do not enter retry loops.
- **Test mixed workload.** Run chat stream + `middleware_chat_history` + `middleware_sessions_list` together, not only tabs or streams separately.
- **Assert open socket count.** During a 5 VU tab test, gateway socket count should remain near one shared middleware connection, not grow with requests.
- **Assert no process leaks.** After load tests, no leftover k6/node middleware child process should remain.

### Documentation / branch hygiene

- This plan file currently exists on branch `ui/new-feat`, not on the current `main` checkout. Anyone implementing from it should checkout/pull `ui/new-feat` or merge/cherry-pick the plan first.
- Keep the implementation commit on a feature branch, not directly on `main`, unless explicitly requested.
