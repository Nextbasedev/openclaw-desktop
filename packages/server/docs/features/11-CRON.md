# Feature Migration: Cron Jobs

## Overview

Cron commands manage scheduled tasks on the Gateway. **Requires OpenClaw Gateway to be running.**

## Commands

| Command | Args |
|---------|------|
| `middleware_cron_list_jobs` | `{}` |
| `middleware_cron_get_job` | `{ jobId }` |
| `middleware_cron_create_job` | `{ name, schedule, task, params?, enabled?, metadata? }` |
| `middleware_cron_update_job` | `{ jobId, name?, schedule?, task?, params?, enabled?, metadata? }` |
| `middleware_cron_delete_job` | `{ jobId }` |
| `middleware_cron_run_job` | `{ jobId, params? }` |
| `middleware_cron_job_status` | `{ jobId }` |
| `middleware_cron_list_runs` | `{ jobId, limit?, sortDir?, afterTs? }` |
| `middleware_cron_get_run` | `{ jobId, runId }` |
| `middleware_cron_pause_job` | `{ jobId, paused }` |
| `middleware_cron_poll_run_completion` | `{ jobId, afterTs, timeoutMs?, intervalMs? }` |
| `middleware_cron_create_notification_job` | `{ name, schedule, notificationMessage, sessionKey }` |

## Response Shapes

### CronJob object

```typescript
interface CronJob {
  id: string
  name: string
  schedule: string     // cron expression, e.g. "0 9 * * *"
  task: string
  params: unknown
  enabled: boolean
  metadata: unknown
  createdAt: string
  updatedAt: string
}
```

### CronRun object

```typescript
interface CronRun {
  id: string
  jobId: string
  status: string      // "pending" | "running" | "completed" | "failed"
  startedAt: string
  completedAt: string | null
  result: unknown
  error: string | null
}
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

// List all cron jobs
const { jobs } = await invoke("middleware_cron_list_jobs")

// Create a daily job
const { job } = await invoke("middleware_cron_create_job", {
  name: "Daily Report",
  schedule: "0 9 * * *",
  task: "generate_report",
  enabled: true
})

// Manually trigger a job
const { run } = await invoke("middleware_cron_run_job", {
  jobId: job.id
})

// Poll until completion
const result = await invoke("middleware_cron_poll_run_completion", {
  jobId: job.id,
  afterTs: new Date().toISOString(),
  timeoutMs: 30000
})
```

## Error Cases

- `"Gateway not connected. Start the OpenClaw Gateway first."` — Gateway unavailable
- All cron operations are proxied to the Gateway — errors come from the Gateway
