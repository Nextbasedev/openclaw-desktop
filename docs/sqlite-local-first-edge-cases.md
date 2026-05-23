# SQLite Local-First Bootstrap — Edge Cases

## Change
Local-first now serves from SQLite when:
1. **In-memory fresh** (bootstrapped within 30s) — same as before
2. **NEW: SQLite fresh + Gateway connected** (session updated within 5min AND Gateway is connected)

Previously: only served local-first if bootstrapped in-memory within 30s.
Now: serves local-first even after middleware restart, as long as SQLite has recent data and Gateway is connected.

## Why Gateway Connected Matters

When Gateway is connected, the middleware has a live event stream (`sessions.messages.subscribe`) for all sessions. Every message, tool call, and status change is projected into SQLite in real-time. So SQLite is authoritative — no need to call `chat.history`.

When Gateway is DISCONNECTED, events may have been missed. SQLite could be stale. Must call `chat.history` to catch up.

## Edge Cases

### 1. Gateway Connected, SQLite Fresh

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Message sent from Telegram 10s ago, already in SQLite via live event | None — SQLite has it | ✅ |
| Tool started 5s ago, in SQLite via `chat.tool.started` event | None — SQLite has it | ✅ |
| Status changed to thinking, in SQLite via `chat.status` event | None — SQLite has it | ✅ |
| Agent replied, assistant message in SQLite via `session.message` | None — SQLite has it | ✅ |

**Verdict: SAFE** — live event stream keeps SQLite current.

### 2. Gateway Disconnects Then Reconnects

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Gateway was down for 30s, messages sent during downtime | Missing messages in SQLite | `gatewayConnected` check fails during disconnect → falls through to Gateway `chat.history` |
| Gateway reconnects, but session not yet re-subscribed | May miss events between reconnect and re-subscribe | Background sync in local-first path calls `chat.history` → catches up |
| Gateway was down for 2min, SQLite is 2min stale | SQLite age < 5min, but Gateway now connected | Background sync reconciles; live events start flowing again |

**Verdict: SAFE** — disconnect forces Gateway round-trip. Reconnect triggers re-subscription.

### 3. Middleware Restart

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Restart, SQLite has data from 1min ago | `localSession.updatedAtMs` = 1min ago, < 5min → serve local | ✅ Background sync catches up |
| Restart, SQLite has data from 10min ago | `updatedAtMs` = 10min ago, > 5min → Gateway round-trip | ✅ Correct — data too old |
| Restart, Gateway not yet connected | `gatewayConnected = false` → Gateway round-trip | ✅ Safe fallback |
| Restart, Gateway connects within 1s | First request may hit Gateway, subsequent serve local | ✅ First request primes the cache |

**Verdict: SAFE** — SQLite age + Gateway status prevents serving truly stale data.

### 4. Stale Status in SQLite

| Scenario | Risk | Mitigation |
|----------|------|------------|
| SQLite says `status: "thinking"` but run already finished | Stale thinking indicator | Background sync updates within seconds; `STALE_BOOTSTRAP_RUN_MS` (5min) auto-finalizes; `reconcileIfStale` (10s) catches |
| SQLite says `status: "done"` but new run just started | Missed active run briefly | Live event stream delivers `chat.status` immediately after local-first serve |
| SQLite has old tool calls marked `running` | Stale tool cards | Background sync + `STALE_BOOTSTRAP_TOOL_MS` (30min) auto-finalizes |

**Verdict: LOW RISK** — multiple fallback mechanisms catch stale status.

### 5. Concurrent Updates During Local-First Serve

| Scenario | Risk | Mitigation |
|----------|------|------------|
| New message arrives via live event WHILE local-first response is being built | Message in SQLite but not in response | Background sync patches it; patch stream delivers to frontend |
| Tool completes via live event DURING local-first serve | Tool in SQLite but old state in response | Same — patch stream corrects |

**Verdict: SAFE** — eventual consistency within milliseconds via patch stream.

### 6. Session Never Bootstrapped

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Brand new chat, no data in SQLite | `localSession = null` → `canServeLocal = false` → Gateway round-trip | ✅ Correct |
| Session exists in SQLite but has 0 messages | `localMessages.length === 0` → `canServeLocal = false` → Gateway round-trip | ✅ Correct |
| Migrated session, archive imported but not yet bootstrapped | Session exists, messages exist, `updatedAtMs` is recent | Serves from SQLite ✅ — archive data is valid |

**Verdict: SAFE** — empty/missing sessions always fall through to Gateway.

## When Gateway Round-Trip Is Still Required

1. **No data in SQLite** — first-ever visit to a chat
2. **SQLite data > 5 minutes old** — too stale to trust
3. **Gateway disconnected** — can't guarantee SQLite is current
4. **After Gateway reconnect before re-subscription** — brief window where events may be missed (background sync covers this)

## Summary

The only time a user waits for Gateway is:
- First visit to a chat that was never opened before
- OR Gateway is disconnected
- OR data is more than 5 minutes old

All other cases: **instant from SQLite (4-6ms)**.
