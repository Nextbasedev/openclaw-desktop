"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscHubot } from "react-icons/vsc"
import type { SpawnedSubagent } from "./types"

function StatusDot({ status }: { status: SpawnedSubagent["status"] }) {
  if (status === "running") {
    return (
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
        <span className="relative size-2 rounded-full bg-blue-400" />
      </span>
    )
  }
  if (status === "error") {
    return <span className="size-2 rounded-full bg-rose-400" />
  }
  return <span className="size-2 rounded-full bg-emerald-400" />
}

function statusLabel(status: SpawnedSubagent["status"]) {
  if (status === "running") return "running"
  if (status === "error") return "error"
  return "done"
}

function ShimmerBar() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl">
      <div className="shimmer-slide absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-blue-400/[0.06] to-transparent" />
    </div>
  )
}

export function SubagentBar({
  subagents,
  onOpen,
}: {
  subagents: SpawnedSubagent[]
  onOpen: (sub: SpawnedSubagent) => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (subagents.length === 0) return null

  const runningCount = subagents.filter((s) => s.status === "running").length
  const hasRunning = runningCount > 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border transition-all duration-200",
          hasRunning
            ? "border-blue-400/20 bg-blue-400/[0.03]"
            : "border-border/20 bg-card/50",
        )}
      >
        {hasRunning && <ShimmerBar />}

        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="relative flex w-full items-center gap-2.5 px-3.5 py-2.5 cursor-pointer"
        >
          <VscHubot className={cn("size-4 shrink-0", hasRunning ? "text-blue-400/70" : "text-muted-foreground/50")} />
          <span className="flex-1 text-left text-[12px] font-medium text-foreground/80">
            {subagents.length} background agent{subagents.length !== 1 ? "s" : ""}
            {hasRunning && (
              <span className="ml-1 text-muted-foreground/50">
                ({runningCount} running)
              </span>
            )}
          </span>
          {expanded ? (
            <VscChevronDown className="size-3.5 text-muted-foreground/40" />
          ) : (
            <VscChevronRight className="size-3.5 text-muted-foreground/40" />
          )}
        </button>

        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border/10 px-1 py-1">
              {subagents.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/[0.03]"
                >
                  <StatusDot status={sub.status} />
                  <span className="flex-1 truncate text-[12px] text-foreground/70">
                    <span className={cn(sub.status === "error" ? "text-rose-400" : "text-foreground/80")}>
                      {sub.label}
                    </span>
                    <span className="ml-1.5 text-muted-foreground/40">
                      is {statusLabel(sub.status)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={!sub.sessionKey}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(sub)
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      sub.sessionKey
                        ? "cursor-pointer border border-border/20 text-foreground/60 hover:bg-foreground/5 hover:text-foreground/80"
                        : "border border-border/10 text-muted-foreground/30",
                    )}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
