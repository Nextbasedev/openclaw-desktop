"use client"

import { useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

type UpdateEntry = {
  version: string
  date: string
  changes: string[]
  tag?: "latest" | "beta"
}

const UPDATES: UpdateEntry[] = [
  {
    version: "v2.04",
    date: "April 17, 2026",
    tag: "latest",
    changes: [
      "Sidebar with drag-and-drop navigation",
      "New keyboard shortcuts: Ctrl+K search, Ctrl+~ terminal",
      "Version update notifications",
      "Improved theme consistency across components",
    ],
  },
  {
    version: "v2.03",
    date: "April 10, 2026",
    changes: [
      "Settings dialog redesign with tabbed navigation",
      "Custom traffic light controls for macOS",
      "Theme hotkey (D) to toggle dark/light mode",
    ],
  },
  {
    version: "v2.02",
    date: "April 3, 2026",
    tag: "beta",
    changes: [
      "Initial desktop layout with frameless window",
      "Header with user info and version badge",
      "Dark mode support with system preference detection",
    ],
  },
]

type VersionUpdateModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VersionUpdateModal({
  open,
  onOpenChange,
}: VersionUpdateModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onOpenChange])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{
              type: "spring",
              stiffness: 350,
              damping: 30,
            }}
            className={cn(
              "fixed inset-0 z-50 m-auto flex h-fit max-h-[80vh] w-full max-w-md flex-col",
              "overflow-hidden rounded-2xl border border-border/50",
              "bg-card shadow-2xl shadow-black/20",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🚀</span>
                <h2 className="text-[15px] font-semibold text-foreground">
                  What&apos;s New
                </h2>
              </div>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md",
                  "text-muted-foreground transition-colors",
                  "hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* Update entries */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-5">
                {UPDATES.map((entry, idx) => (
                  <motion.div
                    key={entry.version}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08, duration: 0.3 }}
                    className="flex flex-col gap-2"
                  >
                    {/* Version header */}
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-foreground">
                        {entry.version}
                      </span>
                      {entry.tag && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                            entry.tag === "latest"
                              ? "bg-chart-1/20 text-chart-1"
                              : "bg-chart-4/20 text-chart-4",
                          )}
                        >
                          {entry.tag}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {entry.date}
                      </span>
                    </div>

                    {/* Changes list */}
                    <ul className="flex flex-col gap-1 pl-1">
                      {entry.changes.map((change) => (
                        <li
                          key={change}
                          className="flex items-start gap-2 text-[12px] text-muted-foreground"
                        >
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          {change}
                        </li>
                      ))}
                    </ul>

                    {/* Separator (except last) */}
                    {idx < UPDATES.length - 1 && (
                      <div className="mt-1 border-b border-border/20" />
                    )}
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border/30 px-5 py-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "w-full rounded-lg py-2 text-[13px] font-medium",
                  "bg-accent text-accent-foreground transition-all",
                  "hover:brightness-110 active:brightness-95",
                )}
              >
                Got it
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
