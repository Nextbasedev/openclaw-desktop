# Gateway Constraints

## Protocol

- WebSocket protocol version: 3
- Authentication: Ed25519 device key (SPKI format)
- Challenge-response: Gateway sends challenge → client signs with private key → Gateway verifies
- Scopes: `operator.read`, `operator.write`, `operator.admin`

## Gateway Requests (from middleware)

| Request | Purpose | Default Timeout |
|---------|---------|-----------------|
| `sessions.create` | Create/ensure a session exists | 30s |
| `sessions.patch` | Update session properties (exec policy) | 30s |
| `chat.send` | Send user message to agent | 120s |
| `chat.history` | Fetch message history for session | 30s |
| `exec.approval.resolve` | Resolve tool execution approval | 30s |

## Gateway Events (received by middleware)

| Event | Payload Key | Description |
|-------|-------------|-------------|
| `session.message` | `sessionKey`, `message` | New or updated message |
| `session.tool` | `sessionKey`, `data` | Tool call lifecycle update |
| `sessions.changed` | `sessionKey`, `status` | Session metadata changed |
| `chat.event` | `sessionKey`, `status` | Run status update (done/error/aborted) |
| `agent.event` | `sessionKey`, `stream` | Agent streaming (thinking, item, command_output) |

## Important Behaviors

1. **`chat.send` returns before completion** — Gateway may return `status: "done"` before the assistant message appears in `chat.history`. Middleware must NOT broadcast done until history confirms both user echo and assistant response.

2. **History load after send can fail** — Middleware treats history load failure as non-fatal (warn-logged, not thrown). UI still receives the optimistic message and status patches.

3. **Event ordering is not guaranteed** — Gateway events may arrive out of order. Middleware uses `openclaw_seq` projection and deduplication to maintain consistency.

4. **Session file rotation** — Gateway may rotate the session file. Middleware tracks this via segments (`v2_segments.session_file`).

5. **Reconnection** — Gateway client auto-reconnects with exponential backoff. Pending requests during disconnect are rejected with timeout errors.
