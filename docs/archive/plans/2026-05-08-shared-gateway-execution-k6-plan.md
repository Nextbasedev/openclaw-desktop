# Execution Plan — Shared Gateway Reliability + Tab Burst k6 Testing

**Date:** 2026-05-08 06:45 UTC  
**Branch:** `ui/new-feat`  
**Repo:** `Nextbasedev/openclaw-desktop`  
**Companion main plan:** `docs/plans/2026-05-08-main-shared-gateway-reliability-plan.md`

---

## 1. Execution style

Use the Superpowers workflow:

1. TDD task implementation.
2. Commit after each green task.
3. Spec review after each task.
4. Code quality review after each task.
5. Full verification and k6/load gates before merge.

No task is complete without fresh command output.

---

## 2. Task sequence

### Task 0 — Tab-switch API audit

Create:

- `docs/plans/2026-05-08-tab-switch-api-audit.md`

Do:

- Grep UI for `invoke("middleware_` and `streamUrl(`.
- Classify all repeated calls as cacheable/dedupe-only/write/stream/polling.
- Confirm exact calls listed in the main plan.

Commit:

```bash
git commit -m "docs: audit tab switch middleware calls"
```

---

### Task 1 — Feature flag and shared handle contract

Files:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/tests/gateway-shared-flag.test.ts`

Tests:

- true-like env values enable shared gateway.
- default false.
- shared handle close does not close underlying singleton.

Commands:

```bash
pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-flag.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "test: cover shared gateway feature flag"
```

---

### Task 2 — Shared RPC Gateway coordinator

Files:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/tests/gateway-shared-rpc.test.ts`

Tests:

- concurrent shared RPC connects create one WebSocket handshake.
- concurrent RPC requests are multiplexed by response ID.
- singleton clears on close.
- pending requests reject exactly once on close.
- half-open socket is not reused.

Commands:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-shared-rpc.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "feat: add shared rpc gateway coordinator"
```

---

### Task 3 — Safe read retry

Files:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/commands.ts`
- `apps/middleware/tests/gateway-read-retry.test.ts`

Tests:

- retries `middleware_chat_history` once after transient close.
- does not retry `chat.send`.
- does not retry application errors.
- reset/reconnect happens before retry.

Commands:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-read-retry.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "fix: retry safe gateway reads after transient reconnect"
```

---

### Task 4 — UI safe-read request dedupe/cache

Files:

- `packages/ui/lib/requestDedupe.ts`
- `packages/ui/lib/__tests__/requestDedupe.test.ts`
- apply to repeated callers from main plan.

Tests:

- same key in-flight dedupes.
- different keys do not dedupe.
- TTL cache returns resolved value.
- rejected promises are not cached.
- invalidation by key/prefix works.

Commands:

```bash
pnpm --filter ui exec vitest run lib/__tests__/requestDedupe.test.ts
pnpm --filter ui typecheck
```

Commit:

```bash
git commit -m "feat: dedupe safe reads during tab switches"
```

---

### Task 5 — Shared event socket and chat stream hub skeleton

Files:

- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/src/app.ts`
- `apps/middleware/tests/chat-stream-hub.test.ts`

Tests:

- multiple chat stream clients use one shared event Gateway.
- matching session events fan out correctly.
- unrelated session events are ignored.
- closing one UI SSE client does not close shared Gateway event socket.
- write failure removes only failing UI client.

Commands:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/chat-stream-hub.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "feat: fan out chat streams from shared event gateway"
```

---

### Task 6 — Preserve current chat stream event mapping

Files:

- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/src/app.ts`
- `apps/middleware/tests/chat-stream-hub-events.test.ts`

Tests:

- assistant `session.message` emits `chat.message`.
- final assistant state emits done.
- `session.tool` emits `chat.tool`.
- `sessions_spawn` subagent linking preserved.
- user messages ignored for visible assistant output.
- unrelated subagent events ignored except link bookkeeping.

Commands:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/chat-stream-hub-events.test.ts
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "refactor: preserve chat stream mapping in shared hub"
```

---

### Task 7 — Silent reconnect + recovery refresh

Files:

- `apps/middleware/src/services/gateway-recovery.ts`
- `apps/middleware/src/services/gateway.ts`
- `apps/middleware/src/services/chat-stream-hub.ts`
- `apps/middleware/tests/gateway-recovery.test.ts`

Tests:

- no UI reconnect status before 2 minutes.
- delayed live updates status after event stream down for 2 minutes.
- retry/troubleshooting status after 5 minutes.
- event reconnect refreshes sessions list + open chat histories.
- recovery uses read retry and never retries writes.

Commands:

```bash
MIDDLEWARE_SHARED_GATEWAY=true pnpm --filter @openclaw/desktop-middleware exec vitest run apps/middleware/tests/gateway-recovery.test.ts
pnpm --filter @openclaw/desktop-middleware typecheck
```

Commit:

```bash
git commit -m "feat: recover shared gateway streams silently"
```

---

### Task 8 — Tab-switch regression tests

Files:

- `packages/ui/lib/__tests__/tabSwitchRequests.test.ts`
- maybe extend `packages/ui/lib/__tests__/chatSessionLoad.test.ts`

Tests:

- switching between cached chat tabs does not refetch session resolution.
- two ChatBoxes share one voice settings request.
- usage tab dedupes usage requests for same period.
- workspace focus refresh dedupes same path tree request.

Commands:

```bash
pnpm --filter ui exec vitest run lib/__tests__/tabSwitchRequests.test.ts lib/__tests__/chatSessionLoad.test.ts lib/__tests__/chatStream.test.ts
pnpm --filter ui typecheck
```

Commit:

```bash
git commit -m "test: cover tab switch request bursts"
```

---

### Task 9 — Load scripts + k6-style burst gates

Files:

- `apps/middleware/scripts/load-test-tab-burst.cjs`
- `apps/middleware/scripts/load-test-tabs.cjs`
- `apps/middleware/scripts/load-test-streams.cjs`
- `apps/middleware/package.json`

Add script:

```json
"load:test:tab-burst": "node scripts/load-test-tab-burst.cjs"
```

The burst script should simulate:

1. Open chat A: history, branch list, pins, voice settings, stream.
2. Switch chat B: history, branch list, pins, voice settings, stream.
3. Switch back chat A within TTL.
4. Open inspector: sessions list, workspace tree, stream.
5. Open settings voice: voice settings.
6. Open settings usage: usage + daily.
7. Open notifications activity: cron jobs + recent activity + cron stream.

Pass gates:

- zero `middleware_chat_history` failures in normal load.
- local/config reads do not open Gateway sockets.
- Gateway socket count stays bounded in shared mode.
- active UI SSE clients and pending RPC count return to zero after test.

Commit:

```bash
git commit -m "test: add tab burst load gate"
```

---

## 3. k6 / load testing plan

The existing scripts are Node-based. If k6 is available/preferred, mirror the same scenarios in `qa/k6/` later. For this experiment, the required gate is behavior-equivalent load testing, either via Node script or k6.

### 3.1 Smoke profile

Purpose: prove shared mode basics.

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=5 \
DURATION=30s \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Pass:

- no crash.
- no history failures.
- socket count bounded.

### 3.2 Regression profile

Purpose: catch tab-switch repeats and stream churn.

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=5 \
DURATION=60s \
SPACE_COUNT=3 \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Also run:

```bash
MIDDLEWARE_SHARED_GATEWAY=true STREAMS=5 DURATION_MS=90000 pnpm --filter @openclaw/desktop-middleware load:test:streams
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s SPACE_COUNT=3 GATEWAY_HISTORY_REQUIRED=true pnpm --filter @openclaw/desktop-middleware load:test:tabs
```

Pass:

- 5/5 streams stay open for 90s.
- tab load has 0 failed read requests.
- history required failures fail the test.

### 3.3 Higher confidence profile

Purpose: test heavier user behavior without going straight to stress.

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=25 \
DURATION=120s \
SPACE_COUNT=5 \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Pass:

- no unbounded memory/listener growth.
- no socket growth proportional to VUs.
- read failures remain 0 under normal expected load.

### 3.4 Stress profile

Purpose: experimental ceiling.

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=100 \
DURATION=180s \
SPACE_COUNT=10 \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Pass target:

- no crash.
- bounded sockets.
- no runaway pending request count.
- acceptable error reporting if limits are reached.

### 3.5 Soak profile

Purpose: detect leaks.

```bash
MIDDLEWARE_SHARED_GATEWAY=true \
VUS=25 \
DURATION=30m \
SPACE_COUNT=5 \
GATEWAY_HISTORY_REQUIRED=true \
GATEWAY_SOCKET_MAX=2 \
pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Pass:

- memory plateaus.
- pending RPC count returns to baseline.
- UI SSE client count returns to baseline.
- no leftover load/middleware child processes.

---

## 4. Required full verification before approval

Run unit/type/build:

```bash
pnpm --filter @openclaw/desktop-middleware test
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware build
pnpm --filter ui exec vitest run \
  lib/__tests__/requestDedupe.test.ts \
  lib/__tests__/tabSwitchRequests.test.ts \
  lib/__tests__/chatStream.test.ts \
  lib/__tests__/chatSessionStore.test.ts \
  lib/__tests__/chatSessionLoad.test.ts
pnpm --filter ui typecheck
```

Run load gates:

```bash
MIDDLEWARE_SHARED_GATEWAY=true STREAMS=5 DURATION_MS=90000 pnpm --filter @openclaw/desktop-middleware load:test:streams
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s SPACE_COUNT=3 GATEWAY_HISTORY_REQUIRED=true pnpm --filter @openclaw/desktop-middleware load:test:tabs
MIDDLEWARE_SHARED_GATEWAY=true VUS=5 DURATION=60s SPACE_COUNT=3 GATEWAY_HISTORY_REQUIRED=true GATEWAY_SOCKET_MAX=2 pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
MIDDLEWARE_SHARED_GATEWAY=true VUS=25 DURATION=120s SPACE_COUNT=5 GATEWAY_HISTORY_REQUIRED=true GATEWAY_SOCKET_MAX=2 pnpm --filter @openclaw/desktop-middleware load:test:tab-burst
```

Manual/process checks:

```bash
ps -eo pid,cmd | grep -E 'load-test|k6|desktop-middleware' | grep -v grep || true
ss -tan state established '( sport = :18789 )' | wc -l
```

---

## 5. Final pass/fail criteria

Must pass:

- No OpenClaw backend code changed.
- Feature flag off smoke still works.
- Feature flag on uses shared RPC + shared event sockets.
- Normal Gateway socket count from middleware remains bounded around 2.
- 5 VU tab burst has 0 failed read requests.
- 25 VU tab burst passes without socket/memory/listener growth.
- Stream test: 5 streams for 90s pass.
- Local config reads like voice/model do not create Gateway sockets.
- Chat history failures are not hidden.
- Slow/failing UI SSE client does not block other clients.
- No leftover test processes.

Only after these pass should we discuss merge/PR/main.
