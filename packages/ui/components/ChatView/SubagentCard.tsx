"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown } from "react-icons/vsc"
import type { SpawnedSubagent } from "./types"

export function SubagentCard({
  subagents,
  onOpen,
}: {
  subagents: SpawnedSubagent[]
  onOpen: (sub: SpawnedSubagent) => void
}) {
  const [open, setOpen] = useState(false)
  if (subagents.length === 0) return null

  const hasRunning = subagents.some((s) => s.status === "running")
  const count = subagents.length
  const label = hasRunning
    ? `Spawning ${count} agent${count !== 1 ? "s" : ""}`
    : `Spawned ${count} agent${count !== 1 ? "s" : ""}`

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground/70 transition-colors cursor-pointer"
      >
        <span
          className={cn(
            hasRunning &&
              "bg-gradient-to-r from-foreground/60 via-blue-400/80 to-foreground/60 bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer-text",
          )}
        >
          {label}
        </span>
        <VscChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-0.5">
          {subagents.map((sub) => (
            <div key={sub.id}>
              <p className="text-[13px] font-medium text-foreground/60">
                {sub.status === "running"
                  ? "Spawning"
                  : sub.status === "error"
                    ? "Error"
                    : "Complete"}
              </p>
              <p className="text-[13px] text-muted-foreground">
                <span className="text-muted-foreground/60">Input: </span>
                {sub.label}
              </p>
              {sub.status !== "running" && (
                <button
                  type="button"
                  onClick={() => onOpen(sub)}
                  className="mt-0.5 text-[12px] text-blue-400/70 hover:text-blue-400 transition-colors cursor-pointer"
                >
                  View output
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
