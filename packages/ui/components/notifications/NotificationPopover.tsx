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
  session?: string
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
  onNavigateToChat?: (chat: ActiveChat) => void
}

const spring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.8,
}

const MAX_EVENTS = 3
const EVENT_TTL_MS = 10 * 60 * 1000

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

export function NotificationPopover({ onViewAll, onNavigateToChat }: NotificationPopoverProps) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<CronRunEvent[]>([])
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [badgeCount, setBadgeCount] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  useEffect(() => {
    const pruneExpired = (list: CronRunEvent[]) =>
      list.filter((e) => Date.now() - new Date(e.timestamp).getTime() < EVENT_TTL_MS)

    const cleanup = openEventStream(
      "/api/stream/cron",
      (evt: MessageEvent) => {
        try {
          const event = JSON.parse(evt.data) as CronRunEvent
          setEvents((prev) => pruneExpired([event, ...prev]).slice(0, MAX_EVENTS))
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

    const timer = setInterval(() => {
      setEvents((prev) => pruneExpired(prev))
    }, 30_000)

    return () => {
      cleanup()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (open) setBadgeCount(0)
  }, [open])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<{ jobs: CronJob[] }>(
        "middleware_cron_list_jobs",
      )
      setJobs(result.jobs.slice(0, 3))
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchJobs()
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
                  <div className="flex flex-col gap-0.5">
                    {events.map((event, idx) => (
                      <EventRow
                        key={`${event.jobId}-${event.timestamp}-${idx}`}
                        event={event}
                        idx={idx}
                        onClick={() => {
                          if (!onNavigateToChat) return
                          setOpen(false)
                          onNavigateToChat({
                            id: event.jobId,
                            name: event.name ?? event.jobId.slice(0, 8),
                            sessionKey: event.runId,
                          })
                        }}
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
                  <div className="flex flex-col gap-0.5">
                    {jobs.map((job, idx) => (
                      <motion.div
                        key={job.jobId}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: idx * 0.04,
                          duration: 0.25,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        onClick={() => {
                          if (!onNavigateToChat || !job.session) return
                          setOpen(false)
                          onNavigateToChat({
                            id: job.jobId,
                            name: job.name,
                            sessionKey: job.session,
                          })
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5",
                          "transition-colors hover:bg-secondary/50",
                          onNavigateToChat && job.session && "cursor-pointer",
                        )}
                      >
                        <Icons.Cron
                          size={13}
                          className="shrink-0 text-muted-foreground"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[11px] font-medium text-foreground">
                            {job.name}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground/60">
                            {job.schedule}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                            job.enabled
                              ? "bg-chart-1/15 text-chart-1"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {job.enabled ? "On" : "Off"}
                        </span>
                      </motion.div>
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
          {event.name ?? event.jobId.slice(0, 8)}
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
