"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronRight,
  VscChevronDown,
  VscCircleFilled,
} from "react-icons/vsc"
import type { ToolCall, ToolCallStatus, AgentNode } from "./activity-types"

export function StatusIndicator({ status }: { status: ToolCallStatus }) {
  return (
    <span
      className={cn(
        "relative flex size-[7px] shrink-0",
        status === "running" && "animate-pulse",
      )}
    >
      <VscCircleFilled
        className={cn("size-[7px]", {
          "text-amber-400": status === "running",
          "text-emerald-400": status === "success",
          "text-red-400": status === "error",
        })}
      />
    </span>
  )
}

export function ToolCallRow({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group/row">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-[7px] text-left transition-colors",
          "hover:bg-secondary/30",
          expanded && "bg-secondary/20",
        )}
      >
        <span className="flex size-3.5 items-center justify-center text-muted-foreground/70">
          {expanded ? (
            <VscChevronDown className="size-3" />
          ) : (
            <VscChevronRight className="size-3" />
          )}
        </span>
        <StatusIndicator status={call.status} />
        <code className="flex-1 truncate text-[12px] text-foreground/90">
          {call.tool}
        </code>
        {call.duration && (
          <span className="tabular-nums text-[11px] text-muted-foreground/70">
            {call.duration}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-border/40 bg-background/60">
          {call.input && (
            <div className="border-b border-border/30 px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Input
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-[1.5] text-sky-300/90">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div className="px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Output
              </p>
              <pre
                className={cn(
                  "max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-[1.5]",
                  {
                    "text-emerald-300/90": call.status === "success",
                    "text-red-300/90": call.status === "error",
                    "text-amber-300/90": call.status === "running",
                  },
                )}
              >
                {call.output.length > 800
                  ? call.output.slice(0, 800) + "\n…(truncated)"
                  : call.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentNodeBlock({
  node,
  depth = 0,
}: {
  node: AgentNode
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className={cn(depth > 0 && "ml-2.5 border-l border-border/30")}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="flex size-3.5 items-center justify-center text-muted-foreground/70">
          {expanded ? (
            <VscChevronDown className="size-3" />
          ) : (
            <VscChevronRight className="size-3" />
          )}
        </span>
        <StatusIndicator status={node.status} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium text-foreground">
            {node.label}
          </span>
          {node.model && (
            <span className="text-[10px] text-muted-foreground/70">
              {node.model}
            </span>
          )}
        </div>
        <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {node.calls.length}
        </span>
      </button>

      {expanded && (
        <div>
          {node.calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
          {node.children?.map((child) => (
            <AgentNodeBlock key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
