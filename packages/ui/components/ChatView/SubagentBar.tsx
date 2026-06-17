"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/60" />
        <span className="relative size-2 rounded-full bg-amber-400" />
      </span>
    )
  }
  if (status === "failed") {
    return <span className="size-2 rounded-full bg-rose-400" />
  }
  return <span className="size-2 rounded-full bg-emerald-400" />
}

function statusLabel(sub: SpawnedSubagent) {
  return subagentStatusLabel(sub.status)
}

function subagentRenderKey(sub: SpawnedSubagent) {
  return sub.sessionKey ?? sub.id ?? (sub.toolCallId ? `spawn:${sub.toolCallId}` : sub.label)
}

function visibleStatusRank(status: SpawnedSubagent["status"]) {
  if (status === "failed") return 5
  if (status === "completed") return 4
  if (status === "working") return 3
  if (status === "linking") return 2
  return 1
}

function ShimmerBar() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl">
      <div className="shimmer-slide absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
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
  const [contentHeight, setContentHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const visibleSubagents = useMemo(() => {
    const byKey = new Map<string, SpawnedSubagent>()
    for (const sub of subagents) {
      const key = subagentRenderKey(sub)
      const existing = byKey.get(key)
      if (
        !existing ||
        (!existing.sessionKey && sub.sessionKey) ||
        visibleStatusRank(sub.status) > visibleStatusRank(existing.status)
      ) {
        byKey.set(key, sub)
      }
    }
    return Array.from(byKey.values())
  }, [subagents])

  const activeCount = visibleSubagents.filter((s) => isActiveSubagent(s.status)).length
  const hasActive = activeCount > 0

  useEffect(() => {
    const node = contentRef.current
    if (!node || typeof ResizeObserver === "undefined") return

    const updateHeight = () => setContentHeight(node.scrollHeight)
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    window.addEventListener("resize", updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateHeight)
    }
  }, [visibleSubagents])

  if (visibleSubagents.length === 0) return null

  return (
    <div
      className="w-full"
      data-testid="subagent-composer-bar"
    >
      <div
        data-expanded={expanded ? "true" : "false"}
        className={cn(
          "relative overflow-hidden rounded-xl border transition-all duration-200",
          hasActive
            ? "border-foreground/15 bg-foreground/[0.03]"
            : "border-border/20 bg-card/50",
        )}
      >
        {hasActive && <ShimmerBar />}

        <button
          type="button"
          aria-label="Background agents"
          aria-expanded={expanded}
          onClick={() => setExpanded((p) => !p)}
          className="relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-foreground/18"
        >
          <VscHubot
            className={cn(
              "size-4 shrink-0",
              hasActive ? "text-foreground/70" : "text-muted-foreground/50",
            )}
          />
          <span className="flex-1 text-left text-[12px] font-medium text-foreground/80">
            {visibleSubagents.length} background agent{visibleSubagents.length !== 1 ? "s" : ""}
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
          className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
          style={{
            maxHeight: expanded ? `${contentHeight}px` : "0px",
            opacity: expanded ? 1 : 0,
          }}
        >
          <div
            ref={contentRef}
            className={cn(
              "px-1 py-1 transition-[transform,opacity,border-color] duration-300 ease-in-out",
              expanded
                ? "translate-y-0 border-t border-border/10 opacity-100"
                : "-translate-y-1 border-t border-transparent opacity-0",
            )}
          >
              {visibleSubagents.map((sub) => (
                <div
                  key={subagentRenderKey(sub)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/[0.03]"
                >
                  <StatusDot status={sub.status} />
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
                    {sub.sessionKey ? "Open" : sub.status === "completed" ? "Done" : "Linking..."}
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
