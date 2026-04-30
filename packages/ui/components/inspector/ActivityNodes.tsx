"use client"

import { useEffect, useRef, useState } from "react"
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
      <span className="size-1.5 animate-pulse rounded-full bg-blue-400" /> working
    </span>
  )
}

export const TREE_DOT_COLORS: Record<ToolCallStatus, string> = {
  running: "bg-amber-400",
  success: "bg-emerald-400",
  error: "bg-rose-400",
}

export const COUNT_BADGE_COLORS: Record<ToolCallStatus, string> = {
  running: "border border-[#FDC700]/20 bg-[#FDC700]/10 text-[#FDC700]",
  success: "border border-[#00D492]/20 bg-[#00D492]/10 text-[#00D492]",
  error: "border border-[#FF4D4D]/20 bg-[#FF4D4D]/10 text-[#FF4D4D]",
}

const DOT_COLORS: Record<ToolCallStatus, string> = {
  running: "bg-[#FDC700]",
  success: "bg-[#00D492]",
  error: "bg-[#FF4D4D]",
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

export function ToolCallRow({
  call,
  focused,
  onFocusHandled,
}: {
  call: ToolCall
  focused?: boolean
  onFocusHandled?: () => void
}) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const hasDetails = call.input || call.output
  const dot = DOT_COLORS[call.status]
  const isError = call.status === "error"

  useEffect(() => {
    if (!focused) return
    const timer = hasDetails
      ? window.setTimeout(() => setOpen(true), 0)
      : null
    const frame = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    onFocusHandled?.()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [focused, hasDetails, onFocusHandled])

  return (
    <div ref={rowRef} className="activity-item px-1 py-1">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((p) => !p)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors",
          hasDetails ? "cursor-pointer" : "cursor-default",
        )}
      >
        <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/2 px-3 py-1 text-[12px] font-medium text-foreground">
          <span className={cn("size-1.5 rounded-full", dot)} />
          {call.tool}
        </span>

        <div className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          {call.duration && <span>{call.duration}</span>}
          <span>{formatTime(call.startedAt)}</span>
          {hasDetails && (
            <VscChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180",
              )}
            />
          )}
          {!hasDetails && call.status === "running" && (
            <span className="flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-[3px] animate-bounce rounded-full bg-[#FDC700]"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          )}
        </div>
      </button>

      {hasDetails && (
        <div className="activity-expand" data-open={open ? "true" : "false"}>
          <div>
            <div className="activity-expand-inner mt-2 mb-2 overflow-hidden rounded-lg border border-border/30 bg-[#121212]">
              {call.input && (
                <div>
                  <div className="border-b border-white/6 bg-white/2 px-5 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/55">
                      Input
                    </p>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-5 py-4 font-mono text-[12px] leading-relaxed text-foreground/85">
                    {formatInput(call.input)}
                  </pre>
                </div>
              )}
              {call.input && call.output && (
                <div className="h-px bg-white/6" />
              )}
              {call.output && (
                <div>
                  <div className="border-b border-white/6 bg-white/2 px-5 py-2.5">
                    <p
                      className={cn(
                        "text-[11px] font-semibold uppercase tracking-[0.18em]",
                        isError ? "text-[#FF4D4D]/80" : "text-[#00D492]/80",
                      )}
                    >
                      Output
                    </p>
                  </div>
                  <pre
                    className={cn(
                      "max-h-48 overflow-auto whitespace-pre-wrap break-all px-5 py-4 font-mono text-[12px] leading-relaxed",
                      isError ? "text-[#FF4D4D]" : "text-[#00D492]",
                    )}
                  >
                    {truncateOutput(call.output)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
