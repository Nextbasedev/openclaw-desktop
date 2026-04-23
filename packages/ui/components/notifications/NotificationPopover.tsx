"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { invoke } from "@/lib/ipc"
import { openEventStream } from "@/lib/ipc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ActiveChat } from "@/types/chat"

type CronJob = {
  jobId: string
  name: string
  schedule: string
  enabled: boolean
  paused?: boolean
  session?: string
  lastRun?: CronRun | null
}

type CronRun = {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

type CronRunEvent = {
  type: "cron.run.started" | "cron.run.completed" | "cron.run.failed"
  jobId: string
  runId?: string
  name?: string
  status: string
  timestamp: string
  result?: unknown
  error?: string | null
}

type NotificationPopoverProps = {
  onViewAll?: () => void
  onNavigateToChat?: (chat: ActiveChat) => void | boolean | Promise<void | boolean>
}

const spring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.8,
}

const MAX_EVENTS = 3

function requestNotificationPermission() {
  if (typeof window === "undefined") return
  if (!("Notification" in window)) return
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {})
  }
}

function showBrowserNotification(event: CronRunEvent) {
  if (typeof window === "undefined") return
  if (!("Notification" in window)) return
  if (Notification.permission !== "granted") return

  const title = event.name ?? `Cron Job ${event.jobId.slice(0, 8)}`
  const isError = event.type === "cron.run.failed"
  const body = isError
    ? `Failed: ${event.error ?? "Unknown error"}`
    : event.type === "cron.run.completed"
      ? "Completed successfully"
      : "Started running"

  new Notification(title, { body, silent: false })
}

function statusIcon(type: CronRunEvent["type"]) {
  if (type === "cron.run.started") return "running"
  if (type === "cron.run.completed") return "completed"
  return "failed"
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < 5000) return "just now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function formatRunTime(iso?: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso
  }
}

function latestRunStatus(job: CronJob) {
  if (!job.enabled || job.paused) {
    return {
      label: job.paused ? "Paused" : "Off",
      detail: job.lastRun ? `Last run ${job.lastRun.status}` : "Not scheduled",
      className: "bg-secondary text-muted-foreground",
    }
  }
  const run = job.lastRun
  if (!run) {
    return {
      label: "Never run",
      detail: "No run history",
      className: "bg-foreground/5 text-muted-foreground",
    }
  }
  if (run.status === "running") {
    return {
      label: "Running now",
      detail: formatRunTime(run.startedAt),
      className: "bg-chart-2/15 text-chart-2",
    }
  }
  if (run.status === "completed") {
    return {
      label: "Completed",
      detail: formatRunTime(run.finishedAt ?? run.startedAt),
      className: "bg-chart-1/15 text-chart-1",
    }
  }
  if (run.status === "failed" || run.status === "error") {
    return {
      label: "Failed",
      detail: run.error ?? formatRunTime(run.finishedAt ?? run.startedAt),
      className: "bg-red-400/15 text-red-400",
    }
  }
  return {
    label: run.status,
    detail: formatRunTime(run.finishedAt ?? run.startedAt),
    className: "bg-foreground/5 text-muted-foreground",
  }
}

function runTimeMs(run?: CronRun | null): number {
  if (!run) return 0
  const raw = run.finishedAt ?? run.startedAt
  const time = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function sortPopoverJobs(nextJobs: CronJob[]): CronJob[] {
  return [...nextJobs].sort((a, b) => {
    const aRunning = a.lastRun?.status === "running" ? 1 : 0
    const bRunning = b.lastRun?.status === "running" ? 1 : 0
    if (aRunning !== bRunning) return bRunning - aRunning
    return runTimeMs(b.lastRun) - runTimeMs(a.lastRun)
  })
}

function mergeEventList(prev: CronRunEvent[], next: CronRunEvent): CronRunEvent[] {
  const isDone = next.type !== "cron.run.started"
  const deduped = prev.filter((event) => {
    if (next.runId && event.runId === next.runId) return false
    if (!next.runId && event.jobId === next.jobId && event.type === next.type) return false
    if (isDone && event.jobId === next.jobId && event.type === "cron.run.started") return false
    return true
  })
  return [next, ...deduped].slice(0, MAX_EVENTS)
}

export function NotificationPopover({ onViewAll, onNavigateToChat }: NotificationPopoverProps) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<CronRunEvent[]>([])
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [badgeCount, setBadgeCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const jobNamesRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    requestNotificationPermission()
    Promise.all([
      invoke<{ jobs: CronJob[] }>("middleware_cron_list_jobs"),
      invoke<{ events: CronRunEvent[] }>("middleware_cron_recent_activity", { limit: MAX_EVENTS }),
    ])
      .then(([jobsResult, activityResult]) => {
        for (const job of jobsResult.jobs) {
          if (job.name) jobNamesRef.current.set(job.jobId, job.name)
        }
        setEvents(activityResult.events.map((event) => ({
          ...event,
          name: event.name ?? jobNamesRef.current.get(event.jobId),
        })).slice(0, MAX_EVENTS))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const cleanup = openEventStream(
      "/api/stream/cron",
      (evt: MessageEvent) => {
        try {
          const event = JSON.parse(evt.data) as CronRunEvent
          if (!event.name) event.name = jobNamesRef.current.get(event.jobId)
          if (event.name) jobNamesRef.current.set(event.jobId, event.name)
          setEvents((prev) => mergeEventList(prev, event))
          if (
            event.type === "cron.run.completed" ||
            event.type === "cron.run.failed"
          ) {
            setBadgeCount((c) => c + 1)
            showBrowserNotification(event)
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
    if (open) setBadgeCount(0)
  }, [open])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const [jobsResult, activityResult] = await Promise.all([
        invoke<{ jobs: CronJob[] }>("middleware_cron_list_jobs"),
        invoke<{ events: CronRunEvent[] }>("middleware_cron_recent_activity", { limit: MAX_EVENTS }),
      ])
      for (const job of jobsResult.jobs) {
        if (job.name) jobNamesRef.current.set(job.jobId, job.name)
      }
      setJobs(sortPopoverJobs(jobsResult.jobs).slice(0, 3))
      setEvents(activityResult.events.map((event) => ({
        ...event,
        name: event.name ?? jobNamesRef.current.get(event.jobId),
      })).slice(0, MAX_EVENTS))
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    fetchJobs()
    const timer = window.setInterval(fetchJobs, 5_000)
    return () => window.clearInterval(timer)
  }, [open, fetchJobs])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("mousedown", handleClickOutside)
    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [open])

  function handleViewAll() {
    setOpen(false)
    onViewAll?.()
  }

  async function handleNavigateToChat(chat: ActiveChat) {
    if (!onNavigateToChat) return
    setError(null)
    const opened = await onNavigateToChat(chat)
    if (opened === false) {
      setError(
        `No chat transcript is available for ${chat.name}. Open Notifications to view the latest run status.`,
      )
      return
    }
    setOpen(false)
  }

  const hasActivity = events.length > 0
  const hasJobs = jobs.length > 0

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Notifications"
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-md",
          "cursor-pointer transition-colors group/icon",
          open
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icons.Notification size={16} strokeWidth={1.5} className="size-4" />
        {badgeCount > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex items-center justify-center",
              "min-w-[14px] rounded-full bg-destructive px-[3px] py-[1px]",
              "text-[8px] font-bold leading-none text-destructive-foreground",
              "pointer-events-none",
            )}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{
              opacity: { duration: 0.15 },
              scale: spring,
              y: spring,
            }}
            style={{ transformOrigin: "top right" }}
            className={cn(
              "absolute right-0 top-full z-50 mt-1.5 w-80",
              "rounded-xl border border-white/[0.08]",
              "bg-popover/70 backdrop-blur-xl backdrop-saturate-150",
              "shadow-2xl shadow-black/30",
              "overflow-hidden",
            )}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <span className="text-[13px] text-foreground">
                Notifications
              </span>
            </div>

            <div className="px-2 py-2">
              {loading && !hasActivity && !hasJobs && (
                <div className="flex items-center justify-center py-6">
                  <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
                </div>
              )}

              {hasActivity && (
                <>
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Recent Activity
                  </p>
                  {error && (
                    <div className="mb-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-red-400">
                      {error}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {events.map((event, idx) => (
                      <EventRow
                        key={`${event.jobId}-${event.timestamp}-${idx}`}
                        event={event}
                        idx={idx}
                        onClick={() => void (async () => {
                          if (!onNavigateToChat) return
                          await handleNavigateToChat({
                            id: event.jobId,
                            name: event.name ?? event.jobId.slice(0, 8),
                            sessionKey: event.runId,
                            cronJobId: event.jobId,
                          })
                        })()}
                      />
                    ))}
                  </div>
                </>
              )}

              {hasActivity && hasJobs && (
                <div className="my-1.5 border-t border-white/[0.04]" />
              )}

              {hasJobs && (
                <>
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Active Jobs
                  </p>
                  {!hasActivity && error && (
                    <div className="mb-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-red-400">
                      {error}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {jobs.map((job, idx) => (
                      <PopoverJobRow
                        key={job.jobId}
                        job={job}
                        idx={idx}
                        canNavigate={Boolean(onNavigateToChat && job.session)}
                        onClick={() => void (async () => {
                          if (!onNavigateToChat || !job.session) return
                          await handleNavigateToChat({
                            id: job.jobId,
                            name: job.name,
                            sessionKey: job.session,
                            cronJobId: job.jobId,
                          })
                        })()}
                      />
                    ))}
                  </div>
                </>
              )}

              {!loading && !hasActivity && !hasJobs && <EmptyState />}
            </div>

            <div className="border-t border-white/[0.06] px-2 py-1.5">
              <button
                type="button"
                onClick={handleViewAll}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-md py-1.5",
                  "cursor-pointer text-[12px] font-medium text-muted-foreground",
                  "transition-colors hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                View more
                <Icons.Forward size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PopoverJobRow({
  job,
  idx,
  canNavigate,
  onClick,
}: {
  job: CronJob
  idx: number
  canNavigate: boolean
  onClick: () => void
}) {
  const status = latestRunStatus(job)
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: idx * 0.04,
        duration: 0.25,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      data-cron-popover-job-id={job.jobId}
      data-cron-popover-job-name={job.name}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5",
        "transition-colors hover:bg-secondary/50",
        canNavigate && "cursor-pointer",
      )}
    >
      <Icons.Cron
        size={13}
        className="shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-medium text-foreground">
          {job.name}
        </span>
        <span className="truncate text-[10px] text-muted-foreground/60">
          <span className="font-mono">{job.schedule}</span>
          {status.detail ? ` - ${status.detail}` : ""}
        </span>
      </div>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
          status.className,
        )}
      >
        {status.label}
      </span>
    </motion.div>
  )
}

function EventRow({ event, idx, onClick }: { event: CronRunEvent; idx: number; onClick?: () => void }) {
  const status = statusIcon(event.type)
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: idx * 0.04,
        duration: 0.25,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      onClick={onClick}
      data-cron-popover-event-id={event.jobId}
      data-cron-popover-event-name={event.name ?? ""}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5",
        "transition-colors hover:bg-secondary/50",
        onClick && "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "relative flex size-5 shrink-0 items-center justify-center rounded-full",
          status === "running" && "bg-chart-2/15",
          status === "completed" && "bg-chart-1/15",
          status === "failed" && "bg-red-400/15",
        )}
      >
        {status === "running" && (
          <span className="size-2 animate-pulse rounded-full bg-chart-2" />
        )}
        {status === "completed" && (
          <Icons.Check size={10} className="text-chart-1" />
        )}
        {status === "failed" && (
          <Icons.Close size={10} className="text-red-400" />
        )}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[11px] font-medium text-foreground">
          {event.name
            ? `${event.jobId.slice(0, 8)} - ${event.name}`
            : event.jobId.slice(0, 8)}
        </span>
        <span className={cn(
          "text-[10px]",
          status === "running" && "text-chart-2",
          status === "completed" && "text-chart-1",
          status === "failed" && "text-red-400",
        )}>
          {status === "running" ? "Running now..." : status === "completed" ? "Completed" : "Failed"}
        </span>
      </div>
      <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/50">
        {timeAgo(event.timestamp)}
      </span>
    </motion.div>
  )
}

function EmptyState() {
  return (
    <div className="px-2 py-4 text-center">
      <Icons.Notification
        size={28}
        className="mx-auto mb-2 text-muted-foreground/30"
      />
      <p className="text-[12px] text-muted-foreground">
        No activity yet.
      </p>
      <p className="text-[11px] text-muted-foreground/60">
        Cron job runs will appear here.
      </p>
    </div>
  )
}
