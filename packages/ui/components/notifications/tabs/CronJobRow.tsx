"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"

type CronJob = {
  jobId: string; name: string; schedule: string
  scheduleType: "at" | "every" | "cron"; timezone: string | null
  session: string; task: string; message: string | null; model: string | null
  enabled: boolean; paused: boolean; deleteAfterRun: boolean
  deliveryMode: string | null; params: unknown
  createdAt: string; updatedAt: string
}

type CronRun = {
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
  const color = status === "completed" ? "bg-chart-1" : status === "failed" ? "bg-red-400" : "bg-muted-foreground/50"
  return <span className={cn("size-1.5 rounded-full", color)} />
}

function formatRunTime(iso: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch { return iso }
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  variant = "default",
}: {
  icon: React.ElementType
  label: string
  disabled?: boolean
  onClick: () => void
  variant?: "default" | "danger"
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1",
        "text-[11px] font-medium transition-colors",
        "cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "danger"
          ? "text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
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
  onTogglePaused,
  onDelete,
  onRun,
  onOpenChat,
  onViewConversation,
}: {
  job: CronJob
  busy: boolean
  onToggleEnabled: () => void
  onTogglePaused: () => void
  onDelete: () => void
  onRun: () => void
  onOpenChat?: () => void
  onViewConversation?: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

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
      className={cn(
        "flex flex-col rounded-2xl",
        "border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl",
        "transition-all duration-200",
        "hover:border-white/[0.15] hover:bg-white/[0.07]",
        !job.enabled && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Icons.Cron size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
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
          </div>
          <div className="flex items-center gap-2 pl-[22px]">
            <span className="text-[11px] font-mono text-muted-foreground">{job.schedule}</span>
            {job.timezone && (
              <span className="text-[10px] text-muted-foreground/50">{job.timezone}</span>
            )}
            <SessionBadge session={job.session} />
            {job.model && (
              <span className="text-[10px] text-muted-foreground/50">{job.model}</span>
            )}
          </div>
          {job.message && (
            <p className="line-clamp-1 pl-[22px] text-[11px] text-muted-foreground/70 italic">
              {job.message}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleEnabled}
          disabled={busy}
          aria-label={job.enabled ? "Disable job" : "Enable job"}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
            "transition-colors duration-200 ease-in-out",
            "disabled:cursor-not-allowed disabled:opacity-50",
            job.enabled ? "bg-chart-1" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm",
              "transition-transform duration-200 ease-in-out",
              job.enabled ? "translate-x-[18px]" : "translate-x-[3px]",
            )}
          />
        </button>
      </div>

      <div className="flex items-center gap-1 border-t border-white/[0.06] px-4 py-1.5">
        <ActionButton icon={Icons.Play} label="Run now" disabled={busy || !job.enabled} onClick={onRun} />
        <ActionButton
          icon={job.paused ? Icons.Play : Icons.Pause}
          label={job.paused ? "Resume" : "Pause"}
          disabled={busy || !job.enabled}
          onClick={onTogglePaused}
        />
        {onViewConversation && (
          <ActionButton icon={Icons.Chat} label="Conversation" onClick={onViewConversation} />
        )}
        {onOpenChat && (
          <ActionButton icon={Icons.Chat} label="Open chat" onClick={onOpenChat} />
        )}
        <ActionButton
          icon={Icons.Automations}
          label={expanded ? "Hide runs" : "Runs"}
          onClick={() => setExpanded((v) => !v)}
        />
        {!confirmDelete ? (
          <ActionButton
            icon={Icons.Close}
            label="Delete"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            variant="danger"
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setConfirmDelete(false); onDelete() }}
              disabled={busy}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                "cursor-pointer transition-colors",
                "bg-red-500/10 text-red-400 hover:bg-red-500/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                "cursor-pointer text-muted-foreground transition-colors",
                "hover:bg-secondary/50",
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
                <div key={run.runId} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    <RunStatusDot status={run.status} />
                    <span className="text-muted-foreground">{formatRunTime(run.startedAt)}</span>
                  </div>
                  <span className={cn("font-medium", run.status === "completed" ? "text-chart-1" : run.status === "failed" ? "text-red-400" : "text-muted-foreground")}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
