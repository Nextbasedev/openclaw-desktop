"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"

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

export function CronJobsTab() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const fetchJobs = useCallback(async () => {
    try {
      setError(null)
      const result = await invoke<{ jobs: CronJob[] }>(
        "middleware_cron_list_jobs",
      )
      setJobs(result.jobs)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load cron jobs",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  const toggleEnabled = useCallback(
    async (job: CronJob) => {
      setTogglingIds((prev) => new Set(prev).add(job.jobId))
      try {
        await invoke("middleware_cron_update_job", {
          jobId: job.jobId,
          enabled: !job.enabled,
        })
        setJobs((prev) =>
          prev.map((j) =>
            j.jobId === job.jobId ? { ...j, enabled: !j.enabled } : j,
          ),
        )
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update job",
        )
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev)
          next.delete(job.jobId)
          return next
        })
      }
    },
    [],
  )

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

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
          <Icons.Cron
            size={32}
            className="mx-auto mb-3 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No cron jobs configured yet.
          </p>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          {jobs.map((job) => (
            <CronJobRow
              key={job.jobId}
              job={job}
              toggling={togglingIds.has(job.jobId)}
              onToggle={() => toggleEnabled(job)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CronJobRow({
  job,
  toggling,
  onToggle,
}: {
  job: CronJob
  toggling: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl",
        "border border-border/50 bg-card px-4 py-3",
        "transition-colors",
        !job.enabled && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Icons.Cron size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">
            {job.name}
          </span>
          {job.paused && (
            <span className="rounded-full bg-chart-4/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-chart-4">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 pl-[22px]">
          <span className="text-[11px] font-mono text-muted-foreground">
            {job.schedule}
          </span>
          <span className="text-[11px] text-muted-foreground/60">
            {job.task}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={toggling}
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
  )
}
