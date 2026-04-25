"use client"

export type CronRunLike = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt?: string | null
  error?: string | null
}

export type CronJobLike<TRun extends CronRunLike = CronRunLike> = {
  jobId: string
  enabled: boolean
  paused?: boolean
  lastRun?: TRun | null
}

export type CronRunEventLike = {
  type: "cron.run.started" | "cron.run.completed" | "cron.run.failed"
  jobId: string
  runId?: string
  sessionKey?: string | null
  status: string
  timestamp: string
  error?: string | null
}

export type CronStatusVariant = "card" | "popover" | "banner"

export type CronStatusMeta<TRun extends CronRunLike = CronRunLike> = {
  phase: "off" | "paused" | "never-run" | "running" | "completed" | "failed" | "unknown"
  label: string
  detail: string
  className: string
  run: TRun | null
}

function normalizeStatus(status?: string | null): string {
  return String(status ?? "").trim().toLowerCase()
}

function isRunningStatus(status?: string | null): boolean {
  return normalizeStatus(status) === "running"
}

function isFailedStatus(status?: string | null, error?: string | null): boolean {
  const normalized = normalizeStatus(status)
  return normalized === "failed" || normalized === "error" || Boolean(error)
}

function runTimeMs(run?: CronRunLike | null): number {
  if (!run) return 0
  const raw = run.finishedAt ?? run.startedAt
  const time = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function eventTimeMs(event?: CronRunEventLike | null): number {
  if (!event) return 0
  const time = event.timestamp ? new Date(event.timestamp).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

export function formatCronRunTime(iso?: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function eventToRun<TRun extends CronRunLike>(
  event: CronRunEventLike,
  previousRun?: TRun | null,
): TRun {
  const normalized = normalizeStatus(event.status)
  const status = event.type === "cron.run.started"
    ? "running"
    : normalized || (event.type === "cron.run.failed" ? "failed" : "completed")
  const startedAt = status === "running"
    ? event.timestamp
    : previousRun?.startedAt ?? event.timestamp

  return {
    runId: event.runId ?? previousRun?.runId ?? `event:${event.jobId}:${event.timestamp}`,
    jobId: event.jobId,
    status,
    startedAt,
    finishedAt: status === "running" ? null : event.timestamp,
    error: event.error ?? null,
  } as TRun
}

export function resolveCronJobRun<TRun extends CronRunLike>(
  job: CronJobLike<TRun>,
  latestEvent?: CronRunEventLike | null,
): TRun | null {
  const currentRun = job.lastRun ?? null
  if (!latestEvent || latestEvent.jobId !== job.jobId) return currentRun

  const nextRun = eventToRun(latestEvent, currentRun)
  if (!currentRun) return nextRun

  const currentMs = runTimeMs(currentRun)
  const nextMs = eventTimeMs(latestEvent)
  const sameRun = Boolean(
    latestEvent.runId &&
    currentRun.runId &&
    latestEvent.runId === currentRun.runId,
  )

  if (sameRun) return nextRun

  if (isRunningStatus(currentRun.status)) {
    if (!isRunningStatus(nextRun.status) && nextMs >= runTimeMs({
      ...currentRun,
      finishedAt: currentRun.startedAt,
    }) - 1_000) {
      return nextRun
    }
    if (isRunningStatus(nextRun.status) && nextMs >= currentMs - 1_000) {
      return nextRun
    }
    return currentRun
  }

  if (isRunningStatus(nextRun.status)) {
    return nextMs >= currentMs - 1_000 ? nextRun : currentRun
  }

  return nextMs >= currentMs + 1_000 ? nextRun : currentRun
}

export function getCronStatusMeta<TRun extends CronRunLike>(
  job: CronJobLike<TRun>,
  options?: {
    latestEvent?: CronRunEventLike | null
    variant?: CronStatusVariant
  },
): CronStatusMeta<TRun> {
  const variant = options?.variant ?? "card"
  if (!job.enabled) {
    return {
      phase: "off",
      label: "Off",
      detail: job.lastRun ? `Last run ${job.lastRun.status}` : "Not scheduled",
      className: "bg-secondary text-muted-foreground",
      run: job.lastRun ?? null,
    }
  }
  if (job.paused) {
    return {
      phase: "paused",
      label: "Paused",
      detail: job.lastRun ? `Last run ${job.lastRun.status}` : "Not scheduled",
      className: "bg-secondary text-muted-foreground",
      run: job.lastRun ?? null,
    }
  }

  const run = resolveCronJobRun(job, options?.latestEvent)
  if (!run) {
    return {
      phase: "never-run",
      label: "Never run",
      detail: variant === "popover" ? "No run history" : "No run history yet",
      className: "bg-foreground/5 text-muted-foreground",
      run: null,
    }
  }

  if (isRunningStatus(run.status)) {
    return {
      phase: "running",
      label: "Running now",
      detail: variant === "popover"
        ? formatCronRunTime(run.startedAt)
        : `Started ${formatCronRunTime(run.startedAt)}`,
      className: "bg-chart-2/15 text-chart-2",
      run,
    }
  }

  if (normalizeStatus(run.status) === "completed") {
    return {
      phase: "completed",
      label: variant === "popover" ? "Completed" : "Last run completed",
      detail: formatCronRunTime(run.finishedAt ?? run.startedAt),
      className: "bg-chart-1/15 text-chart-1",
      run,
    }
  }

  if (isFailedStatus(run.status, run.error)) {
    return {
      phase: "failed",
      label: variant === "popover" ? "Failed" : "Last run failed",
      detail: run.error ?? formatCronRunTime(run.finishedAt ?? run.startedAt),
      className: "bg-red-400/15 text-red-400",
      run,
    }
  }

  return {
    phase: "unknown",
    label: variant === "popover" ? run.status : `Last run ${run.status}`,
    detail: formatCronRunTime(run.finishedAt ?? run.startedAt),
    className: "bg-foreground/5 text-muted-foreground",
    run,
  }
}

export function mergeCronRunEvents<TEvent extends CronRunEventLike>(
  previous: TEvent[],
  next: TEvent,
  maxEvents: number,
): TEvent[] {
  const isDone = next.type !== "cron.run.started"
  const deduped = previous.filter((event) => {
    if (next.runId && event.runId === next.runId) return false
    if (!next.runId && event.jobId === next.jobId && event.type === next.type) return false
    if (isDone && event.jobId === next.jobId && event.type === "cron.run.started") return false
    return true
  })
  return [next, ...deduped].slice(0, maxEvents)
}

export function applyCronEventToJobs<TJob extends CronJobLike<TRun>, TRun extends CronRunLike>(
  jobs: TJob[],
  event: CronRunEventLike,
): TJob[] {
  return jobs.map((job) => {
    if (job.jobId !== event.jobId) return job
    return {
      ...job,
      lastRun: resolveCronJobRun(job, event),
    }
  })
}

export function sortCronJobsByStatus<TJob extends CronJobLike<TRun>, TRun extends CronRunLike>(
  jobs: TJob[],
  latestEvents?: Map<string, CronRunEventLike>,
): TJob[] {
  return [...jobs].sort((a, b) => {
    const aStatus = getCronStatusMeta(a, {
      latestEvent: latestEvents?.get(a.jobId),
      variant: "popover",
    })
    const bStatus = getCronStatusMeta(b, {
      latestEvent: latestEvents?.get(b.jobId),
      variant: "popover",
    })
    const aRunning = aStatus.phase === "running" ? 1 : 0
    const bRunning = bStatus.phase === "running" ? 1 : 0
    if (aRunning !== bRunning) return bRunning - aRunning
    return runTimeMs(bStatus.run) - runTimeMs(aStatus.run)
  })
}
