"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronRight,
  VscChevronDown,
  VscPass,
  VscError,
  VscDebugStart,
} from "react-icons/vsc"
import type { ToolCall, ToolCallStatus, AgentNode } from "./activity-types"

const STATUS_STYLES: Record<
  ToolCallStatus,
  { bar: string; icon: string; bg: string; iconEl: React.ElementType }
> = {
  running: {
    bar: "bg-blue-400",
    icon: "text-blue-400",
    bg: "bg-blue-400/[0.06]",
    iconEl: VscDebugStart,
  },
  success: {
    bar: "bg-emerald-400",
    icon: "text-emerald-400",
    bg: "bg-transparent",
    iconEl: VscPass,
  },
  error: {
    bar: "bg-rose-400",
    icon: "text-rose-400",
    bg: "bg-rose-400/[0.06]",
    iconEl: VscError,
  },
}

export function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const s = STATUS_STYLES[call.status]
  const Icon = s.iconEl
  const hasDetails = call.input || call.output

  return (
    <div className="activity-item group/tool">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((p) => !p)}
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left",
          "transition-all duration-150",
          hasDetails ? "cursor-pointer hover:bg-secondary/40" : "cursor-default",
          open && "bg-secondary/30",
          s.bg,
        )}
      >
        <div
          className={cn(
            "absolute left-0 top-[6px] bottom-[6px] w-[2.5px] rounded-full transition-opacity",
            s.bar,
            call.status === "running" ? "opacity-100" : "opacity-0 group-hover/tool:opacity-80",
          )}
        />

        <Icon
          className={cn(
            "size-3.5 shrink-0",
            s.icon,
            call.status === "running" && "animate-pulse",
          )}
        />

        <span className="flex-1 truncate text-[12px] text-foreground/90">
          {call.tool}
        </span>

        {call.duration && (
          <span className="rounded-md bg-secondary/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
            {call.duration}
          </span>
        )}

        {call.status === "running" && (
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

        {hasDetails && (
          <span className="text-muted-foreground transition-transform duration-150">
            {open ? (
              <VscChevronDown className="size-3" />
            ) : (
              <VscChevronRight className="size-3" />
            )}
          </span>
        )}
      </button>

      <div className="activity-expand" data-open={open}>
        <div>
          <div className="mx-1 mb-2 overflow-hidden rounded-lg border border-border/20 bg-[#0e0e10]">
            {call.input && (
              <div className="px-3 py-2.5">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Input
                </p>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-blue-300/80 font-[ui-monospace,SFMono-Regular,Menlo,monospace]">
                  {formatOutput(call.input)}
                </pre>
              </div>
            )}
            {call.input && call.output && (
              <div className="h-px bg-white/8" />
            )}
            {call.output && (
              <div className="px-3 py-2.5">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Output
                </p>
                <pre
                  className={cn(
                    "max-h-36 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed",
                    "font-[ui-monospace,SFMono-Regular,Menlo,monospace]",
                    call.status === "error"
                      ? "text-rose-300/90"
                      : "text-foreground/70",
                  )}
                >
                  {truncateText(call.output)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatOutput(input: Record<string, unknown>): string {
  const str = JSON.stringify(input, null, 2)
  return str.length > 700 ? str.slice(0, 700) + "\n…(truncated)" : str
}

function truncateText(text: string): string {
  return text.length > 800 ? text.slice(0, 800) + "\n…(truncated)" : text
}

export function AgentNodeBlock({
  node,
  depth = 0,
}: {
  node: AgentNode
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)
  const s = STATUS_STYLES[node.status]
  const Icon = s.iconEl

  const done = node.calls.filter((c) => c.status === "success").length
  const errs = node.calls.filter((c) => c.status === "error").length
  const runs = node.calls.filter((c) => c.status === "running").length

  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-border/20 pl-1")}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left",
          "bg-secondary/20 ring-1 ring-border/15 transition-all duration-150",
          "hover:bg-secondary/30 hover:ring-border/25",
          "mx-1 mb-1",
        )}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary/50">
          <Icon className={cn("size-3.5", s.icon)} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[12px] font-medium text-foreground">
            {node.label}
          </span>
          {node.model && (
            <span className="text-[10px] text-muted-foreground">
              {node.model}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {done > 0 && (
            <span className="rounded-md bg-emerald-400/15 px-1.5 py-px text-[10px] tabular-nums text-emerald-400">
              {done}
            </span>
          )}
          {errs > 0 && (
            <span className="rounded-md bg-rose-400/15 px-1.5 py-px text-[10px] tabular-nums text-rose-400">
              {errs}
            </span>
          )}
          {runs > 0 && (
            <span className="rounded-md bg-blue-400/15 px-1.5 py-px text-[10px] tabular-nums text-blue-400">
              {runs}
            </span>
          )}
        </div>

        <VscChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>

      <div className="activity-expand" data-open={expanded}>
        <div>
          <div className="space-y-px px-2 pb-2 pt-0.5">
            {node.calls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
            {node.children?.map((child) => (
              <AgentNodeBlock
                key={child.id}
                node={child}
                depth={depth + 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
