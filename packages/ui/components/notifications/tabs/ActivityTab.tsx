"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { invoke, openEventStream } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"

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

const MAX_EVENTS = 50

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return timestamp
  }
}

function statusLabel(type: CronRunEvent["type"]): string {
  if (type === "cron.run.started") return "Running"
  if (type === "cron.run.completed") return "Completed"
  return "Failed"
}

function eventLabel(event: CronRunEvent): string {
  const id = event.jobId.slice(0, 8)
  return event.name ? `${id} - ${event.name}` : id
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

export function ActivityTab() {
  const [events, setEvents] = useState<CronRunEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const jobNamesRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false

    async function hydrateActivity() {
      setLoading(true)
      try {
        const activityResult = await invoke<{ events: CronRunEvent[] }>(
          "middleware_cron_recent_activity",
          { limit: MAX_EVENTS },
        )
        if (cancelled) return
        for (const event of activityResult.events) {
          if (event.name) jobNamesRef.current.set(event.jobId, event.name)
        }
        setEvents(activityResult.events.map((event) => ({
          ...event,
          name: event.name ?? jobNamesRef.current.get(event.jobId),
        })))
      } catch {
        if (!cancelled) setEvents([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void hydrateActivity()

    const cleanup = openEventStream(
      "/api/stream/cron",
      (evt: MessageEvent) => {
        try {
          const event = JSON.parse(evt.data) as CronRunEvent
          if (!event.name) event.name = jobNamesRef.current.get(event.jobId)
          if (event.name) jobNamesRef.current.set(event.jobId, event.name)
          setEvents((prev) => mergeEventList(prev, event))
        } catch {
          // ignore
        }
      },
    )
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Activity
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live cron job run notifications and results.
        </p>
      </div>

      {loading && events.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
          <div className="mx-auto mb-3 size-6 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Loading cron activity...
          </p>
        </div>
      )}

      {!loading && events.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
          <Icons.Automations
            size={32}
            className="mx-auto mb-3 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No activity yet.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Cron job runs will appear here after the first run.
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {events.map((event, idx) => {
            const status = statusLabel(event.type)
            const isRunning = event.type === "cron.run.started"
            const isCompleted = event.type === "cron.run.completed"
            const isFailed = event.type === "cron.run.failed"
            const isExpanded = expandedIdx === idx
            const hasDetail = event.result || event.error

            return (
              <motion.div
                key={`${event.jobId}-${event.timestamp}-${idx}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
                data-cron-activity-job-id={event.jobId}
                data-cron-activity-job-name={event.name ?? ""}
                className={cn(
                  "flex flex-col rounded-xl",
                  "border border-border/50 bg-card",
                  "transition-colors",
                )}
              >
                <button
                  type="button"
                  onClick={() => hasDetail ? setExpandedIdx(isExpanded ? null : idx) : undefined}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-left",
                    hasDetail && "cursor-pointer hover:bg-secondary/30",
                    !hasDetail && "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-full",
                      isRunning && "bg-chart-2/15",
                      isCompleted && "bg-chart-1/15",
                      isFailed && "bg-red-400/15",
                    )}
                  >
                    {isRunning && (
                      <span className="size-2.5 animate-pulse rounded-full bg-chart-2" />
                    )}
                    {isCompleted && (
                      <Icons.Check size={14} className="text-chart-1" />
                    )}
                    {isFailed && (
                      <Icons.Close size={14} className="text-red-400" />
                    )}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {eventLabel(event)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          isRunning && "bg-chart-2/15 text-chart-2",
                          isCompleted && "bg-chart-1/15 text-chart-1",
                          isFailed && "bg-red-400/15 text-red-400",
                        )}
                      >
                        {status}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground/60">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>

                  {hasDetail && (
                    <Icons.Forward
                      size={12}
                      className={cn(
                        "shrink-0 text-muted-foreground/40 transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                  )}
                </button>

                {isExpanded && hasDetail && (
                  <div className="border-t border-border/30 px-4 py-3">
                    {event.error && (
                      <div className="rounded-lg bg-red-400/5 px-3 py-2">
                        <p className="text-[11px] font-medium text-red-400">
                          Error
                        </p>
                        <p className="mt-0.5 text-[11px] text-red-400/80">
                          {event.error}
                        </p>
                      </div>
                    )}
                    {event.result != null && (
                      <div className="rounded-lg bg-foreground/[0.03] px-3 py-2">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          Result
                        </p>
                        <pre className="mt-0.5 max-h-32 overflow-auto text-[10px] font-mono text-muted-foreground/80 scrollbar-hide">
                          {typeof event.result === "string"
                            ? event.result
                            : JSON.stringify(event.result as Record<string, unknown>, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
