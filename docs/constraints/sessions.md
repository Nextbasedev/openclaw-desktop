# Session Constraints

## Session Types

| Type | Source | Protected from sync cleanup |
|------|--------|-----------------------------|
| Gateway | Synced from OCPlatform Gateway | No (stale ones cleaned) |
| Imported | Telegram/channel import | Yes |
| Manual | User-created locally | Yes |
| Desktop | Created via desktop UI | Yes |

## Session Sync Rules

- Gateway sessions synced via `syncGatewaySessions()`
- Sync MUST preserve imported, manual, local, and desktop sessions
- Only stale gateway-only sessions (no longer in Gateway) are cleaned up
- Stale gateway-only chats cleaned alongside stale sessions

## Per-Window Isolation

- Each Tauri/browser window has a unique `openclawWindowId`
- Secondary windows: tagged via `openRouteInNewWindow()` with `openclawWindowId` query param
- `openclawWindowId` stored in `sessionStorage` (survives in-window navigation, not cross-window)
- Main window: stable `"main"` scope with legacy layout fallback/migration

### Layout Cache Scoping
- Cache key: `workspace:last-layout:v1:{windowId}`
- Main window checks legacy key `workspace:last-layout:v1` as fallback
- Prevents cross-window chat/layout bleed

## Telegram Import Naming

- Group imports use `proposedName` (unique) over raw `topicName` (may duplicate)
- Duplicate topic names within same group get unique suffixes via `proposedName`

## Session Data Model (SQLite)

```sql
v2_sessions: session_key (PK), session_id, data_json, updated_at_ms
v2_segments: segment_id (PK), session_key, session_id, session_file, base_seq
v2_messages: session_key + openclaw_seq (PK), segment_id, message_id, role, data_json
v2_runs: run_id (PK), session_key, gateway_run_id, status, started_at_ms
v2_tool_calls: session_key + tool_call_id (PK), run_id, name, phase, status
v2_projection_events: cursor (PK), session_key, event_type, payload_json
```
