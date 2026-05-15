"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { invoke, openEventStream } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { CronJobRow } from "./CronJobRow"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { useModels, type ModelEntry } from "@/hooks/useModels"
import { CronOptionSelect, type CronOption } from "../CronOptionSelect"
import { CronScheduleEditor } from "../CronScheduleEditor"
import {
  applyCronEventToJobs,
  type CronJobLike,
  type CronRunEventLike,
  type CronRunLike,
} from "../cron-status"

type CronRun = CronRunLike & {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

type CronJob = CronJobLike<CronRun> & {
  jobId: string
  name: string
  schedule: string
  scheduleType: "at" | "every" | "cron"
  timezone: string | null
  session: string
  task: string
  message: string | null
  model: string | null
  enabled: boolean
  paused: boolean
  deleteAfterRun: boolean
  deliveryMode: string | null
  deliveryChannel?: string | null
  deliveryTo?: string | null
  params: unknown
  createdAt: string
  updatedAt: string
  lastRun: CronRun | null
}

type CronRunEvent = CronRunEventLike & {
  type: "cron.run.started" | "cron.run.completed" | "cron.run.failed"
  jobId: string
  runId?: string
  sessionKey?: string | null
  name?: string
  status: string
  timestamp: string
  result?: unknown
  error?: string | null
  parentSessionKey?: string | null
}

type CronJobsTabProps = {
  activeSessionKey?: string | null
  onDraftPrompt?: (prompt: string) => void
}

type CronJobDraft = {
  name: string
  scheduleType: CronJob["scheduleType"]
  schedule: string
  timezone: string
  deliveryMode: string
  deliveryChannel: string
  deliveryTo: string
  model: string
  prompt: string
}

type CronDialogMode = "create" | "edit"

const deliveryOptions: CronOption[] = [
  { value: "announce", label: "Announce", detail: "Post the result to a chat/channel" },
  { value: "webhook", label: "Webhook", detail: "Send the result to an endpoint" },
  { value: "none", label: "None", detail: "Keep the result in OpenClaw only" },
]

const deliveryChannelOptions: CronOption[] = [
  { value: "", label: "Choose when needed", detail: "No external channel" },
  { value: "telegram", label: "Telegram", detail: "Send to a Telegram chat" },
  { value: "discord", label: "Discord", detail: "Send to a Discord channel" },
  { value: "slack", label: "Slack", detail: "Send to a Slack channel" },
  { value: "webhook", label: "Webhook", detail: "Use the destination URL" },
]

const timezoneOptions: CronOption[] = [
  { value: "Asia/Kolkata", label: "India time", detail: "Asia/Kolkata" },
  { value: "UTC", label: "UTC", detail: "Coordinated Universal Time" },
  { value: "America/New_York", label: "New York", detail: "America/New_York" },
  { value: "Europe/London", label: "London", detail: "Europe/London" },
  { value: "Asia/Tokyo", label: "Tokyo", detail: "Asia/Tokyo" },
]

function formatValue(value: unknown): string {
  if (value == null || value === "") return "not set"
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildDiagnosisPrompt(job: CronJob): string {
  const lastRun = job.lastRun
  const task = job.message ?? job.task
  return [
    "Diagnose and help me fix this failed cron job.",
    "",
    "Cron job:",
    `- Name: ${job.name}`,
    `- ID: ${job.jobId}`,
    `- Schedule: ${job.schedule}`,
    `- Schedule type: ${job.scheduleType}`,
    `- Timezone: ${job.timezone ?? "not set"}`,
    `- Session: ${job.session}`,
    `- Model: ${job.model ?? "not set"}`,
    `- Enabled: ${job.enabled ? "yes" : "no"}`,
    `- Paused: ${job.paused ? "yes" : "no"}`,
    `- Delete after run: ${job.deleteAfterRun ? "yes" : "no"}`,
    `- Delivery mode: ${job.deliveryMode ?? "not set"}`,
    `- Delivery channel: ${job.deliveryChannel ?? "not set"}`,
    `- Delivery target: ${job.deliveryTo ?? "not set"}`,
    "",
    "Latest run:",
    `- Status: ${lastRun?.status ?? "not run"}`,
    `- Run ID: ${lastRun?.runId ?? "not set"}`,
    `- Started: ${lastRun?.startedAt ?? "not set"}`,
    `- Finished: ${lastRun?.finishedAt ?? "not set"}`,
    `- Error: ${lastRun?.error ?? "not set"}`,
    "",
    "Task/message:",
    task || "not set",
    "",
    "Params:",
    formatValue(job.params),
    "",
    "Please explain the likely cause, suggest the safest fix, and tell me exactly what to change before I rerun it.",
  ].join("\n")
}

function jobPrompt(job: CronJob): string {
  return job.message ?? job.task ?? ""
}

function draftFromJob(job: CronJob): CronJobDraft {
  return {
    name: job.name,
    scheduleType: job.scheduleType,
    schedule: job.schedule,
    timezone: job.timezone ?? "",
    deliveryMode: job.deliveryMode ?? "none",
    deliveryChannel: job.deliveryChannel ?? "",
    deliveryTo: job.deliveryTo ?? "",
    model: job.model ?? "",
    prompt: jobPrompt(job),
  }
}

function blankCronDraft(): CronJobDraft {
  return {
    name: "",
    scheduleType: "cron",
    schedule: "0 9 * * *",
    timezone: "Asia/Kolkata",
    deliveryMode: "none",
    deliveryChannel: "",
    deliveryTo: "",
    model: "",
    prompt: "",
  }
}

function modelOptionValue(model: ModelEntry): string {
  return `${model.provider}/${model.id}`
}

function modelMatchesValue(value: string, model: ModelEntry): boolean {
  return (
    value === model.id ||
    value === modelOptionValue(model) ||
    value.split("/").at(-1) === model.id
  )
}

function buildModelOptions(
  models: ModelEntry[],
  selectedModel: string,
): CronOption[] {
  const options: CronOption[] = [
    {
      value: "",
      label: "Default model",
      detail: "Use the current OpenClaw default",
    },
  ]

  for (const model of models) {
    options.push({
      value: modelOptionValue(model),
      label: model.name,
      detail: `${model.provider}${model.reasoning ? " - reasoning" : ""}`,
    })
  }

  if (
    selectedModel &&
    !models.some((model) => modelMatchesValue(selectedModel, model))
  ) {
    options.push({
      value: selectedModel,
      label: selectedModel,
      detail: "Saved on this cron job",
    })
  }

  return options
}

function buildTimezoneOptions(selectedTimezone: string): CronOption[] {
  if (
    selectedTimezone &&
    !timezoneOptions.some((option) => option.value === selectedTimezone)
  ) {
    return [
      ...timezoneOptions,
      {
        value: selectedTimezone,
        label: selectedTimezone,
        detail: "Saved on this cron job",
      },
    ]
  }

  return timezoneOptions
}

function deliveryTargetLabel(deliveryMode: string): string {
  if (deliveryMode === "webhook") return "Webhook URL"
  if (deliveryMode === "none") return "Destination"
  return "Chat or channel"
}

function deliveryTargetPlaceholder(deliveryMode: string): string {
  if (deliveryMode === "webhook") return "https://example.com/webhook"
  if (deliveryMode === "none") return "No delivery target needed"
  return "telegram:-5110909291"
}

function cronDraftErrors(draft: CronJobDraft): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push("Add a name so this job is easy to recognize.")
  if (!draft.schedule.trim()) errors.push("Choose when this job should run.")
  if (!draft.prompt.trim()) errors.push("Add the task OpenClaw should run.")
  if (draft.deliveryMode !== "none" && !draft.deliveryTo.trim()) {
    errors.push("Add a delivery destination, or choose None to keep the result in OpenClaw.")
  }
  return errors
}

function isCronJobMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return normalized.includes("job") && normalized.includes("not found")
}

function normalizeCronJobsResponse(result: unknown): CronJob[] {
  if (!result || typeof result !== "object") return []
  const jobs = (result as { jobs?: unknown }).jobs
  return Array.isArray(jobs) ? jobs as CronJob[] : []
}

function CronJobEditDialog({
  mode,
  job,
  draftSeed,
  saving,
  onClose,
  onSave,
}: {
  mode: CronDialogMode
  job: CronJob | null
  draftSeed?: CronJobDraft | null
  saving: boolean
  onClose: () => void
  onSave: (job: CronJob | null, draft: CronJobDraft) => void
}) {
  const [draft, setDraft] = useState<CronJobDraft | null>(null)
  const { models, loading: modelsLoading, ensureLoaded } = useModels()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(job ? draftFromJob(job) : draftSeed ?? null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [draftSeed, job])

  useEffect(() => {
    if (job || draftSeed) ensureLoaded()
  }, [draftSeed, ensureLoaded, job])

  const validationErrors = draft ? cronDraftErrors(draft) : []
  const canSave = Boolean(draft && validationErrors.length === 0)
  const modelOptions = buildModelOptions(models, draft?.model ?? "")
  const selectedTimezone = draft?.timezone || "Asia/Kolkata"
  const timezoneSelectOptions = buildTimezoneOptions(selectedTimezone)
  const isCreate = mode === "create"

  return (
    <GlassDialog
      open={Boolean(job || draftSeed)}
      onClose={onClose}
      title={isCreate ? "Review Cron Job" : "Edit Cron Job"}
      description={
        isCreate
          ? "Check the schedule, model, delivery, and prompt before OpenClaw starts running it."
          : job?.name
      }
      className="w-[min(860px,calc(100vw-24px))] !rounded-md border-white/[0.1] bg-[var(--glass-bg)] px-5 py-5 shadow-[0_24px_72px_-32px_rgba(0,0,0,0.88),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[36px] backdrop-saturate-[180%]"
    >
      {draft && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, name: event.target.value } : prev)}
                className="glass-input rounded-md"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Timezone</span>
              <CronOptionSelect
                value={selectedTimezone}
                options={timezoneSelectOptions}
                testId="cron-edit-timezone"
                onChange={(value) => setDraft((prev) => prev ? { ...prev, timezone: value } : prev)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Schedule</span>
            <input
              aria-label="Raw schedule"
              value={draft.schedule}
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        schedule: event.target.value,
                        scheduleType: "cron",
                      }
                    : prev,
                )
              }
              className="sr-only"
              tabIndex={-1}
            />
            <input
              aria-label="Raw timezone"
              value={selectedTimezone}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, timezone: event.target.value } : prev,
                )
              }
              className="sr-only"
              tabIndex={-1}
            />
            <div className="">
              <CronScheduleEditor
                schedule={draft.schedule}
                scheduleType={draft.scheduleType}
                onChange={(next) => setDraft((prev) => prev ? { ...prev, ...next } : prev)}
              />
            </div>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Model</span>
              <CronOptionSelect
                value={draft.model}
                options={modelOptions}
                disabled={modelsLoading && models.length === 0}
                placeholder={modelsLoading ? "Loading models..." : "Default model"}
                testId="cron-edit-model"
                onChange={(value) => setDraft((prev) => prev ? { ...prev, model: value } : prev)}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Delivery method</span>
              <CronOptionSelect
                value={draft.deliveryMode}
                options={deliveryOptions}
                testId="cron-edit-delivery-mode"
                onChange={(value) => setDraft((prev) => {
                  if (!prev) return prev
                  if (value === "none") {
                    return { ...prev, deliveryMode: value, deliveryChannel: "", deliveryTo: "" }
                  }
                  if (value === "webhook") {
                    return { ...prev, deliveryMode: value, deliveryChannel: "webhook" }
                  }
                  return { ...prev, deliveryMode: value }
                })}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Channel type</span>
              <CronOptionSelect
                value={draft.deliveryChannel}
                options={deliveryChannelOptions}
                disabled={draft.deliveryMode === "none"}
                placeholder="Choose channel"
                testId="cron-edit-delivery-channel"
                onChange={(value) => setDraft((prev) => prev ? { ...prev, deliveryChannel: value } : prev)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {deliveryTargetLabel(draft.deliveryMode)}
              </span>
              <input
                value={draft.deliveryTo}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, deliveryTo: event.target.value } : prev)}
                disabled={draft.deliveryMode === "none"}
                placeholder={deliveryTargetPlaceholder(draft.deliveryMode)}
                className="glass-input"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Prompt</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => setDraft((prev) => prev ? { ...prev, prompt: event.target.value } : prev)}
              className={cn(
                "min-h-[96px] max-h-[200px] resize-y rounded-md border px-3 py-2.5",
                "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
                "text-[13px] leading-relaxed text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none",
                "placeholder:text-muted-foreground/40 focus:border-white/15",
              )}
            />
          </label>

          {validationErrors.length > 0 && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
              {validationErrors[0]}
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onSave(job, draft)}
              disabled={!canSave || saving}
              className="glass-btn-primary"
            >
              {saving ? "Saving..." : isCreate ? "Create job" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="glass-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </GlassDialog>
  )
}

export function CronJobsTab({ activeSessionKey, onDraftPrompt }: CronJobsTabProps) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<CronJob | null>(null)
  const [createDraft, setCreateDraft] = useState<CronJobDraft | null>(null)
  const [creatingJob, setCreatingJob] = useState(false)
  const fetchJobsRef = useRef<() => Promise<void>>(async () => {})

  const fetchJobs = useCallback(async () => {
    setError(null)
    try {
      const result = await invoke<unknown>(
        "middleware_cron_list_jobs",
      )
      setJobs(normalizeCronJobsResponse(result))
    } catch (err) {
      setJobs([])
      setError(err instanceof Error ? err.message : "Failed to load cron jobs.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobsRef.current = fetchJobs
  }, [fetchJobs])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    const cleanup = openEventStream(
      "/api/stream/cron",
      (evt: MessageEvent) => {
        try {
          const event = JSON.parse(evt.data) as CronRunEvent
          setJobs((prev) => applyCronEventToJobs(prev, event))
          if (event.type === "cron.run.completed" || event.type === "cron.run.failed") {
            void fetchJobsRef.current()
          }
        } catch {
          // ignore malformed events
        }
      },
    )

    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const markBusy = (id: string) =>
    setBusyIds((prev) => new Set(prev).add(id))

  const clearBusy = (id: string) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const removeStaleJob = useCallback((jobId: string, name?: string) => {
    setJobs((prev) => prev.filter((job) => job.jobId !== jobId))
    setEditTarget((prev) => (prev?.jobId === jobId ? null : prev))
    setNotice(name ? `${name} is no longer available and was removed from the list.` : "This cron job is no longer available and was removed from the list.")
    setError(null)
  }, [])

  const toggleEnabled = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    const nextEnabled = !job.enabled
    setJobs((prev) =>
      prev.map((j) =>
        j.jobId === job.jobId
          ? { ...j, enabled: nextEnabled, paused: !nextEnabled }
          : j,
      ),
    )
    setError(null)
    setNotice(null)
    try {
      await invoke("middleware_cron_update_job", {
        jobId: job.jobId,
        enabled: nextEnabled,
      })
    } catch (err) {
      if (isCronJobMissingError(err)) {
        removeStaleJob(job.jobId, job.name)
        return
      }
      // keep optimistic state — local override on server handles persistence
    } finally {
      clearBusy(job.jobId)
    }
  }, [removeStaleJob])

  const deleteJob = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_delete_job", { jobId: job.jobId })
      setError(null)
      setNotice(null)
      setJobs((prev) => prev.filter((j) => j.jobId !== job.jobId))
    } catch (err) {
      if (isCronJobMissingError(err)) {
        removeStaleJob(job.jobId, job.name)
      } else {
        setError(err instanceof Error ? err.message : "Failed to delete cron job.")
      }
    } finally {
      clearBusy(job.jobId)
    }
  }, [removeStaleJob])

  const saveJob = useCallback(async (job: CronJob | null, draft: CronJobDraft) => {
    if (!job) return
    markBusy(job.jobId)
    try {
      const validationErrors = cronDraftErrors(draft)
      if (validationErrors.length > 0) {
        setError(validationErrors[0])
        return
      }
      const promptPatch = job.message !== null
        ? { message: draft.prompt.trim() }
        : { task: draft.prompt.trim() }
      const timezone = draft.timezone.trim() || "Asia/Kolkata"
      const scheduleChanged =
        draft.schedule.trim() !== job.schedule ||
        draft.scheduleType !== job.scheduleType ||
        timezone !== (job.timezone ?? "")
      const schedulePatch = scheduleChanged
        ? {
            scheduleType: draft.scheduleType,
            schedule: draft.schedule.trim(),
            timezone,
          }
        : {}
      const deliveryChanged =
        draft.deliveryMode !== (job.deliveryMode ?? "announce") ||
        draft.deliveryChannel.trim() !== (job.deliveryChannel ?? "") ||
        draft.deliveryTo.trim() !== (job.deliveryTo ?? "")
      const deliveryPatch = deliveryChanged
        ? {
            deliveryMode: draft.deliveryMode,
            deliveryChannel: draft.deliveryChannel.trim() || undefined,
            deliveryTo: draft.deliveryTo.trim() || undefined,
          }
        : {}
      const modelChanged = draft.model.trim() !== (job.model ?? "")
      const modelPatch = modelChanged
        ? { model: draft.model.trim() }
        : {}
      await invoke("middleware_cron_update_job", {
        jobId: job.jobId,
        name: draft.name.trim(),
        ...schedulePatch,
        ...deliveryPatch,
        ...modelPatch,
        ...promptPatch,
      })
      setError(null)
      setNotice(`Updated ${draft.name.trim()}.`)
      setEditTarget(null)
      await fetchJobs()
    } catch (err) {
      if (isCronJobMissingError(err)) {
        removeStaleJob(job.jobId, job.name)
      } else {
        setError(err instanceof Error ? err.message : "Failed to update cron job.")
      }
    } finally {
      clearBusy(job.jobId)
    }
  }, [fetchJobs, removeStaleJob])

  const createJob = useCallback(async (draft: CronJobDraft) => {
    setCreatingJob(true)
    try {
      const validationErrors = cronDraftErrors(draft)
      if (validationErrors.length > 0) {
        setError(validationErrors[0])
        return
      }
      await invoke("middleware_cron_create_job", {
        name: draft.name.trim(),
        scheduleType: draft.scheduleType,
        schedule: draft.schedule.trim(),
        timezone: draft.timezone.trim() || "Asia/Kolkata",
        session: activeSessionKey || "isolated",
        parentSessionKey: activeSessionKey || undefined,
        message: draft.prompt.trim(),
        model: draft.model.trim() || undefined,
        enabled: true,
        deliveryMode: draft.deliveryMode,
        deliveryChannel: draft.deliveryChannel.trim() || undefined,
        deliveryTo: draft.deliveryTo.trim() || undefined,
      })
      setError(null)
      setNotice(`Created ${draft.name.trim()}.`)
      setCreateDraft(null)
      await fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create cron job.")
    } finally {
      setCreatingJob(false)
    }
  }, [activeSessionKey, fetchJobs])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Cron Jobs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your scheduled tasks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="cron-create-review"
            onClick={() => {
              setError(null)
              setNotice(null)
              setCreateDraft(blankCronDraft())
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-[12px] font-medium text-foreground",
              "cursor-pointer border border-white/10 bg-white/[0.06] transition-colors",
              "hover:bg-white/[0.09]",
            )}
          >
            <Icons.Plus size={14} />
            Create cron
          </button>
          <button
            type="button"
            data-testid="cron-refresh"
            onClick={fetchJobs}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-[12px] font-medium text-muted-foreground",
              "cursor-pointer transition-colors",
              "hover:bg-secondary/50 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Icons.Refresh size={14} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-chart-1/20 bg-chart-1/5 px-4 py-3 text-[12px] text-chart-1">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            type="button"
            aria-label="Close notice"
            onClick={() => setNotice(null)}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-chart-1/70 transition-colors hover:bg-chart-1/10 hover:text-chart-1"
          >
            <Icons.Close size={12} />
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="size-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
            <span className="text-[13px] text-muted-foreground">
              Loading cron jobs...
            </span>
          </div>
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-8 text-center backdrop-blur-xl">
          <Icons.Cron
            size={32}
            className="mx-auto mb-3 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No scheduled jobs yet.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Ask your agent in chat to create a cron job.
          </p>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          {jobs.map((job) => (
            <CronJobRow
              key={job.jobId}
              job={job}
              busy={busyIds.has(job.jobId)}
              onToggleEnabled={() => toggleEnabled(job)}
              onDelete={() => deleteJob(job)}
              onDiagnoseFailure={onDraftPrompt ? () => onDraftPrompt(buildDiagnosisPrompt(job)) : undefined}
              onEdit={() => setEditTarget(job)}
            />
          ))}
        </div>
      )}

      <CronJobEditDialog
        mode="edit"
        job={editTarget}
        saving={editTarget ? busyIds.has(editTarget.jobId) : false}
        onClose={() => setEditTarget(null)}
        onSave={saveJob}
      />

      <CronJobEditDialog
        mode="create"
        job={null}
        draftSeed={createDraft}
        saving={creatingJob}
        onClose={() => setCreateDraft(null)}
        onSave={(_, draft) => createJob(draft)}
      />
    </div>
  )
}

