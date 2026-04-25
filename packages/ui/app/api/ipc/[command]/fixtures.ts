type CronFixtureRun = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  result: unknown
  sessionKey: string | null
  error: string | null
}

type CronFixtureJob = {
  jobId: string
  name: string
  schedule: string
  scheduleType: "at" | "every" | "cron"
  timezone: string | null
  session: string
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
  lastRun: CronFixtureRun | null
}

const now = "2026-04-24T07:00:00.000Z"

const initialRuns: CronFixtureRun[] = [
  {
    runId: "fixture-run-1",
    jobId: "fixture-cron-1",
    status: "failed",
    startedAt: "2026-04-24T06:45:00.000Z",
    finishedAt: "2026-04-24T06:45:09.000Z",
    result: null,
    sessionKey: "fixture-session-cron-1",
    error: "Fixture failure for fast UI smoke testing.",
  },
  {
    runId: "fixture-run-2",
    jobId: "fixture-cron-2",
    status: "completed",
    startedAt: "2026-04-24T06:30:00.000Z",
    finishedAt: "2026-04-24T06:30:04.000Z",
    result: { message: "CRON_OK" },
    sessionKey: "fixture-session-cron-2",
    error: null,
  },
]

const initialJobs: CronFixtureJob[] = [
  {
    jobId: "fixture-cron-1",
    name: "Fixture Daily Review",
    schedule: "0 9 * * *",
    scheduleType: "cron",
    timezone: "Asia/Kolkata",
    session: "isolated",
    task: "",
    message: "Run the daily review and summarize important changes.",
    model: null,
    thinking: null,
    enabled: true,
    paused: false,
    deleteAfterRun: false,
    deliveryMode: "announce",
    deliveryChannel: "telegram",
    deliveryTo: "fixture-channel",
    params: null,
    metadata: null,
    createdAt: "2026-04-24T06:00:00.000Z",
    updatedAt: now,
    lastRun: initialRuns[0],
  },
  {
    jobId: "fixture-cron-2",
    name: "Fixture Health Ping",
    schedule: "15m",
    scheduleType: "every",
    timezone: null,
    session: "fixture-session-cron-2",
    task: "",
    message: "Reply with CRON_OK.",
    model: null,
    thinking: null,
    enabled: false,
    paused: true,
    deleteAfterRun: false,
    deliveryMode: "none",
    deliveryChannel: null,
    deliveryTo: null,
    params: null,
    metadata: null,
    createdAt: "2026-04-24T06:10:00.000Z",
    updatedAt: now,
    lastRun: initialRuns[1],
  },
]

let runs = [...initialRuns]
let jobs = initialJobs.map((job) => ({ ...job }))

function resetFixtures() {
  runs = [...initialRuns]
  jobs = initialJobs.map((job) => ({ ...job }))
}

function replaceJob(job: CronFixtureJob) {
  jobs = jobs.map((item) => item.jobId === job.jobId ? job : item)
}

function stringOrNull(value: unknown, fallback: string | null) {
  if (value === undefined) return fallback
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

function sessionForJob(job: CronFixtureJob) {
  if (job.lastRun?.sessionKey) return job.lastRun.sessionKey
  if (job.session !== "isolated") return job.session
  return `fixture-session-${job.jobId}`
}

function findJobBySession(sessionKey: string | null) {
  if (!sessionKey) return jobs[0]
  return jobs.find((item) => sessionForJob(item) === sessionKey) ?? jobs[0]
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? input as Record<string, unknown>
    : {}
}

function eventForRun(run: CronFixtureRun) {
  const job = jobs.find((item) => item.jobId === run.jobId)
  const running = run.status === "running"
  const failed = run.status === "failed" || run.status === "error"
  return {
    type: running
      ? "cron.run.started"
      : failed
        ? "cron.run.failed"
        : "cron.run.completed",
    jobId: run.jobId,
    runId: run.runId,
    sessionKey: run.sessionKey,
    name: job?.name,
    status: running ? "running" : failed ? "failed" : "completed",
    timestamp: run.finishedAt ?? run.startedAt,
    result: run.result,
    error: run.error,
  }
}

function conversationMessages(job: CronFixtureJob) {
  return [
    {
      id: `fixture-message-user-${job.jobId}`,
      role: "user",
      content: job.message ?? job.task,
      createdAt: job.lastRun?.startedAt ?? now,
    },
    {
      id: `fixture-message-assistant-${job.jobId}`,
      role: "assistant",
      content: "Fixture cron transcript loaded for fast UI smoke.",
      createdAt: job.lastRun?.finishedAt ?? job.lastRun?.startedAt ?? now,
    },
  ]
}

export function cronFixtureResponse(command: string, input: unknown) {
  const body = inputRecord(input)
  const nested = inputRecord(body.input)
  const effective = Object.keys(nested).length > 0 ? nested : body
  const jobId =
    typeof effective.jobId === "string" ? effective.jobId : "fixture-cron-1"
  const job = jobs.find((item) => item.jobId === jobId) ?? jobs[0]

  switch (command) {
    case "middleware_cron_reset_fixtures":
      resetFixtures()
      return { ok: true }
    case "middleware_cron_list_jobs":
      return { jobs }
    case "middleware_cron_recent_activity":
      return { events: runs.map(eventForRun) }
    case "middleware_cron_list_runs":
      return { runs: runs.filter((run) => run.jobId === jobId) }
    case "middleware_cron_run_job":
      {
        const run = {
          runId: `fixture-queued-${Date.now()}`,
          jobId,
          status: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          result: null,
          sessionKey: sessionForJob(job),
          error: null,
        }
        runs = [run, ...runs.filter((item) => item.runId !== run.runId)]
        replaceJob({ ...job, lastRun: run, updatedAt: run.startedAt })
        return {
          queued: true,
          run,
        }
      }
    case "middleware_cron_create_job":
      {
        const createdAt = new Date().toISOString()
        const newJob: CronFixtureJob = {
          jobId: `fixture-cron-${Date.now()}`,
          name: typeof effective.name === "string" ? effective.name : "Fixture Cron Job",
          schedule: typeof effective.schedule === "string" ? effective.schedule : "0 9 * * *",
          scheduleType:
            effective.scheduleType === "at" ||
            effective.scheduleType === "every" ||
            effective.scheduleType === "cron"
              ? effective.scheduleType
              : "cron",
          timezone: stringOrNull(effective.timezone, "Asia/Kolkata"),
          session: typeof effective.session === "string" ? effective.session : "isolated",
          task: typeof effective.task === "string" ? effective.task : "",
          message: stringOrNull(effective.message, null),
          model: stringOrNull(effective.model, null),
          thinking: stringOrNull(effective.thinking, null),
          enabled: typeof effective.enabled === "boolean" ? effective.enabled : true,
          paused: typeof effective.enabled === "boolean" ? !effective.enabled : false,
          deleteAfterRun: Boolean(effective.deleteAfterRun),
          deliveryMode: stringOrNull(effective.deliveryMode, null),
          deliveryChannel: stringOrNull(effective.deliveryChannel, null),
          deliveryTo: stringOrNull(effective.deliveryTo, null),
          params: effective.params ?? null,
          metadata: effective.metadata ?? null,
          createdAt,
          updatedAt: createdAt,
          lastRun: null,
        }
        jobs = [newJob, ...jobs]
        return { job: newJob }
      }
    case "middleware_cron_update_job":
      {
        const nextJob = {
          ...job,
          name: typeof effective.name === "string" ? effective.name : job.name,
          schedule: typeof effective.schedule === "string"
            ? effective.schedule
            : job.schedule,
          scheduleType:
            effective.scheduleType === "at" ||
            effective.scheduleType === "every" ||
            effective.scheduleType === "cron"
              ? effective.scheduleType
              : job.scheduleType,
          timezone: stringOrNull(effective.timezone, job.timezone),
          message: stringOrNull(effective.message, job.message),
          task: typeof effective.task === "string" ? effective.task : job.task,
          model: stringOrNull(effective.model, job.model),
          deliveryMode: stringOrNull(effective.deliveryMode, job.deliveryMode),
          deliveryChannel: stringOrNull(effective.deliveryChannel, job.deliveryChannel),
          deliveryTo: stringOrNull(effective.deliveryTo, job.deliveryTo),
          enabled: typeof effective.enabled === "boolean"
            ? effective.enabled
            : job.enabled,
          paused: typeof effective.enabled === "boolean"
            ? !effective.enabled
            : job.paused,
          updatedAt: new Date().toISOString(),
        }
        replaceJob(nextJob)
        return { job: nextJob }
      }
    case "middleware_cron_pause_job":
      {
        const paused = Boolean(effective.paused)
        replaceJob({
          ...job,
          paused,
          enabled: !paused,
          updatedAt: new Date().toISOString(),
        })
        return { jobId, paused }
      }
    case "middleware_cron_delete_job":
      jobs = jobs.filter((item) => item.jobId !== jobId)
      return { deleted: true, jobId }
    case "middleware_cron_job_conversation":
      return {
        sessionKey: sessionForJob(job),
        lastRun: job.lastRun,
        messages: conversationMessages(job),
      }
    case "middleware_chats_list":
      return { chats: [] }
    case "middleware_chats_create":
      return {
        chat: {
          id: `fixture-chat-${Date.now()}`,
          name: typeof effective.name === "string" ? effective.name : job.name,
          sessionKey:
            typeof effective.sessionKey === "string"
              ? effective.sessionKey
              : job.lastRun?.sessionKey,
        },
      }
    case "middleware_chats_attach_session":
      return {
        ok: true,
        chatId: effective.chatId,
        sessionKey: effective.sessionKey,
      }
    case "middleware_projects_list":
      return { projects: [] }
    case "middleware_topics_list":
      return { topics: [] }
    case "middleware_profiles_list":
      return { profiles: [{ id: "fixture-profile", name: "Fixture" }] }
    case "middleware_pty_spawn":
      return {
        ptyId: `fixture-pty-${Date.now()}`,
        cwd: "E:\\projects\\openclaw-desktop",
      }
    case "middleware_pty_kill":
    case "middleware_pty_write":
    case "middleware_pty_resize":
      return { ok: true }
    case "middleware_chat_history":
      return {
        messages: conversationMessages(
          findJobBySession(
            typeof effective.sessionKey === "string"
              ? effective.sessionKey
              : null,
          ),
        ),
      }
    case "middleware_branch_list":
      return { branches: [] }
    default:
      return null
  }
}
