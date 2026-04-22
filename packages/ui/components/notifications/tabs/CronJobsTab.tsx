"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { CronJobRow } from "./CronJobRow"
import type { ActiveChat } from "@/types/chat"

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
  params: unknown
  createdAt: string
  updatedAt: string
}

type SelectedJob = {
  jobId: string
  name: string
  session: string
  schedule: string
}

type CronJobsTabProps = {
  onNavigateToChat?: (chat: ActiveChat) => void
  onSelectJob?: (job: SelectedJob | null) => void
}

export function CronJobsTab({ onNavigateToChat, onSelectJob }: CronJobsTabProps) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const fetchJobs = useCallback(async () => {
    try {
      const result = await invoke<{ jobs: CronJob[] }>(
        "middleware_cron_list_jobs",
      )
      setJobs(result.jobs)
    } catch {
      setJobs([])
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
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === job.jobId ? { ...j, enabled: !j.enabled } : j,
        ),
      )
    } catch {
      // silently ignore
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
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === job.jobId ? { ...j, paused: !j.paused } : j,
        ),
      )
    } catch {
      // silently ignore
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

  const deleteJob = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_delete_job", { jobId: job.jobId })
      setJobs((prev) => prev.filter((j) => j.jobId !== job.jobId))
    } catch {
      // silently ignore
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

  const runJob = useCallback(async (job: CronJob) => {
    markBusy(job.jobId)
    try {
      await invoke("middleware_cron_run_job", { jobId: job.jobId })
    } catch {
      // silently ignore
    } finally {
      clearBusy(job.jobId)
    }
  }, [])

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
              onOpenChat={onNavigateToChat ? () => onNavigateToChat({
                id: job.jobId,
                name: job.name,
                sessionKey: job.session,
              }) : undefined}
              onViewConversation={onSelectJob ? () => onSelectJob({
                jobId: job.jobId,
                name: job.name,
                session: job.session,
                schedule: job.schedule,
              }) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

