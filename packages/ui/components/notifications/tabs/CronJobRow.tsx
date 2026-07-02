"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import {
  formatCronRunTime,
  getCronStatusMeta,
  type CronJobLike,
  type CronRunLike,
} from "../cron-status"
import { formatScheduleLabel } from "../cron-schedule-format"

type CronJob = CronJobLike<CronRun> & {
  jobId: string; name: string; schedule: string
  scheduleType: "at" | "every" | "cron"; timezone: string | null
  session: string; task: string; message: string | null; model: string | null
  enabled: boolean; paused: boolean; deleteAfterRun: boolean
  deliveryMode: string | null; params: unknown
  createdAt: string; updatedAt: string
  lastRun: CronRun | null
}

type CronRun = CronRunLike & {
  runId: string; jobId: string; status: string
  startedAt: string; finishedAt: string | null; error: string | null
}

function ScheduleBadge({ type }: { type: string }) {
  const label = type === "at" ? "One-shot" : type === "every" ? "Interval" : "Cron"
  const color = type === "at"
    ? "bg-chart-4/15 text-chart-4"
    : type === "every"
      ? "bg-chart-2/15 text-chart-2"
      : "bg-chart-1/15 text-chart-1"

  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase", color)}>
      {label}
    </span>
  )
}

function SessionBadge({ session }: { session: string }) {
  return (
    <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
      {session}
    </span>
  )
}

function RunStatusDot({ status }: { status: string }) {
  const color = status === "completed"
    ? "bg-chart-1"
    : status === "failed" || status === "error"
      ? "bg-red-400"
      : status === "running"
        ? "bg-chart-2"
        : "bg-muted-foreground/50"
  return <span className={cn("size-1.5 rounded-full", color)} />
}

function LastRunBadge({ job }: { job: CronJob }) {
  const status = getCronStatusMeta(job, { variant: "card" })
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase", status.className)}>
        {status.label}
      </span>
      {status.detail && (
        <span className="truncate text-[10px] text-muted-foreground/50">
          {status.detail}
        </span>
      )}
    </div>
  )
}

function isFailedRun(run: CronRun | null): run is CronRun {
  return Boolean(run && (run.status === "failed" || run.status === "error"))
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  testId,
  variant = "default",
}: {
  icon: React.ElementType
  label: string
  disabled?: boolean
  onClick: () => void
  testId?: string
  variant?: "default" | "danger"
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      data-action-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 max-sm:flex-1 max-sm:justify-center max-sm:px-2",
        "text-[11px] font-medium transition-colors",
        "cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "danger"
          ? "border-red-500/15 bg-red-500/[0.03] text-red-400/80 hover:bg-red-500/10 hover:text-red-300"
          : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-foreground",
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

export function CronJobRow({
  job,
  busy,
  onToggleEnabled,
  onDelete,
  onDiagnoseFailure,
  onEdit,
  onRunNow,
}: {
  job: CronJob
  busy: boolean
  onToggleEnabled: () => void
  onDelete: () => void
  onDiagnoseFailure?: () => void
  onEdit?: () => void
  onRunNow?: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const status = getCronStatusMeta(job, { variant: "card" })
  const failedLastRun = isFailedRun(status.run) ? status.run : null
  const scheduleLabel = formatScheduleLabel(job)

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true)
    try {
      const result = await invoke<{ runs: CronRun[] }>(
        "middleware_cron_list_runs",
        { jobId: job.jobId, limit: 5 },
      )
      setRuns(result.runs)
    } catch {
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [job.jobId])

  useEffect(() => {
    if (expanded) fetchRuns()
  }, [expanded, fetchRuns])

  return (
    <div
      data-cron-job-id={job.jobId}
      data-testid={`cron-job-${job.jobId}`}
      data-cron-job-name={job.name}
      data-cron-job-status={status.phase}
      data-cron-run-id={status.run?.runId ?? ""}
      className={cn(
        "flex flex-col rounded-md",
        "border border-white/[0.08] bg-[var(--glass-bg)] shadow-[0_24px_64px_-40px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[32px] backdrop-saturate-[180%]",
        "transition-all duration-200",
        "hover:border-white/[0.14] hover:bg-white/[0.06]",
        !job.enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4 px-4 py-3 max-sm:gap-2 max-sm:px-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Icons.Cron size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 max-w-full truncate text-[13px] font-medium text-foreground max-sm:basis-[calc(100%-28px)]">
              {job.name}
            </span>
            <ScheduleBadge type={job.scheduleType} />
            {job.paused && (
              <span className="rounded-full bg-chart-4/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-chart-4">
                Paused
              </span>
            )}
            {job.deleteAfterRun && (
              <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                One-time
              </span>
            )}
            <LastRunBadge job={job} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-[22px] max-sm:pl-0">
            <span
              className="text-[11px] font-medium text-muted-foreground"
              title={job.schedule}
            >
              {scheduleLabel}
            </span>
            {job.timezone && (
              <span className="text-[10px] text-muted-foreground/50">{job.timezone}</span>
            )}
            <SessionBadge session={job.session} />
            {job.model && (
              <span className="text-[10px] text-muted-foreground/50">{job.model}</span>
            )}
          </div>
          {job.message && (
            <p className="line-clamp-2 pl-[22px] text-[11px] text-muted-foreground/70 italic max-sm:pl-0">
              {job.message}
            </p>
          )}
          {failedLastRun?.error && (
            <div
              data-cron-failure-detail={job.jobId}
              className="ml-[22px] mt-1 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2 max-sm:ml-0"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-red-400" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-red-400">
                  Failure detail
                </span>
              </div>
              <p className="line-clamp-2 text-[11px] leading-relaxed text-red-400/80">
                {failedLastRun.error}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          data-action-label={job.enabled ? "Disable job" : "Enable job"}
          onClick={onToggleEnabled}
          disabled={busy}
          aria-label={job.enabled ? "Disable job" : "Enable job"}
          className={cn(
            "relative mt-0.5 inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
            "transition-colors duration-200 ease-in-out",
            "disabled:cursor-not-allowed disabled:opacity-50",
            job.enabled ? "bg-emerald-400/90" : "bg-white/[0.06]",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm",
              "transition-transform duration-200 ease-in-out",
              job.enabled ? "translate-x-[16px]" : "translate-x-0",
            )}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-2 max-sm:px-3">
        {failedLastRun && onDiagnoseFailure && (
          <ActionButton
            icon={Icons.Wrench}
            label="Diagnose"
            onClick={onDiagnoseFailure}
            testId={`cron-job-diagnose-${job.jobId}`}
          />
        )}
        {onEdit && (
          <ActionButton
            icon={Icons.Edit}
            label="Edit"
            onClick={onEdit}
            testId={`cron-job-edit-${job.jobId}`}
          />
        )}
        {onRunNow && (
          <ActionButton
            icon={Icons.Play}
            label="Run now"
            disabled={busy || !job.enabled}
            onClick={onRunNow}
            testId={`cron-job-run-now-${job.jobId}`}
          />
        )}
        <ActionButton
          icon={Icons.Automations}
          label={expanded ? "Hide runs" : "Runs"}
          onClick={() => setExpanded((v) => !v)}
          testId={`cron-job-runs-${job.jobId}`}
        />
        {!confirmDelete ? (
          <ActionButton
            icon={Icons.Trash}
            label="Delete"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            testId={`cron-job-delete-${job.jobId}`}
            variant="danger"
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid={`cron-job-confirm-delete-${job.jobId}`}
              data-action-label="Confirm"
              onClick={() => { setConfirmDelete(false); onDelete() }}
              disabled={busy}
              className={cn(
                "rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium",
                "cursor-pointer transition-colors",
                "text-red-400 hover:bg-red-500/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              Confirm
            </button>
            <button
              type="button"
              data-testid={`cron-job-cancel-delete-${job.jobId}`}
              data-action-label="Cancel"
              onClick={() => setConfirmDelete(false)}
              className={cn(
                "rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium",
                "cursor-pointer text-muted-foreground transition-colors",
                "hover:bg-white/[0.07]",
              )}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-2">
          {runsLoading && (
            <div className="flex items-center justify-center py-3">
              <div className="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
            </div>
          )}
          {!runsLoading && runs.length === 0 && (
            <p className="py-2 text-center text-[11px] text-muted-foreground/60">No runs yet.</p>
          )}
          {!runsLoading && runs.length > 0 && (
            <div className="flex flex-col gap-1">
              {runs.map((run) => (
                <div
                  key={run.runId}
                  data-testid={`cron-run-${job.jobId}-${run.runId || "latest"}`}
                  className="flex flex-col gap-1 rounded-md px-2 py-1.5 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <RunStatusDot status={run.status} />
                      <span className="text-muted-foreground">{formatCronRunTime(run.startedAt)}</span>
                    </div>
                    <span className={cn(
                      "font-medium",
                      run.status === "completed" && "text-chart-1",
                      run.status === "failed" || run.status === "error" ? "text-red-400" : "",
                      run.status === "running" && "text-chart-2",
                      !["completed", "failed", "error", "running"].includes(run.status) && "text-muted-foreground",
                    )}>
                      {run.status}
                    </span>
                  </div>
                  {run.error && (
                    <p className="pl-3.5 text-[10px] leading-relaxed text-red-400/75">
                      {run.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
