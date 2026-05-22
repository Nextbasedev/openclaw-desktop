# CRON.md

Scope: document the current backend/middleware contract for cron job management in Jarvis.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- OpenClaw Gateway cron methods underneath

Current Tauri commands:
- `middleware_cron_list_jobs`
- `middleware_cron_get_job`
- `middleware_cron_create_job`
- `middleware_cron_update_job`
- `middleware_cron_delete_job`
- `middleware_cron_run_job`
- `middleware_cron_job_status`
- `middleware_cron_list_runs`
- `middleware_cron_get_run`
- `middleware_cron_pause_job`
- `middleware_cron_poll_run_completion`
- `middleware_cron_create_notification_job`

## Contract notes

Jarvis already includes compatibility fallback logic for old vs new OpenClaw cron payload shapes.

Frontend should rely on Jarvis middleware shapes, not raw Gateway shapes.

## `middleware_cron_list_jobs`

### Input
```json
{}
```

### Response
```json
{
  "jobs": []
}
```

Behavior:
- reads from Gateway `cron.list`
- includes disabled jobs
- normalizes jobs before returning

## `middleware_cron_get_job`

### Input
```json
{ "jobId": "cron_xxx" }
```

### Response
```json
{
  "job": {},
  "currentRun": null
}
```

Current implementation:
- loads all jobs
- finds one by id
- `currentRun` is always `null` today

## `middleware_cron_create_job`

### Input
```json
{
  "name": "Morning summary",
  "schedule": "0 9 * * *",
  "task": "session.message",
  "params": {
    "key": "agent:main:main",
    "message": "Good morning"
  },
  "enabled": true,
  "metadata": {
    "type": "notification"
  }
}
```

### Behavior
- parses schedule
- converts Jarvis task model into current OpenClaw cron job fields
- tries new Gateway contract first
- retries legacy payload shape only on invalid-param style errors

### Response
```json
{ "job": {} }
```

## `middleware_cron_update_job`

### Input
```json
{
  "jobId": "cron_xxx",
  "name": "Updated name",
  "schedule": "*/10 * * * *",
  "task": "session.message",
  "params": {},
  "enabled": true,
  "metadata": {}
}
```

All fields except `jobId` are optional.

### Behavior
- builds patch for new contract
- falls back to legacy shape when necessary

## `middleware_cron_delete_job`

### Input
```json
{ "jobId": "cron_xxx" }
```

### Response
```json
{ "ok": true, "jobId": "cron_xxx" }
```

## `middleware_cron_run_job`

### Input
```json
{ "jobId": "cron_xxx" }
```

### Response
```json
{
  "runId": "run_xxx",
  "jobId": "cron_xxx",
  "status": "queued"
}
```

Observed statuses may include:
- `queued`
- `started`
- provider-specific normalized status strings

## `middleware_cron_job_status`

Thin wrapper over `middleware_cron_get_job`.

## `middleware_cron_list_runs`

### Input
```json
{
  "jobId": "cron_xxx",
  "limit": 20,
  "sortDir": "desc",
  "afterTs": 1776400000000
}
```

### Response
```json
{
  "jobId": "cron_xxx",
  "runs": []
}
```

Important note:
- middleware applies client-side filtering for `afterTs` compatibility
- frontend should not assume live Gateway supports `afterTs` natively

## `middleware_cron_get_run`

### Input
```json
{ "jobId": "cron_xxx", "runId": "run_xxx" }
```

### Response
```json
{ "run": {} }
```

Implementation detail:
- fetches recent runs and finds one by id

## `middleware_cron_pause_job`

### Input
```json
{ "jobId": "cron_xxx", "paused": true }
```

### Behavior
- implemented as enabled toggle inversion
- `paused: true` means update job with `enabled: false`

## `middleware_cron_poll_run_completion`

### Input
```json
{
  "jobId": "cron_xxx",
  "afterTs": 1776400000000,
  "timeoutMs": 90000,
  "intervalMs": 1000
}
```

### Response
```json
{
  "completed": true,
  "run": {}
}
```

Terminal statuses considered complete:
- `ok`
- `error`
- `skipped`

## `middleware_cron_create_notification_job`

Convenience helper to create a `session.message` cron job.

### Input
```json
{
  "name": "Reminder",
  "schedule": "0 9 * * *",
  "sessionKey": "agent:main:main",
  "notificationMessage": "Check the dashboard"
}
```

## Frontend guidance

Use cron middleware for:
- CRUD of jobs
- run history
- manual run actions
- notification-style scheduled messages

Do not build UI against raw OpenClaw cron request shapes.
Jarvis already absorbs the new-vs-legacy contract differences.
