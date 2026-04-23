"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { CronJobRow } from "./CronJobRow"
import { GlassDialog } from "@/components/ui/GlassDialog"

type CronRun = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

type CronJob = {
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

type SelectedJob = {
  jobId: string
  name: string
  session: string
  schedule: string
}

type CronJobsTabProps = {
  onSelectJob?: (job: SelectedJob | null) => void
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
  prompt: string
}

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
    deliveryMode: job.deliveryMode ?? "announce",
    deliveryChannel: job.deliveryChannel ?? "",
    deliveryTo: job.deliveryTo ?? "",
    prompt: jobPrompt(job),
  }
}

function CronJobEditDialog({
  job,
  saving,
  onClose,
  onSave,
}: {
  job: CronJob | null
  saving: boolean
  onClose: () => void
  onSave: (job: CronJob, draft: CronJobDraft) => void
}) {
  const [draft, setDraft] = useState<CronJobDraft | null>(null)

  useEffect(() => {
    setDraft(job ? draftFromJob(job) : null)
  }, [job])

  const canSave = Boolean(
    job &&
    draft?.name.trim() &&
    draft?.schedule.trim() &&
    draft?.prompt.trim(),
  )

  return (
    <GlassDialog
      open={Boolean(job)}
      onClose={onClose}
      title="Edit Cron Job"
      description={job ? job.name : undefined}
      className="w-[min(680px,calc(100vw-32px))]"
    >
      {job && draft && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((prev) => prev ? { ...prev, name: event.target.value } : prev)}
              className="glass-input"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Timeline</span>
              <select
                value={draft.scheduleType}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, scheduleType: event.target.value as CronJob["scheduleType"] } : prev)}
                className={cn(
                  "h-9 rounded-lg border px-3 text-[13px] text-foreground outline-none",
                  "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
                )}
              >
                <option value="cron">Cron</option>
                <option value="every">Interval</option>
                <option value="at">One-shot</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Schedule</span>
              <input
                value={draft.schedule}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, schedule: event.target.value } : prev)}
                placeholder={draft.scheduleType === "every" ? "30m" : draft.scheduleType === "at" ? "2026-04-23T09:00:00+05:30" : "0 9 * * *"}
                className="glass-input font-mono"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Timezone</span>
            <input
              value={draft.timezone}
              disabled
              placeholder="Asia/Kolkata"
              className="glass-input opacity-60"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Delivery</span>
              <select
                value={draft.deliveryMode}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, deliveryMode: event.target.value } : prev)}
                className={cn(
                  "h-9 rounded-lg border px-3 text-[13px] text-foreground outline-none",
                  "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
                )}
              >
                <option value="announce">Announce</option>
                <option value="webhook">Webhook</option>
                <option value="none">None</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Channel</span>
              <input
                value={draft.deliveryChannel}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, deliveryChannel: event.target.value } : prev)}
                placeholder="telegram or discord"
                className="glass-input"
                list="cron-delivery-channels"
              />
              <datalist id="cron-delivery-channels">
                <option value="telegram" />
                <option value="discord" />
              </datalist>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Target</span>
              <input
                value={draft.deliveryTo}
                onChange={(event) => setDraft((prev) => prev ? { ...prev, deliveryTo: event.target.value } : prev)}
                placeholder="optional target"
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
                "min-h-[220px] resize-y rounded-lg border px-3 py-2",
                "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
                "text-[13px] leading-relaxed text-foreground outline-none",
                "placeholder:text-muted-foreground/40 focus:border-foreground/15",
              )}
            />
          </label>

          <div className="mt-2 flex gap-2.5">
            <button
              type="button"
              onClick={() => onSave(job, draft)}
              disabled={!canSave || saving}
              className="glass-btn-primary flex-1"
            >
              {saving ? "Saving..." : "Save changes"}
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

export function CronJobsTab({ onSelectJob, onDraftPrompt }: CronJobsTabProps) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<CronJob | null>(null)

  const fetchJobs = useCallback(async () => {
    setError(null)
    try {
      const result = await invoke<{ jobs: CronJob[] }>(
        "middleware_cron_list_jobs",
      )
      setJobs(result.jobs)
    } catch (err) {
      setJobs([])
      setError(err instanceof Error ? err.message : "Failed to load cron jobs.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  const markBusy = (id: string) =>
    setBusyIds((prev) => new Set(prev).add(id))

  const clearBusy = (id: string) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const toggleEnabled = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_update_job", {
        jobId: job.jobId,
        enabled: !job.enabled,
      })
      setError(null)
      setNotice(null)
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === job.jobId
            ? { ...j, enabled: !j.enabled, paused: job.enabled }
            : j,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cron job.")
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

  const togglePaused = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_pause_job", {
        jobId: job.jobId,
        paused: !job.paused,
      })
      setError(null)
      setNotice(null)
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === job.jobId
            ? { ...j, paused: !j.paused, enabled: job.paused }
            : j,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause cron job.")
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

  const deleteJob = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_delete_job", { jobId: job.jobId })
      setError(null)
      setNotice(null)
      setJobs((prev) => prev.filter((j) => j.jobId !== job.jobId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete cron job.")
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

  const runJob = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_run_job", { jobId: job.jobId })
      setError(null)
      setNotice(`Run queued for ${job.name}.`)
      await fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run cron job.")
    } finally {
      clearBusy(job.jobId)
    }
  }, [fetchJobs])

  const saveJob = useCallback(async (job: CronJob, draft: CronJobDraft) => {
    markBusy(job.jobId)
    try {
      const promptPatch = job.message !== null
        ? { message: draft.prompt.trim() }
        : { task: draft.prompt.trim() }
      const scheduleChanged =
        draft.schedule.trim() !== job.schedule ||
        draft.scheduleType !== job.scheduleType
      const schedulePatch = scheduleChanged
        ? {
            scheduleType: draft.scheduleType,
            schedule: draft.schedule.trim(),
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
      await invoke("middleware_cron_update_job", {
        jobId: job.jobId,
        name: draft.name.trim(),
        ...schedulePatch,
        ...deliveryPatch,
        ...promptPatch,
      })
      setError(null)
      setNotice(`Updated ${draft.name.trim()}.`)
      setEditTarget(null)
      await fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cron job.")
    } finally {
      clearBusy(job.jobId)
    }
  }, [fetchJobs])

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
        <button
          type="button"
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

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-chart-1/20 bg-chart-1/5 px-4 py-3 text-[12px] text-chart-1">
          {notice}
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
              onTogglePaused={() => togglePaused(job)}
              onDelete={() => deleteJob(job)}
              onRun={() => runJob(job)}
              onViewConversation={onSelectJob ? () => onSelectJob({
                jobId: job.jobId,
                name: job.name,
                session: job.session,
                schedule: job.schedule,
              }) : undefined}
              onDiagnoseFailure={onDraftPrompt ? () => onDraftPrompt(buildDiagnosisPrompt(job)) : undefined}
              onEdit={() => setEditTarget(job)}
            />
          ))}
        </div>
      )}

      <CronJobEditDialog
        job={editTarget}
        saving={editTarget ? busyIds.has(editTarget.jobId) : false}
        onClose={() => setEditTarget(null)}
        onSave={saveJob}
      />
    </div>
  )
}

