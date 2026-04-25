import { ensureGatewayClient } from "../gateway/client.js"
import { cronEvents } from "./cron-events.service.js"

export function parseSchedule(schedule: string, type?: string) {
  const trimmed = schedule.trim()
  if (!trimmed) throw new Error("Schedule cannot be empty")

  if (type === "at" || type === "every") return trimmed

  const parts = trimmed.split(/\s+/)
  if (parts.length < 5 || parts.length > 6) {
    throw new Error(
      `Invalid cron expression: expected 5-6 fields, got ${parts.length}`,
    )
  }
  return trimmed
}

export type CronScheduleType = "at" | "every" | "cron"
export type CronSessionTarget = "main" | "isolated" | "current" | string

export type CronJob = {
  jobId: string
  name: string
  schedule: string
  scheduleType: CronScheduleType
  timezone: string | null
  session: CronSessionTarget
  task: string
  message: string | null
  model: string | null
  thinking: string | null
  enabled: boolean
  paused: boolean
  deleteAfterRun: boolean
  deliveryMode: string | null
  deliveryChannel: string | null
  deliveryTo: string | null
  params: unknown
  metadata: unknown
  createdAt: string
  updatedAt: string
  lastRun: CronRun | null
}

export type CronRun = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  result: unknown
  sessionKey: string | null
  error: string | null
}

export type CronActivityEvent = {
  type: "cron.run.started" | "cron.run.completed" | "cron.run.failed"
  jobId: string
  runId?: string
  sessionKey?: string | null
  name?: string
  status: string
  timestamp: string
  result?: unknown
  error?: string | null
}

const activeRuns = new Map<string, CronRun>()
const localJobOverrides = new Map<string, Partial<CronJob>>()
const lastRunCache = new Map<string, { run: CronRun | null; cachedAt: number }>()
const LAST_RUN_CACHE_TTL_MS = 30_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cron request timed out")), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function pruneActiveRuns() {
  const staleBefore = Date.now() - 2 * 60 * 60 * 1000
  for (const [jobId, run] of activeRuns) {
    const startedAt = new Date(run.startedAt).getTime()
    if (!Number.isFinite(startedAt) || startedAt < staleBefore) {
      activeRuns.delete(jobId)
    }
  }
}

function emitCronActivity(event: CronActivityEvent) {
  cronEvents.emit("cron:event", event)
}

cronEvents.on("cron:event", (event: CronActivityEvent) => {
  if (event.type === "cron.run.started") {
    activeRuns.set(event.jobId, {
      runId: event.runId ?? `event:${event.jobId}:${Date.now()}`,
      jobId: event.jobId,
      status: "running",
      startedAt: event.timestamp,
      finishedAt: null,
      result: null,
      sessionKey: null,
      error: null,
    })
    return
  }
  activeRuns.delete(event.jobId)
})

function normalizeJob(raw: Record<string, unknown>): CronJob {
  const params = (raw.params ?? {}) as Record<string, unknown>
  const payload = (raw.payload ?? {}) as Record<string, unknown>
  const delivery = (raw.delivery ?? {}) as Record<string, unknown>

  const scheduleRaw = raw.schedule
  const scheduleObj = (typeof scheduleRaw === "object" && scheduleRaw !== null
    ? scheduleRaw : {}) as Record<string, unknown>
  const scheduleStr = typeof scheduleRaw === "string" ? scheduleRaw : ""

  const kind = String(scheduleObj.kind ?? "")
  let scheduleDisplay = scheduleStr
  if (kind === "every" && scheduleObj.everyMs) {
    scheduleDisplay = formatMs(Number(scheduleObj.everyMs))
  } else if (kind === "at" && scheduleObj.at) {
    scheduleDisplay = String(scheduleObj.at)
  } else if (kind === "cron" && scheduleObj.expr) {
    scheduleDisplay = String(scheduleObj.expr)
  }

  const scheduleType: CronScheduleType = kind === "at" || kind === "every" || kind === "cron"
    ? kind : inferScheduleType(scheduleDisplay)

  return {
    jobId: String(raw.jobId ?? raw.id ?? ""),
    name: String(raw.name ?? ""),
    schedule: scheduleDisplay,
    scheduleType,
    timezone: scheduleObj.timezone ? String(scheduleObj.timezone) : scheduleObj.tz ? String(scheduleObj.tz) : raw.timezone ? String(raw.timezone) : null,
    session: String(raw.sessionTarget ?? payload.session ?? params.session ?? "isolated"),
    task: String(payload.task ?? raw.task ?? ""),
    message: payload.message ? String(payload.message) : params.message ? String(params.message) : null,
    model: payload.model ? String(payload.model) : null,
    thinking: payload.thinking ? String(payload.thinking) : null,
    enabled: Boolean(raw.enabled ?? true),
    paused: Boolean(raw.paused ?? raw.enabled === false),
    deleteAfterRun: Boolean(raw.deleteAfterRun ?? false),
    deliveryMode: delivery.mode ? String(delivery.mode) : null,
    deliveryChannel: delivery.channel ? String(delivery.channel) : null,
    deliveryTo: delivery.to ? String(delivery.to) : null,
    params: raw.params ?? null,
    metadata: raw.metadata ?? null,
    createdAt: msToIso(raw.createdAt ?? raw.createdAtMs),
    updatedAt: msToIso(raw.updatedAt ?? raw.updatedAtMs ?? raw.createdAt ?? raw.createdAtMs),
    lastRun: null,
  }
}

function applyLocalJobOverride(job: CronJob): CronJob {
  const override = localJobOverrides.get(job.jobId)
  return override ? { ...job, ...override } : job
}

function localOverrideFromUpdate(input: {
  name?: string
  schedule?: string
  scheduleType?: CronScheduleType
  timezone?: string
  session?: CronSessionTarget
  message?: string
  model?: string
  thinking?: string
  task?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  deliveryMode?: string
  deliveryChannel?: string
  deliveryTo?: string
}): Partial<CronJob> {
  const override: Partial<CronJob> = { updatedAt: new Date().toISOString() }
  if (input.name !== undefined) override.name = input.name
  if (input.schedule !== undefined) override.schedule = input.schedule
  if (input.scheduleType !== undefined) override.scheduleType = input.scheduleType
  if (input.timezone !== undefined) override.timezone = input.timezone
  if (input.session !== undefined) override.session = input.session
  if (input.message !== undefined) override.message = input.message
  if (input.model !== undefined) override.model = input.model || null
  if (input.thinking !== undefined) override.thinking = input.thinking || null
  if (input.task !== undefined) override.task = input.task
  if (input.enabled !== undefined) {
    override.enabled = input.enabled
    override.paused = !input.enabled
  }
  if (input.deleteAfterRun !== undefined) override.deleteAfterRun = input.deleteAfterRun
  if (input.deliveryMode !== undefined) override.deliveryMode = input.deliveryMode
  if (input.deliveryChannel !== undefined) override.deliveryChannel = input.deliveryChannel
  if (input.deliveryTo !== undefined) override.deliveryTo = input.deliveryTo
  return override
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${ms / 1000}s`
  if (ms < 3_600_000) return `${ms / 60_000}m`
  if (ms < 86_400_000) return `${ms / 3_600_000}h`
  return `${ms / 86_400_000}d`
}

function inferScheduleType(schedule: string): CronScheduleType {
  if (!schedule) return "cron"
  if (/^\d{4}-\d{2}/.test(schedule) || /^\d+[smhd]$/.test(schedule)) {
    return /^\d+[smhd]$/.test(schedule) ? "every" : "at"
  }
  return "cron"
}

function extractSessionKey(raw: Record<string, unknown>): string | null {
  if (typeof raw.sessionKey === "string") return raw.sessionKey
  const result = raw.result as Record<string, unknown> | null | undefined
  if (result && typeof result.sessionKey === "string") return result.sessionKey
  if (result && typeof result.session === "string") return result.session
  return null
}

function msToIso(val: unknown): string {
  if (typeof val === "number" && val > 0) return new Date(val).toISOString()
  if (typeof val === "string" && val) return val
  return ""
}

function normalizeRun(raw: Record<string, unknown>): CronRun {
  const rawStatus = String(raw.status ?? "unknown")
  const status = rawStatus === "ok"
    ? "completed"
    : rawStatus === "started" || rawStatus === "active"
      ? "running"
      : rawStatus
  return {
    runId: String(raw.runId ?? raw.id ?? raw.sessionId ?? ""),
    jobId: String(raw.jobId ?? ""),
    status,
    startedAt: msToIso(raw.startedAt ?? raw.runAtMs ?? raw.ts),
    finishedAt: raw.finishedAt ? String(raw.finishedAt) : raw.durationMs && raw.runAtMs
      ? new Date(Number(raw.runAtMs) + Number(raw.durationMs)).toISOString() : null,
    result: raw.result ?? null,
    sessionKey: extractSessionKey(raw),
    error: raw.error ? String(raw.error) : null,
  }
}

export type CreateCronJobInput = {
  name: string
  schedule: string
  scheduleType?: CronScheduleType
  timezone?: string
  session?: CronSessionTarget
  message?: string
  model?: string
  thinking?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  wake?: "now" | "next-heartbeat"
  lightContext?: boolean
  tools?: string[]
  systemEvent?: string
  agentId?: string
  deliveryMode?: "announce" | "webhook" | "none"
  deliveryChannel?: string
  deliveryTo?: string
  task?: string
  params?: unknown
  metadata?: unknown
}

export async function cronListJobs() {
  pruneActiveRuns()
  const gw = await ensureGatewayClient()
  const res = await gw.request<{ jobs?: Record<string, unknown>[] }>(
    "cron.list",
    { includeDisabled: true },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.list failed")
  const jobs = (res.payload?.jobs ?? []).map(normalizeJob).map(applyLocalJobOverride)
  await Promise.all(jobs.map(async (job) => {
    if (!job.jobId) return
    const cached = lastRunCache.get(job.jobId)
    if (cached && Date.now() - cached.cachedAt < LAST_RUN_CACHE_TTL_MS) {
      job.lastRun = cached.run
    }
    try {
      const { runs } = await withTimeout(
        cronListRuns({ jobId: job.jobId, limit: 1, sortDir: "desc" }),
        2_500,
      )
      job.lastRun = runs[0] ?? null
      lastRunCache.set(job.jobId, { run: job.lastRun, cachedAt: Date.now() })
    } catch {
      if (!cached) job.lastRun = null
    }
    const activeRun = activeRuns.get(job.jobId)
    if (activeRun) job.lastRun = activeRun
  }))
  return { jobs }
}

function cronRunToActivityEvent(job: CronJob, run: CronRun): CronActivityEvent | null {
  const timestamp = run.finishedAt ?? run.startedAt ?? job.updatedAt ?? job.createdAt
  if (!timestamp) return null
  const isRunning = run.status === "running"
  const isFailed = run.status === "failed" || run.status === "error" || Boolean(run.error)
  return {
    type: isRunning ? "cron.run.started" : isFailed ? "cron.run.failed" : "cron.run.completed",
    jobId: job.jobId,
    runId: run.runId || undefined,
    sessionKey: run.sessionKey,
    name: job.name || undefined,
    status: isRunning ? "running" : isFailed ? "failed" : "completed",
    timestamp,
    result: run.result ?? null,
    error: run.error,
  }
}

export async function cronRecentActivity(input?: { limit?: number }) {
  const limit = Math.min(Math.max(Number(input?.limit ?? 25), 1), 100)
  const { jobs } = await cronListJobs()
  const events = jobs
    .map((job) => job.lastRun ? cronRunToActivityEvent(job, job.lastRun) : null)
    .filter((event): event is CronActivityEvent => Boolean(event))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)

  return { events }
}

export async function cronGetJob(input: { jobId: string }) {
  const { jobs } = await cronListJobs()
  const job = jobs.find((j) => j.jobId === input.jobId)
  if (!job) throw new Error(`Job ${input.jobId} not found`)
  return { job }
}

function buildScheduleParam(schedule: string, type: CronScheduleType, timezone?: string): Record<string, unknown> {
  const obj: Record<string, unknown> = { kind: type }
  if (type === "at") {
    obj.at = schedule
  } else if (type === "every") {
    obj.everyMs = parseIntervalToMs(schedule)
  } else {
    obj.expr = schedule
  }
  if (timezone) obj.timezone = timezone
  return obj
}

function parseIntervalToMs(interval: string): number {
  const match = interval.match(/^(\d+)\s*(ms|s|m|h|d)$/i)
  if (!match) return parseInt(interval, 10) || 60_000
  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * (multipliers[unit] ?? 1000)
}

export async function cronCreateJob(input: CreateCronJobInput) {
  const type = input.scheduleType ?? "cron"
  parseSchedule(input.schedule, type)

  const payload: Record<string, unknown> = {}
  if (input.message) payload.message = input.message
  if (input.model) payload.model = input.model
  if (input.thinking) payload.thinking = input.thinking
  if (input.lightContext) payload.lightContext = true
  if (input.tools) payload.tools = input.tools
  if (input.agentId) payload.agentId = input.agentId
  if (input.systemEvent) payload.systemEvent = input.systemEvent
  if (input.wake) payload.wake = input.wake
  if (input.task) payload.task = input.task

  const gwParams: Record<string, unknown> = {
    name: input.name,
    schedule: buildScheduleParam(input.schedule, type, input.timezone),
    sessionTarget: input.session ?? "isolated",
    payload,
    enabled: input.enabled ?? true,
  }

  if (input.deleteAfterRun) gwParams.deleteAfterRun = true
  if (input.params) gwParams.params = input.params
  // The current gateway rejects metadata on cron.add. Keep metadata in the
  // public UI input type, but do not forward it until the protocol accepts it.

  if (input.deliveryMode && input.deliveryMode !== "none") {
    gwParams.delivery = {
      mode: input.deliveryMode,
      ...(input.deliveryChannel && { channel: input.deliveryChannel }),
      ...(input.deliveryTo && { to: input.deliveryTo }),
    }
  }

  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>("cron.add", gwParams)
  if (!res.ok) throw new Error(res.error?.message ?? "cron.add failed")
  return { job: normalizeJob(res.payload ?? {}) }
}

export async function cronUpdateJob(input: {
  jobId: string
  name?: string
  schedule?: string
  scheduleType?: CronScheduleType
  timezone?: string
  session?: CronSessionTarget
  message?: string
  model?: string
  thinking?: string
  task?: string
  params?: unknown
  enabled?: boolean
  metadata?: unknown
  deleteAfterRun?: boolean
  deliveryMode?: string
  deliveryChannel?: string
  deliveryTo?: string
}) {
  if (input.schedule) parseSchedule(input.schedule, input.scheduleType)

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.params !== undefined) patch.params = input.params
  if (input.metadata !== undefined) patch.metadata = input.metadata
  if (input.deleteAfterRun !== undefined) patch.deleteAfterRun = input.deleteAfterRun

  if (input.schedule !== undefined) {
    const type = input.scheduleType ?? "cron"
    patch.schedule = buildScheduleParam(input.schedule, type, input.timezone)
  }

  if (input.session !== undefined) patch.sessionTarget = input.session

  const hasPayloadChanges = input.message !== undefined || input.model !== undefined ||
    input.thinking !== undefined || input.task !== undefined
  if (hasPayloadChanges) {
    const payload: Record<string, unknown> = {}
    if (input.message !== undefined) payload.message = input.message
    if (input.model !== undefined) payload.model = input.model
    if (input.thinking !== undefined) payload.thinking = input.thinking
    if (input.task !== undefined) payload.task = input.task
    patch.payload = payload
  }

  if (input.deliveryMode !== undefined) {
    patch.delivery = {
      mode: input.deliveryMode,
      ...(input.deliveryChannel !== undefined && { channel: input.deliveryChannel }),
      ...(input.deliveryTo !== undefined && { to: input.deliveryTo }),
    }
  }

  const gw = await ensureGatewayClient()
  let res = await gw.request<Record<string, unknown>>("cron.update", {
    id: input.jobId,
    patch,
  })
  const errors: string[] = []
  if (!res.ok) errors.push(res.error?.message ?? "cron.update id+patch failed")

  if (!res.ok) {
    const legacyPatch: Record<string, unknown> = { ...patch }
    if (input.schedule !== undefined) legacyPatch.schedule = input.schedule
    if (input.scheduleType !== undefined) legacyPatch.scheduleType = input.scheduleType
    if (input.timezone !== undefined) legacyPatch.timezone = input.timezone
    if (input.message !== undefined) legacyPatch.message = input.message
    if (input.model !== undefined) legacyPatch.model = input.model
    if (input.thinking !== undefined) legacyPatch.thinking = input.thinking
    if (input.task !== undefined) legacyPatch.task = input.task
    delete legacyPatch.payload

    res = await gw.request<Record<string, unknown>>("cron.update", {
      id: input.jobId,
      patch: legacyPatch,
    })
    if (!res.ok) errors.push(res.error?.message ?? "cron.update id+legacyPatch failed")
  }

  if (!res.ok) {
    res = await gw.request<Record<string, unknown>>("cron.update", {
      jobId: input.jobId,
      patch,
    })
    if (!res.ok) errors.push(res.error?.message ?? "cron.update jobId+patch failed")
  }

  if (!res.ok) {
    const legacyPatch: Record<string, unknown> = { ...patch }
    if (input.schedule !== undefined) legacyPatch.schedule = input.schedule
    if (input.scheduleType !== undefined) legacyPatch.scheduleType = input.scheduleType
    if (input.timezone !== undefined) legacyPatch.timezone = input.timezone
    if (input.message !== undefined) legacyPatch.message = input.message
    if (input.model !== undefined) legacyPatch.model = input.model
    if (input.thinking !== undefined) legacyPatch.thinking = input.thinking
    if (input.task !== undefined) legacyPatch.task = input.task
    delete legacyPatch.payload

    res = await gw.request<Record<string, unknown>>("cron.update", {
      jobId: input.jobId,
      patch: legacyPatch,
    })
    if (!res.ok) errors.push(res.error?.message ?? "cron.update jobId+legacyPatch failed")
  }

  if (!res.ok) {
    const legacyPatch: Record<string, unknown> = { ...patch }
    if (input.schedule !== undefined) legacyPatch.schedule = input.schedule
    if (input.scheduleType !== undefined) legacyPatch.scheduleType = input.scheduleType
    if (input.timezone !== undefined) legacyPatch.timezone = input.timezone
    if (input.message !== undefined) legacyPatch.message = input.message
    if (input.model !== undefined) legacyPatch.model = input.model
    if (input.thinking !== undefined) legacyPatch.thinking = input.thinking
    if (input.task !== undefined) legacyPatch.task = input.task
    delete legacyPatch.payload

    res = await gw.request<Record<string, unknown>>("cron.update", {
      jobId: input.jobId,
      ...legacyPatch,
    })
    if (!res.ok) errors.push(res.error?.message ?? "cron.update legacy root failed")
  }

  if (!res.ok) {
    const localOverride = localOverrideFromUpdate(input)
    const previousOverride = localJobOverrides.get(input.jobId) ?? {}
    localJobOverrides.set(input.jobId, { ...previousOverride, ...localOverride })
    const { jobs } = await cronListJobs()
    const localJob = jobs.find((job) => job.jobId === input.jobId)
    if (localJob) return { job: localJob }
    throw new Error(errors[0] ?? res.error?.message ?? "cron.update failed")
  }
  const payload = (res.payload?.job ?? res.payload ?? {}) as Record<string, unknown>
  const returnedJob = normalizeJob(payload)
  const localOverride = localOverrideFromUpdate(input)
  const previousOverride = localJobOverrides.get(input.jobId) ?? {}
  localJobOverrides.set(input.jobId, { ...previousOverride, ...localOverride })
  if (lastRunCache.has(input.jobId)) {
    const cached = lastRunCache.get(input.jobId)
    lastRunCache.set(input.jobId, {
      run: cached?.run ?? returnedJob.lastRun ?? null,
      cachedAt: Date.now(),
    })
  }
  return {
    job: applyLocalJobOverride({
      ...returnedJob,
      jobId: returnedJob.jobId || input.jobId,
    }),
  }
}

export async function cronDeleteJob(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request("cron.remove", { id: input.jobId })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.remove failed")
  localJobOverrides.delete(input.jobId)
  lastRunCache.delete(input.jobId)
  activeRuns.delete(input.jobId)
  return { deleted: true, jobId: input.jobId }
}

export async function cronRunJob(input: {
  jobId: string
  params?: unknown
}) {
  const gw = await ensureGatewayClient()
  const { job } = await cronGetJob({ jobId: input.jobId })
  const startedAt = new Date().toISOString()
  const syntheticRun: CronRun = {
    runId: `queued:${input.jobId}:${Date.now()}`,
    jobId: input.jobId,
    status: "running",
    startedAt,
    finishedAt: null,
    result: null,
    sessionKey: null,
    error: null,
  }
  activeRuns.set(input.jobId, syntheticRun)
  emitCronActivity({
    type: "cron.run.started",
    jobId: input.jobId,
    runId: syntheticRun.runId,
    name: job.name || undefined,
    status: "running",
    timestamp: startedAt,
  })

  const gwParams: Record<string, unknown> = { jobId: input.jobId }
  if (input.params) gwParams.params = input.params
  void gw.request<Record<string, unknown>>("cron.run", gwParams)
    .then((res) => {
      if (!res.ok) {
        const error = res.error?.message ?? "cron.run failed"
        const finishedAt = new Date().toISOString()
        activeRuns.delete(input.jobId)
        emitCronActivity({
          type: "cron.run.failed",
          jobId: input.jobId,
          runId: syntheticRun.runId,
          name: job.name || undefined,
          status: "failed",
          timestamp: finishedAt,
          error,
        })
        return
      }

      const run = normalizeRun(res.payload ?? {})
      if (!run.finishedAt && (run.status === "unknown" || run.status === "running")) {
        return
      }
      const finishedAt = run.finishedAt ?? new Date().toISOString()
      activeRuns.delete(input.jobId)
      const failed = run.status === "failed" || run.status === "error" || Boolean(run.error)
      emitCronActivity({
        type: failed ? "cron.run.failed" : "cron.run.completed",
        jobId: input.jobId,
        runId: run.runId || syntheticRun.runId,
        sessionKey: run.sessionKey,
        name: job.name || undefined,
        status: failed ? "failed" : "completed",
        timestamp: finishedAt,
        result: run.result,
        error: run.error,
      })
    })
    .catch((err) => {
      const finishedAt = new Date().toISOString()
      activeRuns.delete(input.jobId)
      emitCronActivity({
        type: "cron.run.failed",
        jobId: input.jobId,
        runId: syntheticRun.runId,
        name: job.name || undefined,
        status: "failed",
        timestamp: finishedAt,
        error: err instanceof Error ? err.message : "cron.run failed",
      })
    })

  return { run: syntheticRun, queued: true }
}

export async function cronJobStatus(input: { jobId: string }) {
  const { job } = await cronGetJob(input)
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
  pruneActiveRuns()
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "cron.runs",
    {
      id: input.jobId,
      limit: input.limit ?? 50,
      sortDir: input.sortDir ?? "desc",
      afterTs: input.afterTs,
    },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.runs failed")
  const payload = res.payload as Record<string, unknown>
  const rawRuns = (payload?.runs ?? payload?.entries ?? []) as Record<string, unknown>[]
  const runs = rawRuns.map(normalizeRun)
  const activeRun = activeRuns.get(input.jobId)
  const hasNewerTerminalRun = activeRun
    ? runs.some((run) => {
        const terminal = run.status === "completed" || run.status === "failed" || run.status === "error"
        const runStartedAt = new Date(run.startedAt).getTime()
        const activeStartedAt = new Date(activeRun.startedAt).getTime()
        return terminal && Number.isFinite(runStartedAt) && Number.isFinite(activeStartedAt) && runStartedAt >= activeStartedAt - 1_000
      })
    : false
  if (activeRun && hasNewerTerminalRun) {
    activeRuns.delete(input.jobId)
  } else if (activeRun && !runs.some((run) => run.runId === activeRun.runId)) {
    runs.unshift(activeRun)
  }
  return { runs }
}

export async function cronGetRun(input: {
  jobId: string
  runId: string
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>("cron.run.get", {
    jobId: input.jobId,
    runId: input.runId,
  })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.run.get failed")
  return { run: normalizeRun(res.payload ?? {}) }
}

export async function cronPauseJob(input: {
  jobId: string
  paused: boolean
}) {
  await cronUpdateJob({ jobId: input.jobId, enabled: !input.paused })
  return { jobId: input.jobId, paused: input.paused }
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
      (r) => r.status === "completed" || r.status === "failed" || r.status === "error",
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
  return cronCreateJob({
    name: input.name,
    schedule: input.schedule,
    session: "main",
    systemEvent: input.notificationMessage,
    wake: "now",
    deleteAfterRun: false,
    enabled: true,
  })
}

const SESSION_TARGET_KEYWORDS = new Set(["isolated", "main", "current"])

export async function cronJobConversation(input: { jobId: string }) {
  const { runs } = await cronListRuns({ jobId: input.jobId, limit: 10, sortDir: "desc" })
  const latestRun = runs[0] ?? null
  let sessionKey: string | null = null
  for (const run of runs) {
    if (run.sessionKey) { sessionKey = run.sessionKey; break }
  }
  if (!sessionKey) {
    try {
      const { job } = await cronGetJob({ jobId: input.jobId })
      if (job.session && !SESSION_TARGET_KEYWORDS.has(job.session)) {
        sessionKey = job.session
      }
    } catch {}
  }
  const lastRun = latestRun ? {
    status: latestRun.status,
    error: latestRun.error,
    startedAt: latestRun.startedAt,
    finishedAt: latestRun.finishedAt,
  } : null
  if (!sessionKey) return { messages: [], sessionKey: null, lastRun }
  const { getChatHistory } = await import("middleware")
  const history = await getChatHistory(sessionKey)
  return { messages: history.messages ?? [], sessionKey, lastRun }
}
