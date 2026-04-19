"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronDown,
  VscChevronRight,
  VscError,
} from "react-icons/vsc"
import { LuTerminal, LuLoader } from "react-icons/lu"
import type { InlineToolCall } from "./types"

function ToolIcon({ status }: { status: InlineToolCall["status"] }) {
  if (status === "running") {
    return <LuLoader className="size-3.5 shrink-0 animate-spin text-blue-400" />
  }
  if (status === "error") {
    return <VscError className="size-3.5 shrink-0 text-rose-400" />
  }
  return <LuTerminal className="size-3.5 shrink-0 text-foreground/40" />
}

function ToolRow({
  call,
  onSelect,
}: {
  call: InlineToolCall
  onSelect?: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.(call.id)
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[6px] text-left",
        "cursor-pointer transition-colors duration-100",
        "hover:bg-foreground/5",
        call.status === "running" && "bg-blue-400/3",
      )}
    >
      <ToolIcon status={call.status} />
      <span className="flex-1 truncate text-[12px] text-foreground/60">
        {call.tool}
      </span>
      {call.duration && (
        <span className="text-[10px] tabular-nums text-muted-foreground/50">
          {call.duration}
        </span>
      )}
      <VscChevronRight className="size-3 shrink-0 text-foreground/20" />
    </button>
  )
}

export function ToolCallSteps({
  tools,
  defaultOpen = false,
  onSelectTool,
}: {
  tools: InlineToolCall[]
  defaultOpen?: boolean
  onSelectTool?: (id: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  const total = tools.length
  const rest = total - 1
  const first = tools[0]

  if (!first) return null

  return (
    <div className={cn(open ? "mb-3" : "mb-12")}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          "flex items-center gap-1.5 py-1 cursor-pointer mb-0.5",
          "text-muted-foreground/60 hover:text-muted-foreground transition-colors",
        )}
      >
        {open ? (
          <VscChevronDown className="size-3" />
        ) : (
          <VscChevronRight className="size-3" />
        )}
        <span className="text-[12px] font-medium">Steps</span>
        <span className="text-[11px] text-muted-foreground/40">
          {total} tool{total !== 1 ? "s" : ""} used
        </span>
      </button>

      <div className="ml-1 border-l border-border/20 pl-1.5">
        <div
          className="grid transition-[grid-template-rows] duration-250 ease-in-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            {tools.map((call) => (
              <ToolRow key={call.id} call={call} onSelect={onSelectTool} />
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                "mt-1 flex items-center gap-1 py-1 cursor-pointer",
                "text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors",
              )}
            >
              <VscChevronDown className="size-3 rotate-180" />
              <span>Collapse</span>
            </button>
          </div>
        </div>

        {!open && (
          <div
            className="relative cursor-pointer"
            onClick={() => setOpen(true)}
          >
            <div className="relative z-10 flex items-center gap-2.5 rounded-lg border border-border/20 bg-card px-2.5 py-[6px]">
              <ToolIcon status={first.status} />
              <span className="flex-1 truncate text-[12px] text-foreground/60">
                {first.tool}
              </span>
              {first.duration && (
                <span className="text-[10px] tabular-nums text-muted-foreground/50">
                  {first.duration}
                </span>
              )}
              <VscChevronRight className="size-3 shrink-0 text-foreground/20" />
            </div>

            {rest > 0 && (
              <>
                <div className="absolute left-1 right-1 top-[6px] z-2 h-full rounded-lg border border-border/15 bg-card/80" />
                {rest > 1 && (
                  <div className="absolute left-2 right-2 top-[12px] z-1 h-full rounded-lg border border-border/10 bg-card/60" />
                )}
                <span className="absolute -bottom-7 left-0 z-20 text-[10px] text-muted-foreground/40">
                  +{rest} more
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
