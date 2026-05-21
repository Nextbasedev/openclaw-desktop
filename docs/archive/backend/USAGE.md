# USAGE.md

Scope: document the backend/middleware contract for Jarvis usage tracking APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- local SQLite `session_mappings` table (project_id, topic_id columns)
- Gateway `sessions.usage` and `usage.cost` WebSocket methods

Current Tauri commands:
- `middleware_usage_by_project`
- `middleware_usage_by_topic`
- `middleware_usage_summary`
- `middleware_usage_session`

## Overview

The OpenClaw Gateway tracks per-session token counts, costs, latency, and tool call metrics. However, the Gateway has no concept of Jarvis projects or topics -- those are local SQLite constructs. These usage commands bridge the gap by fetching session usage from the Gateway and grouping it by project/topic using local session_mappings.

## Architecture

### Single Gateway Call + Local Aggregation

The Gateway's `sessions.usage` method does not support batch queries or filtering by project/topic. It accepts either no key (returns all sessions up to a limit) or a single key (returns one session).

Strategy: make ONE `sessions.usage` call with `limit: 500` to fetch all session usage, then JOIN with local SQLite `session_mappings` to group by project_id or topic_id. Aggregation happens in Rust.

### Data flow

```
Frontend calls middleware_usage_by_project({ profileId, projectId? })
  |
  +-- 1. Gateway: sessions.usage { limit: 500, startDate?, endDate? }
  |       Returns: { sessions: [...], totals: {...} }
  |
  +-- 2. SQLite: SELECT session_key, project_id FROM session_mappings
  |
  +-- 3. Rust: Group Gateway sessions by project using local mapping
  |       HashMap<project_id, Vec<session_usage>>
  |       Sum totals per group
  |
  +-- 4. Return: { projects: [{ projectId, projectName, totals, sessions }] }
```

### Helper functions

- `empty_cost_totals()` -- returns zeroed CostUsageTotals
- `extract_session_usage_entry(session)` -- maps Gateway session format to SessionUsageEntry
- `usage_to_totals(usage)` -- extracts cost fields from Gateway usage object
- `add_totals(a, b)` -- sums two CostUsageTotals objects
- `aggregate_usage_by_group(sessions, group_map, group_names)` -- reusable grouping engine used by both by-project and by-topic commands
- `fetch_gateway_sessions_usage(start_date, end_date)` -- single Gateway call wrapper

## `middleware_usage_by_project`

### Input
```json
{
  "profileId": "prof_local",
  "projectId": "proj_1",
  "startDate": "2026-04-01",
  "endDate": "2026-04-18"
}
```

`projectId`, `startDate`, `endDate` are optional. When `projectId` is provided, results filter to that project only.

### Behavior
1. Fetches all session usage from Gateway (`sessions.usage`, limit 500)
2. Loads `session_key -> project_id` mappings from SQLite
3. Loads project names from SQLite
4. Groups sessions by project using `aggregate_usage_by_group`
5. Returns per-project totals with session breakdown

### Output
```json
{
  "projects": [
    {
      "projectId": "proj_1",
      "projectName": "Jarvis Desktop",
      "totals": {
        "input": 5000,
        "output": 2500,
        "cacheRead": 100,
        "cacheWrite": 50,
        "totalTokens": 7650,
        "totalCost": 0.15,
        "inputCost": 0.06,
        "outputCost": 0.09,
        "cacheReadCost": 0.002,
        "cacheWriteCost": 0.001
      },
      "sessionCount": 3,
      "sessions": [
        {
          "key": "sess_1",
          "label": "Debug auth",
          "model": "claude-sonnet-4-20250514",
          "totals": { "..." : "..." },
          "messageCounts": { "total": 10, "user": 3, "assistant": 3, "toolCalls": 2, "toolResults": 2, "errors": 0 },
          "firstActivity": 1700000000,
          "lastActivity": 1700003600
        }
      ]
    }
  ]
}
```

## `middleware_usage_by_topic`

### Input
```json
{
  "profileId": "prof_local",
  "projectId": "proj_1",
  "topicId": "topic_1",
  "startDate": "2026-04-01",
  "endDate": "2026-04-18"
}
```

`projectId` is required. `topicId`, `startDate`, `endDate` are optional.

### Behavior
1. Same Gateway call as by-project
2. Loads `session_key -> topic_id` from `session_mappings WHERE project_id = ?`
3. Sessions with NULL topic_id go into the `unassigned` bucket
4. Groups by topic using `aggregate_usage_by_group`
5. Returns per-topic totals plus an unassigned bucket

### Output
```json
{
  "topics": [
    {
      "topicId": "topic_1",
      "topicName": "Deploy flow",
      "totals": { "..." : "..." },
      "sessionCount": 2,
      "sessions": [...]
    }
  ],
  "unassigned": {
    "topicId": null,
    "topicName": null,
    "totals": { "..." : "..." },
    "sessionCount": 1,
    "sessions": [...]
  }
}
```

## `middleware_usage_summary`

### Input
```json
{
  "startDate": "2026-04-01",
  "endDate": "2026-04-18"
}
```

Both fields are optional.

### Behavior
Thin wrapper around Gateway `usage.cost`. Passes through date filters and returns aggregated totals with daily breakdown.

### Output
```json
{
  "totals": {
    "input": 50000,
    "output": 25000,
    "cacheRead": 1000,
    "cacheWrite": 500,
    "totalTokens": 76500,
    "totalCost": 1.50,
    "inputCost": 0.60,
    "outputCost": 0.90,
    "cacheReadCost": 0.02,
    "cacheWriteCost": 0.01
  },
  "daily": [
    { "date": "2026-04-17", "totalTokens": 5000, "totalCost": 0.10 },
    { "date": "2026-04-18", "totalTokens": 3000, "totalCost": 0.06 }
  ],
  "days": 18
}
```

## `middleware_usage_session`

### Input
```json
{
  "sessionKey": "sess_1"
}
```

### Behavior
Calls Gateway `sessions.usage` with a single key. Returns the session's usage details.

### Output
```json
{
  "session": {
    "key": "sess_1",
    "label": "Debug auth",
    "model": "claude-sonnet-4-20250514",
    "totals": { "..." : "..." },
    "messageCounts": { "total": 10, "user": 3, "assistant": 3, "toolCalls": 2, "toolResults": 2, "errors": 0 },
    "firstActivity": 1700000000,
    "lastActivity": 1700003600
  }
}
```

## TypeScript contracts

Defined in `packages/shared/src/api/usage.ts`:

| operationId | method | path |
|-------------|--------|------|
| `usage.byProject` | POST | `/api/usage/by-project` |
| `usage.byTopic` | POST | `/api/usage/by-topic` |
| `usage.summary` | GET | `/api/usage/summary` |
| `usage.session` | GET | `/api/usage/session` |

## Test coverage

- **Rust unit tests** (`middleware/usage_tests.rs`): 13 tests covering `empty_cost_totals`, `usage_to_totals`, `add_totals`, `extract_session_usage_entry`, and `aggregate_usage_by_group` (grouping, unmapped sessions, empty input, unknown names, sum correctness, session arrays)
- **TypeScript contract tests** (`shared/src/api/index.test.ts`): usage representative parser validates request/response Zod schemas
