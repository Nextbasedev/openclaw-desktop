import { ensureGatewayClient } from "../gateway/client.js"

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
    timezone: scheduleObj.timezone ? String(scheduleObj.timezone) : raw.timezone ? String(raw.timezone) : null,
    session: String(raw.sessionTarget ?? payload.session ?? params.session ?? "isolated"),
    task: String(payload.task ?? raw.task ?? ""),
    message: payload.message ? String(payload.message) : params.message ? String(params.message) : null,
    model: payload.model ? String(payload.model) : null,
    thinking: payload.thinking ? String(payload.thinking) : null,
    enabled: Boolean(raw.enabled ?? true),
    paused: Boolean(raw.paused ?? false),
    deleteAfterRun: Boolean(raw.deleteAfterRun ?? false),
    deliveryMode: delivery.mode ? String(delivery.mode) : null,
    deliveryChannel: delivery.channel ? String(delivery.channel) : null,
    deliveryTo: delivery.to ? String(delivery.to) : null,
    params: raw.params ?? null,
    metadata: raw.metadata ?? null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? ""),
  }
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

function normalizeRun(raw: Record<string, unknown>): CronRun {
  return {
    runId: String(raw.runId ?? raw.id ?? ""),
    jobId: String(raw.jobId ?? ""),
    status: String(raw.status ?? "unknown"),
    startedAt: String(raw.startedAt ?? ""),
    finishedAt: raw.finishedAt ? String(raw.finishedAt) : null,
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
    "cron.status",
    { jobId: input.jobId },
  )
  if (!res.ok) throw new Error(res.error?.message ?? "cron.status failed")
  return { job: normalizeJob(res.payload ?? {}) }
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
  if (input.metadata) gwParams.metadata = input.metadata

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
  const res = await gw.request<Record<string, unknown>>("cron.update", { id: input.jobId, patch })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.update failed")
  return { job: normalizeJob(res.payload ?? {}) }
}

export async function cronDeleteJob(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request("cron.remove", { id: input.jobId })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.remove failed")
  return { deleted: true, jobId: input.jobId }
}

export async function cronRunJob(input: {
  jobId: string
  params?: unknown
}) {
  const gw = await ensureGatewayClient()
  const gwParams: Record<string, unknown> = { jobId: input.jobId }
  if (input.params) gwParams.params = input.params
  const res = await gw.request<Record<string, unknown>>("cron.run", gwParams)
  if (!res.ok) throw new Error(res.error?.message ?? "cron.run failed")
  return { run: normalizeRun(res.payload ?? {}) }
}

export async function cronJobStatus(input: { jobId: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>("cron.status", {
    jobId: input.jobId,
  })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.status failed")
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
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>("cron.update", {
    id: input.jobId,
    patch: { enabled: !input.paused },
  })
  if (!res.ok) throw new Error(res.error?.message ?? "cron.update failed")
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
  let sessionKey: string | null = null
  for (const run of runs) {
    if (run.sessionKey) { sessionKey = run.sessionKey; break }
  }
  if (!sessionKey) {
    const { job } = await cronGetJob({ jobId: input.jobId })
    if (job.session && !SESSION_TARGET_KEYWORDS.has(job.session)) {
      sessionKey = job.session
    }
  }
  if (!sessionKey) return { messages: [], sessionKey: null }
  const { getChatHistory } = await import("middleware")
  const history = await getChatHistory(sessionKey)
  return { messages: history.messages ?? [], sessionKey }
}
