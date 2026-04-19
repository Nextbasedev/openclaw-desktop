"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { invoke } from "@/lib/ipc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

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

type NotificationPopoverProps = {
  onViewAll?: () => void
}

const spring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.8,
}

export function NotificationPopover({ onViewAll }: NotificationPopoverProps) {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await invoke<{ jobs: CronJob[] }>(
        "middleware_cron_list_jobs",
      )
      setJobs(result.jobs.slice(0, 3))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load",
      )
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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Notifications"
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-7 items-center justify-center rounded-md",
          "cursor-pointer transition-colors group/icon",
          open
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icons.Notification size={16} strokeWidth={1.5} className="size-4" />
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
              "absolute right-0 top-full z-50 mt-1.5 w-72",
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
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
                </div>
              )}

              {error && (
                <EmptyState />
              )}

              {!loading && !error && jobs.length === 0 && (
                <EmptyState />
              )}

              {!loading && !error && jobs.length > 0 && (
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
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-2",
                        "transition-colors hover:bg-secondary/50",
                      )}
                    >
                      <Icons.Cron
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[12px] font-medium text-foreground">
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
              )}
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

function EmptyState() {
  return (
    <div className="px-2 py-4 text-center">
      <Icons.Notification
        size={28}
        className="mx-auto mb-2 text-muted-foreground/30"
      />
      <p className="text-[12px] text-muted-foreground">
        No creations yet.
      </p>
      <p className="text-[11px] text-muted-foreground/60">
        Generate something to see it here.
      </p>
    </div>
  )
}
