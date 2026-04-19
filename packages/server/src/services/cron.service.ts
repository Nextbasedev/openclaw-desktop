import { ensureGatewayClient } from "../gateway/client.js"

export function parseCronSchedule(schedule: string) {
  const trimmed = schedule.trim()
  if (!trimmed) throw new Error("Cron schedule cannot be empty")
  const parts = trimmed.split(/\s+/)
  if (parts.length < 5 || parts.length > 6) {
    throw new Error(
      `Invalid cron expression: expected 5-6 fields, got ${parts.length}`,
    )
  }
  return { kind: "cron", expr: trimmed }
}

type CronJob = {
  jobId: string
  name: string
  schedule: string
  task: string
  enabled: boolean
  paused: boolean
  params: unknown
  metadata: unknown
  createdAt: string
  updatedAt: string
}

type CronRun = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  result: unknown
  error: string | null
}

function normalizeJob(raw: Record<string, unknown>): CronJob {
  return {
    jobId: String(raw.jobId ?? raw.id ?? ""),
    name: String(raw.name ?? ""),
    schedule: String(raw.schedule ?? ""),
    task: String(raw.task ?? ""),
    enabled: Boolean(raw.enabled ?? true),
    paused: Boolean(raw.paused ?? false),
    params: raw.params ?? null,
    metadata: raw.metadata ?? null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? ""),
  }
}

function normalizeRun(raw: Record<string, unknown>): CronRun {
  return {
    runId: String(raw.runId ?? raw.id ?? ""),
    jobId: String(raw.jobId ?? ""),
    status: String(raw.status ?? "unknown"),
    startedAt: String(raw.startedAt ?? ""),
    finishedAt: raw.finishedAt ? String(raw.finishedAt) : null,
    result: raw.result ?? null,
    error: raw.error ? String(raw.error) : null,
  }
}

export async function cronListJobs() {
  const gw = await ensureGatewayClient()
  const res = await gw.request<{ jobs?: Record<string, unknown>[] }>(
    "cron.list",
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.list failed")
  const jobs = (res.payload?.jobs ?? []).map(normalizeJob)
  return { jobs }
}

export async function cronGetJob(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.get",
    { jobId: input.jobId },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.get failed")
  return { job: normalizeJob(res.payload ?? {}) }
}

export async function cronCreateJob(input: {
  name: string
  schedule: string
  task: string
  params?: unknown
  enabled?: boolean
  metadata?: unknown
}) {
  parseCronSchedule(input.schedule)
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.add",
    {
      name: input.name,
      schedule: input.schedule,
      task: input.task,
      params: input.params ?? null,
      enabled: input.enabled ?? true,
      metadata: input.metadata ?? null,
    },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.add failed")
  return { job: normalizeJob(res.payload ?? {}) }
}

export async function cronUpdateJob(input: {
  jobId: string
  name?: string
  schedule?: string
  task?: string
  params?: unknown
  enabled?: boolean
  metadata?: unknown
}) {
  if (input.schedule) parseCronSchedule(input.schedule)
  const gw = await ensureGatewayClient()
  const params: Record<string, unknown> = { jobId: input.jobId }
  if (input.name !== undefined) params.name = input.name
  if (input.schedule !== undefined) params.schedule = input.schedule
  if (input.task !== undefined) params.task = input.task
  if (input.params !== undefined) params.params = input.params
  if (input.enabled !== undefined) params.enabled = input.enabled
  if (input.metadata !== undefined) params.metadata = input.metadata

  const res = await gw.request<Record<string, unknown>>(
    "cron.update",
    params,
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "cron.update failed")
  }
  return { job: normalizeJob(res.payload ?? {}) }
}

export async function cronDeleteJob(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request("cron.remove", {
    jobId: input.jobId,
  })
  if (!res.ok) {
    throw new Error(res.error?.message ?? "cron.remove failed")
  }
  return { deleted: true, jobId: input.jobId }
}

export async function cronRunJob(input: {
  jobId: string
  params?: unknown
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.run",
    {
      jobId: input.jobId,
      params: input.params ?? null,
    },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.run failed")
  return { run: normalizeRun(res.payload ?? {}) }
}

export async function cronJobStatus(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.get",
    { jobId: input.jobId },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.get failed")
  const job = normalizeJob(res.payload ?? {})
  return {
    jobId: job.jobId,
    enabled: job.enabled,
    paused: job.paused,
    schedule: job.schedule,
  }
}

export async function cronListRuns(input: {
  jobId: string
  limit?: number
  sortDir?: string
  afterTs?: number
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<{ runs?: Record<string, unknown>[] }>(
    "cron.runs",
    {
      jobId: input.jobId,
      limit: input.limit ?? 50,
      sortDir: input.sortDir ?? "desc",
      afterTs: input.afterTs,
    },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.runs failed")
  const runs = (res.payload?.runs ?? []).map(normalizeRun)
  return { runs }
}

export async function cronGetRun(input: {
  jobId: string
  runId: string
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.run.get",
    { jobId: input.jobId, runId: input.runId },
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "cron.run.get failed")
  }
  return { run: normalizeRun(res.payload ?? {}) }
}

export async function cronPauseJob(input: {
  jobId: string
  paused: boolean
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.update",
    { jobId: input.jobId, paused: input.paused },
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "cron.update failed")
  }
  return {
    jobId: input.jobId,
    paused: input.paused,
  }
}

export async function cronPollRunCompletion(input: {
  jobId: string
  afterTs: number
  timeoutMs?: number
  intervalMs?: number
}) {
  const timeout = input.timeoutMs ?? 30_000
  const interval = input.intervalMs ?? 2_000
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const { runs } = await cronListRuns({
      jobId: input.jobId,
      limit: 5,
      sortDir: "desc",
      afterTs: input.afterTs,
    })
    const completed = runs.find(
      (r) => r.status === "completed" || r.status === "failed",
    )
    if (completed) return { run: completed }

    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(
    `Timed out waiting for cron run completion after ${timeout}ms`,
  )
}

export async function cronCreateNotificationJob(input: {
  name: string
  schedule: string
  notificationMessage: string
  sessionKey: string
}) {
  parseCronSchedule(input.schedule)
  return cronCreateJob({
    name: input.name,
    schedule: input.schedule,
    task: "notification",
    params: {
      message: input.notificationMessage,
      sessionKey: input.sessionKey,
    },
    enabled: true,
  })
}
