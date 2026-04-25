"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  isActiveSubagent,
  subagentStatusLabel,
} from "@/lib/subagentLifecycle"
import { VscChevronDown, VscChevronRight, VscHubot } from "react-icons/vsc"
import type { SpawnedSubagent } from "./types"

function StatusDot({ status }: { status: SpawnedSubagent["status"] }) {
  if (status === "spawning" || status === "linking" || status === "working") {
    return (
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
        <span className="relative size-2 rounded-full bg-blue-400" />
      </span>
    )
  }
  if (status === "failed") {
    return <span className="size-2 rounded-full bg-rose-400" />
  }
  return <span className="size-2 rounded-full bg-emerald-400" />
}

function statusLabel(sub: SpawnedSubagent) {
  if (!sub.sessionKey && sub.status === "completed") return "linking"
  return subagentStatusLabel(sub.status)
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
  const [expanded, setExpanded] = useState(true)

  const activeCount = subagents.filter((s) => isActiveSubagent(s.status)).length
  const hasActive = activeCount > 0

  useEffect(() => {
    if (hasActive) setExpanded(true)
  }, [hasActive])

  if (subagents.length === 0) return null

  return (
    <div
      className="mx-auto w-full max-w-3xl px-4"
      data-testid="subagent-composer-bar"
    >
      <div
        data-expanded={expanded ? "true" : "false"}
        className={cn(
          "relative overflow-hidden rounded-xl border transition-all duration-200",
          hasActive
            ? "border-blue-400/20 bg-blue-400/[0.03]"
            : "border-border/20 bg-card/50",
        )}
      >
        {hasActive && <ShimmerBar />}

        <button
          type="button"
          aria-label="Background agents"
          aria-expanded={expanded}
          onClick={() => setExpanded((p) => !p)}
          className="relative flex w-full items-center gap-2.5 px-3.5 py-2.5 cursor-pointer"
        >
          <VscHubot className={cn("size-4 shrink-0", hasActive ? "text-blue-400/70" : "text-muted-foreground/50")} />
          <span className="flex-1 text-left text-[12px] font-medium text-foreground/80">
            {subagents.length} background agent{subagents.length !== 1 ? "s" : ""}
            {hasActive && (
              <span className="ml-1 text-muted-foreground/50">
                ({activeCount} active)
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
                  <StatusDot
                    status={
                      !sub.sessionKey && sub.status === "completed"
                        ? "linking"
                        : sub.status
                    }
                  />
                  <span className="flex-1 truncate text-[12px] text-foreground/70">
                    <span className={cn(sub.status === "failed" ? "text-rose-400" : "text-foreground/80")}>
                      {sub.label}
                    </span>
                    <span className="ml-1.5 text-muted-foreground/40">
                      is {statusLabel(sub)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Open ${sub.label}`}
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
                    {sub.sessionKey ? "Open" : "Linking..."}
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
