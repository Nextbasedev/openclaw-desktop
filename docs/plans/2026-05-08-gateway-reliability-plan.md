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

---

## Related OpenClaw Backend WebSocket Reliability Plan

Created from Dixit's attached plan: `openclaw-backend-websocket-reliability-plan.md`.

Original scope: read-only repo inspection plus implementation/testing plan for `/root/.openclaw/workspace/openclaw`. The source file was intentionally outside the OpenClaw repo and not committed to any OpenClaw branch. This section brings the plan into the `ui/new-feat` planning branch so the desktop/middleware reliability work and backend Gateway reliability work stay connected.

### Backend repo state observed

OpenClaw backend repo path:

```txt
/root/.openclaw/workspace/openclaw
```

Observed branch when the external plan was created:

```txt
fix/silent-reply-dm-suppression
```

No OpenClaw backend repo files were changed during the original inspection.

### What OpenClaw already supports

OpenClaw already has a mature Gateway protocol foundation:

- WebSocket Gateway server/client:
  - `src/gateway/server.impl.ts`
  - `src/gateway/server-ws-runtime.ts`
  - `src/gateway/server/ws-connection.ts`
  - `src/gateway/server/ws-connection/message-handler.ts`
  - `src/gateway/client.ts`
- Typed protocol schemas/validators:
  - `src/gateway/protocol/AGENTS.md`
  - `src/gateway/protocol/schema/frames.ts`
  - `src/gateway/protocol/schema/nodes.ts`
  - `src/gateway/protocol/schema/logs-chat.ts`
  - `src/gateway/protocol/index.ts`
- Existing frame shapes:
  - request: `{ type: "req", id, method, params }`
  - response: `{ type: "res", id, ok, payload, error }`
  - event: `{ type: "event", event, payload, seq }`
- Existing safeguards:
  - handshake challenge before connect
  - auth/device identity validation
  - protocol version negotiation
  - pre-auth payload limit
  - max payload: `25MB`
  - max buffered bytes: `50MB`
  - tick heartbeat every `30s`
  - reconnect with exponential backoff on client
  - slow-consumer drop/close behavior for broadcasts
  - event sequence gap detection in client
  - request timeout handling in client
- Existing node invocation model:
  - `src/gateway/node-registry.ts`
  - Gateway sends `node.invoke.request` event to node
  - pending invoke is tracked by request ID
  - timeout resolves cleanly
  - disconnect currently rejects pending invokes for that node
- Existing pending-work model:
  - `src/gateway/node-pending-work.ts`
  - currently supports `status.request` and `location.request`
  - supports enqueue/drain/ack, dedupe by work type, expiry, and priorities

Conclusion: OpenClaw already accepts the base WebSocket architecture. The gap is not "can OpenClaw do WebSockets?" — it can. The gap is durable request/session orchestration across socket reconnects, especially for desktop/node tasks.

### Telegram Desktop lesson applied to OpenClaw

Telegram Desktop does not treat a socket as the owner of work. It separates:

1. instance/coordinator
2. session per data center/purpose
3. connection transport
4. request map
5. retry/resend/timer logic
6. event/update routing

For OpenClaw, the equivalent should be:

1. Gateway coordinator
2. client/node session registry
3. WebSocket transport
4. durable request manager
5. retry/resume/timer policy
6. event bus/subscription routing

Core principle: socket death must not imply request death unless the request is explicitly non-resumable.

### Current backend risk areas

#### 1. Pending client requests are socket-local

`src/gateway/client.ts` keeps `pending = new Map<string, Pending>()` inside `GatewayClient`. On socket close it calls `flushPendingErrors(...)`.

That is fine for short operator RPCs, but weak for long desktop/node tasks if reconnect happens while work is running.

#### 2. Node invokes are connection-coupled

`src/gateway/node-registry.ts` rejects pending invokes when a node disconnects:

- `unregister(connId)` removes the node session.
- pending invokes for that node reject with `node disconnected (...)`.

A single socket close can poison in-flight work even when the same desktop/node reconnects immediately.

#### 3. Idempotency is present but not yet a durable request contract

Many protocol params already include `idempotencyKey`, which is good. It should become first-class behavior:

- duplicate request returns existing result/status
- reconnect can resume by `requestId` or `idempotencyKey`
- task final state is queryable after the socket is gone

#### 4. Event streams can drop frames

Broadcast events support sequence numbers and the client detects gaps. After gap detection, the system still needs a recovery path:

- fetch missed events since seq, or
- reload domain snapshot, or
- subscribe to durable task/session stream

Recommendation: start with snapshots because they are simpler and safer than an unbounded replay buffer.

#### 5. Bad requests should fail locally when policy allows

Invalid request frames currently return `INVALID_REQUEST` without closing after authenticated connect. Verify the same isolation for:

- malformed node invoke params
- malformed chat/task params
- unknown method
- command not found
- handler throw
- bad JSON payload inside otherwise valid frame

Important correction: oversized frames or WebSocket protocol violations may correctly close the socket. The "bad request must not close the socket" rule applies to authenticated, valid-frame, application-level bad requests only.

### Proposed backend improvement plan

#### Phase 1 — Document current Gateway contract

Deliverables:

- Gateway request lifecycle diagram
- Node invoke lifecycle diagram
- Desktop reconnect lifecycle diagram
- Failure matrix:
  - invalid frame
  - invalid params
  - handler throws
  - node disconnects
  - gateway restarts
  - client reconnects
  - slow consumer
  - tick timeout
  - request timeout

Suggested future files in the OpenClaw backend repo:

- `docs/gateway/reliability.md`
- `docs/gateway/websocket-request-lifecycle.md`

#### Phase 2 — Add an in-memory Gateway Request Manager

Create a Gateway-side request manager that owns long-running request state above the socket layer.

Conceptual API:

- `register(request)`
- `markAccepted(requestId)`
- `markSentToNode(requestId, nodeId)`
- `markProgress(requestId, event)`
- `markCompleted(requestId, result)`
- `markFailed(requestId, error)`
- `getStatus(requestId | idempotencyKey)`
- `resume(requestId | idempotencyKey)`
- `cancel(requestId | idempotencyKey)`

Request fields:

- `requestId`
- `idempotencyKey`
- `method`
- `nodeId/sessionKey`
- `state`: `queued | sent | running | completed | failed | expired | cancelled`
- `createdAtMs`
- `updatedAtMs`
- `expiresAtMs`
- `attemptCount`
- `lastConnId`
- `result/error`
- `policySnapshot` or `policyVersion`

Start in-memory first. Persist important classes later only after lifecycle semantics are clean.

#### Phase 3 — Separate node identity from node socket

Current shape:

- `nodesById -> NodeSession`, and `NodeSession` includes current socket/client.

Improved shape:

- `NodeRecord`: durable node metadata, capabilities, permissions, last seen state.
- `NodeConnection`: current socket/client/connId.
- pending invocations owned by Request Manager, not directly by socket.

On disconnect:

- mark node `temporarily_disconnected`
- do not immediately fail resumable requests
- start grace timer
- if same node reconnects within grace period, resume/drain pending work
- if grace expires, fail with `NODE_DISCONNECTED_TIMEOUT`

#### Phase 4 — Make selected node invokes resumable

For approved resumable node commands/tasks:

- Gateway sends `node.invoke.request` with `idempotencyKey`.
- Node stores active/completed task result by `idempotencyKey` for a TTL.
- On reconnect, gateway asks node to reconcile:
  - active request IDs
  - completed request IDs
  - failed request IDs
- Gateway resolves pending request from reconciliation when a result exists.

Potential protocol methods/events:

- `node.invoke.status`
- `node.invoke.resume`
- `node.invoke.cancel`
- `node.reconcile.request`
- `node.reconcile.result`

#### Phase 5 — Add event recovery / snapshot refresh

Start with domain snapshots:

- presence snapshot
- sessions snapshot
- task snapshot
- node snapshot

Only add event replay after there is a bounded storage policy:

- max event count
- max age
- max total bytes
- per-domain replay ownership

#### Phase 6 — Transport policy cleanup

WebSocket remains primary, but business logic should sit above transport.

Transport should provide only:

- connect
- authenticated session
- send frame
- receive frame
- close
- health/tick

Business logic above transport should own:

- request lifecycle
- dedupe
- retry/resume policy
- node work state
- stream aggregation

#### Phase 7 — Observability

Add counters/logs for:

- active sockets
- active node connections
- active logical node records
- pending requests by state
- pending requests by method
- reconnect count
- bad request count
- request timeout count
- node disconnect grace recoveries
- duplicate idempotency hits
- dropped events by slow consumer
- gap detections

Do not log full params/results for node commands. Log metadata only unless explicitly safe.

### Implementation order recommendation

1. Add request lifecycle docs/tests around current behavior.
2. Add in-memory Request Manager behind existing `node.invoke` path.
3. Preserve current external behavior by default.
4. Add observability counters and test hooks.
5. Add resumable mode for selected command types only.
6. Add reconnect grace period for node invokes.
7. Add status/resume/cancel APIs.
8. Add k6 stress suite.
9. Only then consider persistent storage.

Recommended first backend branch task:

**Add a Gateway Request Manager prototype and route `node.invoke` through it without changing external behavior.**

Why first:

- low risk
- adds observability
- preserves current API
- creates the seam for resumability
- makes tests/k6 assertions possible

### Required edge cases before backend implementation

#### Durability / process lifecycle

- In-memory Request Manager survives socket reconnects only; it does **not** survive Gateway process restart.
- Gateway restart durability requires persistence later, with explicit TTL and cleanup.
- If Gateway restarts before persistence exists, requests should fail clearly as non-resumable across process restart.

#### Node identity / hijack prevention

- Reconnected nodes must prove the same durable identity before resuming work.
- Do not let a new socket claiming the same `nodeId` hijack pending invokes.
- Resume should require matching device identity/public key/fingerprint, not just a reused string ID.

#### Policy / permission changes

- Command allowlist, capabilities, scopes, and permissions can change while work is pending.
- Pick one rule per command class:
  - freeze policy at accept time, or
  - re-check policy before resume/result delivery.
- For safety, default to re-checking policy for resumable node commands unless this breaks a known workflow.

#### Idempotency semantics

- Define exact duplicate behavior:
  - duplicate while `queued/running` returns current status, not a second execution.
  - duplicate after `completed` returns the stored result until TTL expiry.
  - duplicate after `failed/cancelled/expired` returns final state, not silent restart.
- Idempotency key must be scoped by caller/method/node/session to avoid cross-user collision.
- Max stored result size must be enforced.

#### Cancellation / timeout semantics

- Operator cancel should mark request `cancelled` and notify node if possible.
- Timeout should resolve exactly once.
- Node result after timeout/cancel should be handled deterministically:
  - either ignored with metric, or
  - stored as late result but not delivered as success.
- `node.invoke.result` currently ignores late results; Request Manager must explicitly preserve or discard late/duplicate results according to the state machine.

#### Backpressure / resource limits

- Add max pending requests globally.
- Add max pending requests per node.
- Add TTL sweeper for expired requests/results.
- Add max result bytes and max progress-event bytes.
- Add bounded event replay if replay is implemented.
- Add metrics for rejected requests due to quota/backpressure.

#### Bad request isolation

- Application-level bad requests should not break the socket/session.
- WebSocket/protocol-level violations may close the socket by policy.
- Verify next valid request succeeds after:
  - unknown method
  - invalid params
  - command not allowed
  - handler throws
  - malformed node invoke result
  - late duplicate result

#### Existing `node-pending-work` limitation

- `src/gateway/node-pending-work.ts` is useful as a pattern, but it is not a generic invoke queue today.
- It currently supports only `status.request` and `location.request`.
- Do not assume it can carry arbitrary resumable node invokes without extending its type model and queue semantics.

#### Event recovery

- Snapshot refresh should be the first recovery path.
- If event replay is added, bound it by count, time, and bytes.
- Gap detection should trigger domain-specific refresh, not just log a warning.

#### Security / privacy

- Observability must not log full node params/results by default.
- Redact secrets, environment values, file contents, and user messages unless explicitly needed in a debug-only path.
- Resume/status APIs must enforce the same auth/scope checks as the original request.

### Testing plan

Use Vitest/unit tests first; k6 comes after semantics are stable.

#### Unit/integration tests before k6

Add tests around:

- `NodeRegistry.unregister()` no longer immediately rejects resumable invokes during grace period.
- non-resumable invokes still fail cleanly on disconnect.
- duplicate `idempotencyKey` does not run duplicate work.
- late `node.invoke.result` after timeout/cancel resolves zero or one final state, never two.
- reconnect with same identity resumes; reconnect with mismatched identity does not.
- invalid params/unknown method do not poison the authenticated socket.
- Request Manager TTL sweeper removes expired records.
- quota/backpressure rejection returns a clean error.

#### k6 categories

1. WebSocket handshake smoke
2. Bad request isolation
3. Single-request regression
4. Concurrent WebSocket load
5. Long soak
6. Reconnect chaos
7. Node invoke pressure
8. Streaming pressure
9. Resource limits

#### Heavy k6 profiles

Start conservative, then increase:

- Smoke: 10 VUs, 1 minute
- Regression: 50 VUs, 5 minutes
- Load: 500 VUs, 15 minutes
- Stress: 1,000 → 2,500 VUs, 30 minutes
- Soak: 500–1,000 VUs, 1–3 hours
- Chaos: 500 VUs, random disconnect/reconnect, 30–60 minutes

Monitor:

```bash
ulimit -n
ss -s
ss -tan state established '( sport = :18789 )' | wc -l
ps -o pid,rss,pcpu,pmem,cmd -p <gateway_pid>
lsof -p <gateway_pid> | wc -l
```

Minimum gates:

- no gateway crash
- application-level bad request does not close authenticated socket unless policy requires close
- next valid request succeeds after bad request
- request timeout resolves once
- no duplicate final response for same request ID
- no duplicate task for same idempotency key
- reconnect does not leave ghost running task
- memory growth plateaus during soak
- p95 lightweight RPC below target threshold
- reconnect success rate above target threshold

### Do not do yet

- Do not rewrite all WebSocket handling at once.
- Do not introduce persistence before in-memory lifecycle is clean.
- Do not mix this with unrelated branch work.
- Do not make every request resumable; classify request types first.
- Do not use k6 as a substitute for deterministic Request Manager unit tests.
- Do not hide application bugs by blindly retrying write commands.

### Final backend recommendation

OpenClaw can accept this direction. The backend already has typed Gateway frames, validators, WebSocket lifecycle, node registry, pending work primitives, idempotency fields, heartbeats, sequence numbers, and slow-consumer handling.

The right improvement is a Telegram-style layer above sockets:

- durable request manager
- logical node sessions separate from socket connections
- resumable node invoke/task lifecycle
- event recovery/snapshot reload
- heavy validation after deterministic tests

This should make the desktop/backend integration more reliable without fighting the existing architecture.
