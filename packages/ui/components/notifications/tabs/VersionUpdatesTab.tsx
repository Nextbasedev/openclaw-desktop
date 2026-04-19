"use client"

import { motion } from "framer-motion"
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

export function VersionUpdatesTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Version Updates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          See what&apos;s new in each release.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {UPDATES.map((entry, idx) => (
          <motion.div
            key={entry.version}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.08, duration: 0.3 }}
            className="flex flex-col gap-2"
          >
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

            {idx < UPDATES.length - 1 && (
              <div className="mt-1 border-b border-border/20" />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
