# Group 07 — Cron / Notification Activity

## Connected issues

- Cron Activity polls every 1 second.
- Poll responses can overwrite newer SSE events.
- Concurrent runs collapse by jobId.
- Expanded row tracks index, not run id.
- Cron navigation ignores runId.

## Files to touch first

- `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- `packages/ui/components/notifications/tabs/CronJobsTab.tsx`
- `packages/ui/components/notifications/tabs/CronJobRow.tsx`
- `packages/ui/components/AppPage.tsx`
- `apps/middleware/src/features/compat/routes.ts`

## Touch order

1. Add cron hydrate/SSE metrics.
2. Replace 1s poll with SSE-first and slower fallback/backoff.
3. Add request sequence guard to hydration.
4. Key activity events by `runId` when present, not just `jobId`.
5. Store `expandedRunId`, not `expandedIdx`.
6. Debounce `fetchJobs()` on terminal SSE bursts.
7. Make navigation use exact runId when available.

## Expected invariant

SSE should be the live source. Polling should not overwrite newer events.
