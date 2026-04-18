# Usage API — Frontend Guide

Frontend contract for the Jarvis usage/cost tracking page.

## Quick start

```typescript
import { invoke } from "@tauri-apps/api/core"
import type {
  UsageByProjectRequest,
  UsageByProjectResponse,
  UsageByTopicRequest,
  UsageByTopicResponse,
  UsageSummaryResponse,
  UsageSessionRequest,
  UsageSessionResponse,
  CostUsageTotals,
  ProjectUsage,
  TopicUsage,
  SessionUsageEntry,
  DailyUsageEntry,
} from "@jarvis/shared/api"
```

All types are exported from `packages/shared/src/api/usage.ts`.

---

## Commands

| Tauri command | Purpose | Use case |
|---|---|---|
| `middleware_usage_summary` | Overall totals + daily chart data | Dashboard header, cost chart |
| `middleware_usage_by_project` | Usage grouped by project | Project cost breakdown table |
| `middleware_usage_by_topic` | Usage grouped by topic within a project | Topic-level drill-down |
| `middleware_usage_session` | Single session detail | Session detail view |

---

## 1. `middleware_usage_summary`

Get overall usage totals and daily breakdown. Good for the top-level dashboard.

### Request

```typescript
const result = await invoke<UsageSummaryResponse>("middleware_usage_summary", {
  input: {
    startDate: "2026-04-01",  // optional — ISO date string
    endDate: "2026-04-18",    // optional — ISO date string
  }
})
```

Both `startDate` and `endDate` are optional. Omit both to get all-time data.

### Response

```typescript
{
  totals: CostUsageTotals,       // aggregate across all sessions
  daily: DailyUsageEntry[],      // one entry per day, sorted chronologically
  days: number,                  // total number of days in the range
}
```

Example:

```json
{
  "totals": {
    "input": 125000,
    "output": 62000,
    "cacheRead": 8400,
    "cacheWrite": 3200,
    "totalTokens": 198600,
    "totalCost": 3.42,
    "inputCost": 1.50,
    "outputCost": 1.86,
    "cacheReadCost": 0.042,
    "cacheWriteCost": 0.018
  },
  "daily": [
    { "date": "2026-04-17", "totalTokens": 15200, "totalCost": 0.28 },
    { "date": "2026-04-18", "totalTokens": 9800, "totalCost": 0.17 }
  ],
  "days": 18
}
```

### UI suggestions

- Use `totals.totalCost` for a headline cost figure
- Use `daily` array to render a bar/line chart (x = date, y = totalCost or totalTokens)
- Use `totals.input` / `totals.output` for a token split donut chart

---

## 2. `middleware_usage_by_project`

Get usage broken down by project. Each project includes its sessions.

### Request

```typescript
const result = await invoke<UsageByProjectResponse>("middleware_usage_by_project", {
  input: {
    profileId: "prof_local",          // required — current profile ID
    projectId: "proj_1",              // optional — filter to one project
    startDate: "2026-04-01",          // optional
    endDate: "2026-04-18",            // optional
  }
})
```

Omit `projectId` to get usage for ALL projects.

### Response

```typescript
{
  projects: ProjectUsage[]
}
```

Each `ProjectUsage`:

```typescript
{
  projectId: string,
  projectName: string,
  totals: CostUsageTotals,
  sessionCount: number,
  sessions: SessionUsageEntry[],
}
```

Example:

```json
{
  "projects": [
    {
      "projectId": "proj_1",
      "projectName": "Jarvis Desktop",
      "totals": {
        "input": 85000,
        "output": 42000,
        "cacheRead": 5600,
        "cacheWrite": 2100,
        "totalTokens": 134700,
        "totalCost": 2.31,
        "inputCost": 1.02,
        "outputCost": 1.26,
        "cacheReadCost": 0.028,
        "cacheWriteCost": 0.012
      },
      "sessionCount": 5,
      "sessions": [
        {
          "key": "sess_abc123",
          "label": "Debug auth flow",
          "model": "claude-sonnet-4-20250514",
          "totals": {
            "input": 12000,
            "output": 6000,
            "cacheRead": 800,
            "cacheWrite": 300,
            "totalTokens": 19100,
            "totalCost": 0.33,
            "inputCost": 0.144,
            "outputCost": 0.18,
            "cacheReadCost": 0.004,
            "cacheWriteCost": 0.002
          },
          "messageCounts": {
            "total": 24,
            "user": 8,
            "assistant": 8,
            "toolCalls": 4,
            "toolResults": 4,
            "errors": 0
          },
          "firstActivity": 1713340800,
          "lastActivity": 1713344400
        }
      ]
    },
    {
      "projectId": "proj_2",
      "projectName": "OpenClaw Gateway",
      "totals": { "...": "..." },
      "sessionCount": 3,
      "sessions": ["..."]
    }
  ]
}
```

### UI suggestions

- Render a table: project name, session count, total cost, total tokens
- Sort by `totals.totalCost` descending to show most expensive projects first
- Click a project row to drill into `middleware_usage_by_topic`
- Use the `sessions` array for an expandable session list within each project

---

## 3. `middleware_usage_by_topic`

Get usage grouped by topic within a specific project. Sessions not assigned to any topic appear in the `unassigned` bucket.

### Request

```typescript
const result = await invoke<UsageByTopicResponse>("middleware_usage_by_topic", {
  input: {
    profileId: "prof_local",          // required
    projectId: "proj_1",              // required — which project to drill into
    topicId: "topic_1",               // optional — filter to one topic
    startDate: "2026-04-01",          // optional
    endDate: "2026-04-18",            // optional
  }
})
```

### Response

```typescript
{
  topics: TopicUsage[],
  unassigned: TopicUsage,       // sessions with no topic
}
```

Each `TopicUsage`:

```typescript
{
  topicId: string | null,       // null for unassigned
  topicName: string | null,     // null for unassigned
  totals: CostUsageTotals,
  sessionCount: number,
  sessions: SessionUsageEntry[],
}
```

Example:

```json
{
  "topics": [
    {
      "topicId": "topic_1",
      "topicName": "Deploy flow",
      "totals": {
        "input": 45000,
        "output": 22000,
        "cacheRead": 3000,
        "cacheWrite": 1200,
        "totalTokens": 71200,
        "totalCost": 1.22,
        "inputCost": 0.54,
        "outputCost": 0.66,
        "cacheReadCost": 0.015,
        "cacheWriteCost": 0.007
      },
      "sessionCount": 2,
      "sessions": ["..."]
    }
  ],
  "unassigned": {
    "topicId": null,
    "topicName": null,
    "totals": {
      "input": 8000,
      "output": 4000,
      "cacheRead": 500,
      "cacheWrite": 200,
      "totalTokens": 12700,
      "totalCost": 0.22,
      "inputCost": 0.096,
      "outputCost": 0.12,
      "cacheReadCost": 0.003,
      "cacheWriteCost": 0.001
    },
    "sessionCount": 1,
    "sessions": ["..."]
  }
}
```

### UI suggestions

- Always show the `unassigned` bucket (maybe as "No topic" at the bottom)
- `topicId: null` and `topicName: null` means unassigned — not an error
- Same table layout as projects: topic name, session count, cost, tokens

---

## 4. `middleware_usage_session`

Get detailed usage for a single session.

### Request

```typescript
const result = await invoke<UsageSessionResponse>("middleware_usage_session", {
  input: {
    sessionKey: "sess_abc123",      // required
  }
})
```

### Response

```typescript
{
  session: SessionUsageEntry
}
```

Example:

```json
{
  "session": {
    "key": "sess_abc123",
    "label": "Debug auth flow",
    "model": "claude-sonnet-4-20250514",
    "totals": {
      "input": 12000,
      "output": 6000,
      "cacheRead": 800,
      "cacheWrite": 300,
      "totalTokens": 19100,
      "totalCost": 0.33,
      "inputCost": 0.144,
      "outputCost": 0.18,
      "cacheReadCost": 0.004,
      "cacheWriteCost": 0.002
    },
    "messageCounts": {
      "total": 24,
      "user": 8,
      "assistant": 8,
      "toolCalls": 4,
      "toolResults": 4,
      "errors": 0
    },
    "firstActivity": 1713340800,
    "lastActivity": 1713344400
  }
}
```

### UI suggestions

- `firstActivity` and `lastActivity` are Unix timestamps (seconds) — convert to local time
- `messageCounts` is optional — may be missing for very old sessions
- Show `model` as a badge/tag
- Calculate duration: `lastActivity - firstActivity`

---

## Shared types reference

### `CostUsageTotals`

Every usage response contains this shape for aggregated costs:

| Field | Type | Description |
|---|---|---|
| `input` | `number` | Input tokens consumed |
| `output` | `number` | Output tokens generated |
| `cacheRead` | `number` | Tokens served from cache |
| `cacheWrite` | `number` | Tokens written to cache |
| `totalTokens` | `number` | Sum of all token types |
| `totalCost` | `number` | Total cost in USD |
| `inputCost` | `number` | Cost of input tokens |
| `outputCost` | `number` | Cost of output tokens |
| `cacheReadCost` | `number` | Cost of cache reads |
| `cacheWriteCost` | `number` | Cost of cache writes |

### `SessionUsageEntry`

Per-session usage detail:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Session key (unique identifier) |
| `label` | `string?` | Human-readable session name |
| `model` | `string?` | Model used (e.g. `claude-sonnet-4-20250514`) |
| `totals` | `CostUsageTotals` | Token and cost breakdown |
| `messageCounts` | `MessageCounts?` | Message breakdown (optional) |
| `firstActivity` | `number?` | Unix timestamp of first activity |
| `lastActivity` | `number?` | Unix timestamp of last activity |

### `MessageCounts`

| Field | Type | Description |
|---|---|---|
| `total` | `number` | Total messages in session |
| `user` | `number` | User messages |
| `assistant` | `number` | Assistant responses |
| `toolCalls` | `number` | Tool invocations |
| `toolResults` | `number` | Tool results returned |
| `errors` | `number` | Error messages |

### `DailyUsageEntry`

| Field | Type | Description |
|---|---|---|
| `date` | `string` | ISO date string (`YYYY-MM-DD`) |
| `totalTokens` | `number` | Tokens used that day |
| `totalCost` | `number` | Cost in USD that day |

---

## Navigation flow

Suggested page drill-down:

```
Usage Dashboard
  middleware_usage_summary → totals + daily chart
    |
    v
Usage by Project
  middleware_usage_by_project → project table
    |
    v  (click a project row)
Usage by Topic
  middleware_usage_by_topic → topic table within project
    |
    v  (click a session row)
Session Detail
  middleware_usage_session → single session breakdown
```

---

## Date filtering

All commands accept optional `startDate` and `endDate` as ISO date strings (`YYYY-MM-DD`).

- Both omitted: returns all-time data
- Only `startDate`: returns data from that date forward
- Only `endDate`: returns data up to that date
- Both provided: returns data within that date range (inclusive)

For a date range picker in the UI, pass both values:

```typescript
await invoke("middleware_usage_summary", {
  input: {
    startDate: "2026-04-01",
    endDate: "2026-04-18",
  }
})
```

---

## Error handling

All commands return `Result<Value, String>`. On error, the Tauri invoke promise rejects with a string message. Wrap calls in try/catch:

```typescript
try {
  const result = await invoke<UsageSummaryResponse>("middleware_usage_summary", {
    input: {}
  })
} catch (error) {
  // error is a string like "Failed to connect to gateway"
  // Show a toast/banner — the gateway may be offline
}
```

Common failure modes:
- Gateway offline or unreachable
- No active profile configured
- Session key not found (for `middleware_usage_session`)

---

## Notes

- All costs are in **USD**
- Token counts are raw integers (not thousands)
- `sessions` arrays inside project/topic responses include full `SessionUsageEntry` objects — no need for a second call to get session details
- The `unassigned` field in `middleware_usage_by_topic` always exists, even if empty (sessionCount: 0)
- Data comes from the OpenClaw Gateway in real-time — there is no local cache, so each call is a fresh fetch
