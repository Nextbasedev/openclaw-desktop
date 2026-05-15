"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { invoke, openEventStream } from "@/lib/ipc"
import { Icons } from "@/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { notify, ensureNotificationPermission } from "@/lib/notifications"
import { cn } from "@/lib/utils"
import type { ActiveChat } from "@/types/chat"
import {
  applyCronEventToJobs,
  formatCronRunTime,
  getCronStatusMeta,
  mergeCronRunEvents,
  sortCronJobsByStatus,
  type CronJobLike,
  type CronRunEventLike,
  type CronRunLike,
} from "./cron-status"

type CronJob = CronJobLike<CronRun> & {
  jobId: string
  name: string
  schedule: string
  enabled: boolean
  paused?: boolean
  session?: string
}

type CronRun = CronRunLike & {
  runId: string
  jobId: string
  status: string
  startedAt: string
  finishedAt: string | null
  sessionKey: string | null
  error: string | null
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
  deliveryMode?: string | null
  deliveryChannel?: string | null
  deliveryTo?: string | null
  parentSessionKey?: string | null
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
const POPOVER_FETCH_TIMEOUT_MS = 4_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Request timed out."))
    }, timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function showCronNotification(event: CronRunEvent) {
  if (typeof window === "undefined") return

  const title = event.name ?? `Cron Job ${event.jobId.slice(0, 8)}`
  const isError = event.type === "cron.run.failed"
  const body = isError
    ? `Failed: ${event.error ?? "Unknown error"}`
    : event.type === "cron.run.completed"
      ? "Completed successfully"
      : "Started running"

  void notify({ title, body })
}

function statusIcon(type: CronRunEvent["type"]) {
  if (type === "cron.run.started") return "running"
  if (type === "cron.run.completed") return "completed"
  return "failed"
}

function cronNavigationPayload(event: CronRunEvent): ActiveChat {
  return {
    id: event.jobId,
    name: event.name ?? event.jobId.slice(0, 8),
    sessionKey: event.sessionKey ?? event.parentSessionKey ?? undefined,
    cronJobId: event.jobId,
    cronRunId: event.runId,
  }
}

function deliveryLabel(event: CronRunEvent): string | null {
  if (event.parentSessionKey) return "App Chat"
  if (event.deliveryChannel === "telegram") return "Telegram"
  if (event.deliveryChannel === "discord") return "Discord"
  if (event.deliveryChannel === "slack") return "Slack"
  if (event.deliveryChannel === "webhook") return "Webhook"
  if (event.deliveryMode === "announce") return "Announce"
  if (event.deliveryMode === "webhook") return "Webhook"
  if (event.deliveryMode === "none") return "OpenClaw Only"
  return null
}

function resolveEventName(
  event: CronRunEvent,
  jobNames: Map<string, string>,
): string | undefined {
  return event.name?.trim() || jobNames.get(event.jobId)
}

function eventFromRunningJob(job: CronJob): CronRunEvent | null {
  const status = getCronStatusMeta(job, { variant: "popover" })
  if (status.phase !== "running" || !status.run) return null
  return {
    type: "cron.run.started",
    jobId: job.jobId,
    runId: status.run.runId,
    sessionKey: status.run.sessionKey,
    name: job.name,
    status: "running",
    timestamp: status.run.startedAt,
  }
}

function reconcileActivityWithJobs(
  jobs: CronJob[],
  events: CronRunEvent[],
): CronRunEvent[] {
  const runningEvents = jobs
    .map(eventFromRunningJob)
    .filter((event): event is CronRunEvent => Boolean(event))
  if (runningEvents.length === 0) return events.slice(0, MAX_EVENTS)

  const runningJobIds = new Set(runningEvents.map((event) => event.jobId))
  const nonRunningEvents = events.filter(
    (event) => !runningJobIds.has(event.jobId),
  )
  return [...runningEvents, ...nonRunningEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_EVENTS)
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < 5000) return "just now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
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
  const openRef = useRef(false)
  const fetchJobsRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    void ensureNotificationPermission()
  }, [])

  useEffect(() => {
    const cleanup = openEventStream(
      "/api/stream/cron",
      (evt: MessageEvent) => {
        try {
          const event = JSON.parse(evt.data) as CronRunEvent
          event.name = resolveEventName(event, jobNamesRef.current)
          if (event.name) jobNamesRef.current.set(event.jobId, event.name)
          setEvents((prev) => mergeCronRunEvents(prev, event, MAX_EVENTS))
          setJobs((prev) => sortCronJobsByStatus(applyCronEventToJobs(prev, event)).slice(0, 3))
          if (openRef.current) void fetchJobsRef.current()
          if (
            event.type === "cron.run.completed" ||
            event.type === "cron.run.failed"
          ) {
            setBadgeCount((c) => c + 1)
            showCronNotification(event)
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
      setError(null)
      const jobsPromise = withTimeout(
        invoke<{ jobs: CronJob[] }>("middleware_cron_list_jobs"),
        POPOVER_FETCH_TIMEOUT_MS,
      )
      const activityPromise = withTimeout(
        invoke<{ events: CronRunEvent[] }>("middleware_cron_recent_activity", { limit: MAX_EVENTS }),
        POPOVER_FETCH_TIMEOUT_MS,
      )

      const activityResult = await activityPromise
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason }))
      if (activityResult.status === "fulfilled") {
        setEvents(activityResult.value.events.map((event) => ({
          ...event,
          name: resolveEventName(event, jobNamesRef.current),
        })))
      }

      const jobsResult = await jobsPromise
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason }))

      const jobs = jobsResult.status === "fulfilled" ? jobsResult.value.jobs : []
      const events = activityResult.status === "fulfilled" ? activityResult.value.events : []
      const latestEvents = new Map<string, CronRunEvent>()

      for (const job of jobs) {
        if (job.name) jobNamesRef.current.set(job.jobId, job.name)
      }
      const hydratedEvents = reconcileActivityWithJobs(jobs, events.map((event) => ({
        ...event,
        name: resolveEventName(event, jobNamesRef.current),
      })))
      for (const event of hydratedEvents) {
        latestEvents.set(event.jobId, event)
      }
      setJobs(sortCronJobsByStatus(jobs, latestEvents).slice(0, 3))
      setEvents(hydratedEvents)
      if (jobsResult.status === "rejected" && activityResult.status === "rejected") {
        setError("Failed to load notifications.")
      } else if (jobsResult.status === "rejected") {
        setError("Failed to load active jobs.")
      } else if (activityResult.status === "rejected") {
        setError("Failed to load recent activity.")
      }
    } catch {
      setJobs([])
      setEvents([])
      setError("Failed to load notifications.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobsRef.current = fetchJobs
  }, [fetchJobs])

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
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-testid="notifications-trigger"
            aria-label="Notifications"
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
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          showArrow={false}
          className={cn(
            GLASS_POPOVER,
            "max-w-[420px] whitespace-normal break-words border-transparent bg-[var(--glass-bg)] px-3 py-1.5 text-[12px] font-medium text-foreground",
            "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_10px_30px_rgba(0,0,0,0.32)]",
          )}
        >
          <span className="block whitespace-normal break-words">
            Notifications
          </span>
        </TooltipContent>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            data-testid="notifications-popover"
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
                          await handleNavigateToChat(cronNavigationPayload(event))
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
                data-testid="notifications-view-more"
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
  const status = getCronStatusMeta(job, { variant: "popover" })
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
      data-testid={`cron-popover-job-${job.jobId}`}
      data-cron-popover-job-name={job.name}
      data-cron-popover-job-status={status.phase}
      data-cron-popover-run-id={status.run?.runId ?? ""}
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
  const delivery = deliveryLabel(event)
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
      data-testid={`cron-popover-event-${event.jobId}`}
      data-cron-popover-event-name={event.name ?? ""}
      data-cron-popover-event-status={status}
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
        <div className="flex items-center gap-1">
          <span className={cn(
            "text-[10px]",
            status === "running" && "text-chart-2",
            status === "completed" && "text-chart-1",
            status === "failed" && "text-red-400",
          )}>
            {status === "running" ? "Running now..." : status === "completed" ? "Completed" : "Failed"}
          </span>
          {delivery && (
            <span className="rounded-full bg-foreground/[0.06] px-1 py-px text-[8px] font-medium text-muted-foreground/60">
              {delivery}
            </span>
          )}
        </div>
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
