"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscPass, VscError } from "react-icons/vsc"
import type { ToolCall, ToolCallStatus } from "./activity-types"

export function StatusBadge({ status }: { status: ToolCallStatus }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
        <VscPass className="size-3.5" /> success
      </span>
    )
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-400">
        <VscError className="size-3.5" /> error
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-400">
      <span className="size-1.5 animate-pulse rounded-full bg-blue-400" /> running
    </span>
  )
}

export const TREE_DOT_COLORS: Record<ToolCallStatus, string> = {
  running: "bg-amber-400",
  success: "bg-emerald-400",
  error: "bg-rose-400",
}

export const COUNT_BADGE_COLORS: Record<ToolCallStatus, string> = {
  running: "text-amber-400 bg-amber-400/15",
  success: "text-emerald-400 bg-emerald-400/15",
  error: "text-rose-400 bg-rose-400/15",
}

const DOT_COLORS: Record<ToolCallStatus, string> = {
  running: "bg-blue-400",
  success: "bg-emerald-400",
  error: "bg-rose-400",
}

const BADGE_COLORS: Record<ToolCallStatus, string> = {
  running: "border-blue-400/25 text-blue-300",
  success: "border-emerald-400/20 text-foreground/80",
  error: "border-rose-400/25 text-rose-300",
}

function formatTime(ts?: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatInput(input: Record<string, unknown>): string {
  const str = JSON.stringify(input, null, 2)
  return str.length > 700
    ? str.slice(0, 700) + "\n…(truncated)"
    : str
}

function truncateOutput(text: string): string {
  return text.length > 800
    ? text.slice(0, 800) + "\n…(truncated)"
    : text
}

export function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const hasDetails = call.input || call.output
  const dot = DOT_COLORS[call.status]
  const badge = BADGE_COLORS[call.status]

  return (
    <div className="activity-item">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((p) => !p)}
        className={cn(
          "flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors",
          hasDetails
            ? "cursor-pointer hover:bg-white/[0.02]"
            : "cursor-default",
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span
          className={cn(
            "rounded-md border px-2.5 py-[3px] text-[12px] font-medium",
            badge,
          )}
        >
          {call.tool}
        </span>

        <div className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          {call.duration && <span>{call.duration}</span>}
          <span>{formatTime(call.startedAt)}</span>
          {hasDetails && (
            <VscChevronDown
              className={cn(
                "size-3 transition-transform",
                open && "rotate-180",
              )}
            />
          )}
          {!hasDetails && call.status === "running" && (
            <span className="flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-[3px] animate-bounce rounded-full bg-blue-400"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="mx-2 mb-3 overflow-hidden rounded-lg border border-border/15 bg-[#0e0e10]">
          {call.input && (
            <div className="px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Input
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/70">
                {formatInput(call.input)}
              </pre>
            </div>
          )}
          {call.input && call.output && (
            <div className="h-px bg-white/6" />
          )}
          {call.output && (
            <div className="px-4 py-3">
              <p
                className={cn(
                  "mb-2 text-[10px] font-semibold uppercase tracking-widest",
                  call.status === "error"
                    ? "text-rose-400/70"
                    : "text-emerald-400/70",
                )}
              >
                Output
              </p>
              <pre
                className={cn(
                  "max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed",
                  call.status === "error"
                    ? "text-rose-300/90"
                    : "text-foreground/70",
                )}
              >
                {truncateOutput(call.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
