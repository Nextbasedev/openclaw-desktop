# GATEWAY-PROTOCOL.md — OpenClaw Gateway WebSocket Protocol

> Reverse-engineered from openclaw-power-dashboard and OpenClaw source.
> This is a living document — update as we discover more.

## Status: 🔴 Not Yet Documented

**TODO (Day 1):**
1. Read OpenClaw gateway source code to map WebSocket events
2. Capture live events from a running Gateway
3. Document every event type, format, and session key pattern

## Known So Far

### Data Sources (from power-dashboard reference)

**Sessions file:** `~/.openclaw/agents/main/sessions/sessions.json`
- Contains all session metadata
- Session keys follow patterns like:
  - `telegram:direct` → direct chat
  - `telegram:group:<chatId>:topic:<topicId>` → group topic
  - `cron:<jobId>` → cron job

**Transcripts:** `~/.openclaw/agents/main/sessions/<sessionId>.jsonl`
- One JSON object per line
- Each entry has: role, content, timestamp, cost info
- Tool calls embedded in content

### WebSocket Connection

**TODO:** Document:
- [ ] Connection URL format
- [ ] Authentication (token-based)
- [ ] Event types (message, stream, tool_call, sub_agent, etc.)
- [ ] Session creation/resumption
- [ ] Message format (send)
- [ ] Streaming event format (receive)
- [ ] Sub-agent spawn/completion events
- [ ] Error events
- [ ] Reconnection protocol
- [ ] Cancellation / interrupt

### Session Key Formats

```
telegram:<chatId>                      → direct chat
telegram:group:<chatId>                → group (no topics)
telegram:group:<chatId>:topic:<topicId> → group topic
cron:<jobId>                           → cron session
dashboard:<sessionId>                  → web dashboard
```

### Transcript Entry Format (JSONL)

```jsonc
{
  "role": "user" | "assistant" | "tool",
  "content": "..." | [...],  // string or content blocks
  "timestamp": 1234567890,
  // tool calls in content blocks:
  // { "type": "tool_use", "name": "...", "input": {...} }
  // { "type": "tool_result", "content": "..." }
}
```
