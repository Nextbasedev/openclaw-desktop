"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscError } from "react-icons/vsc"
import { LuLoader, LuTerminal } from "react-icons/lu"
import {
  ToolApprovalPanel,
  type ApprovalDecision,
} from "./ToolApprovalPanel"
import { ToolCallDetails, getToolDetailState } from "./ToolCallDetails"
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
  open,
  onOpenChange,
  onSelect,
  onResolveApproval,
}: {
  call: InlineToolCall
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (id: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}) {
  const { inputText, outputText, hasDetails } = getToolDetailState(call)
  const [resolving, setResolving] = useState<ApprovalDecision | null>(null)
  const [resolved, setResolved] = useState<ApprovalDecision | null>(null)
  const approval = call.approval

  async function resolve(decision: ApprovalDecision) {
    if (!approval || resolving || resolved) return
    setResolving(decision)
    try {
      await onResolveApproval?.(approval.id, decision)
      setResolved(decision)
    } finally {
      setResolving(null)
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg transition-colors duration-100",
        call.status === "running" && "bg-blue-400/3",
        approval && "border border-amber-400/15 bg-amber-400/[0.035]"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (hasDetails) {
            onOpenChange(!open)
          } else {
            onSelect?.(call.id)
          }
        }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md bg-card px-2.5 py-[6px] text-left",
          "cursor-pointer transition-colors duration-100",
          "hover:bg-card/80"
        )}
      >
        <ToolIcon status={call.status} />
        <span className="flex-1 truncate text-[12px] text-foreground/60">
          {call.tool}
        </span>
        {approval && (
          <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90">
            approval needed
          </span>
        )}
        {call.duration && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">
            {call.duration}
          </span>
        )}
        {onSelect && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(call.id)
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return
              e.preventDefault()
              e.stopPropagation()
              onSelect(call.id)
            }}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/55 transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Open in Activity
          </span>
        )}
        {hasDetails ? (
          <VscChevronDown
            className={cn(
              "size-3 shrink-0 text-foreground/25 transition-transform",
              !open && "-rotate-90"
            )}
          />
        ) : (
          <VscChevronRight className="size-3 shrink-0 text-foreground/20" />
        )}
      </button>

      {hasDetails && (
        <div
          className="grid transition-[grid-template-rows] duration-250 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "pb-2 transition-all duration-250 ease-out",
                open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
              )}
            >
              <ToolCallDetails
                call={call}
                inputText={inputText}
                outputText={outputText}
              />
            </div>
          </div>
        </div>
      )}

      {approval && (
        <ToolApprovalPanel
          approval={approval}
          resolving={resolving}
          resolved={resolved}
          onResolve={(decision) => void resolve(decision)}
        />
      )}
    </div>
  )
}

export function ToolCallSteps({
  tools,
  defaultOpen = false,
  onSelectTool,
  onResolveApproval,
}: {
  tools: InlineToolCall[]
  defaultOpen?: boolean
  onSelectTool?: (id: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openToolId, setOpenToolId] = useState<string | null>(null)

  const total = tools.length
  const rest = total - 1
  const collapsedTop = tools[tools.length - 1]

  if (!collapsedTop) return null

  if (total === 1) {
    return (
      <div className="mb-3">
        <button
          type="button"
          className={cn(
            "mb-0.5 flex items-center gap-1.5 py-1",
            "text-muted-foreground/60"
          )}
        >
          <VscChevronDown className="size-3" />
          <span className="text-[12px] font-medium">Steps</span>
          <span className="text-[11px] text-muted-foreground/40">
            1 tool used
          </span>
        </button>

        <div className="ml-1 border-l border-border/20 pl-1.5">
          <ToolRow
            call={collapsedTop}
            open={openToolId === collapsedTop.id}
            onOpenChange={(nextOpen) => {
              setOpenToolId(nextOpen ? collapsedTop.id : null)
            }}
            onSelect={onSelectTool}
            onResolveApproval={onResolveApproval}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="transition-all duration-300 ease-out"
      style={{ marginBottom: open ? 12 : 36 }}
    >
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          "mb-0.5 flex cursor-pointer items-center gap-1.5 py-1",
          "text-muted-foreground/60 transition-colors hover:text-muted-foreground"
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
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "space-y-1 transition-all duration-300 ease-out",
                open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
              )}
            >
              {tools.map((call) => (
                <ToolRow
                  key={call.id}
                  call={call}
                  open={openToolId === call.id}
                  onOpenChange={(nextOpen) => {
                    setOpenToolId(nextOpen ? call.id : null)
                  }}
                  onSelect={onSelectTool}
                  onResolveApproval={onResolveApproval}
                />
              ))}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "mt-1 flex cursor-pointer items-center gap-1 py-1",
                  "text-[11px] text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                )}
              >
                <VscChevronDown className="size-3 rotate-180" />
                <span>Collapse</span>
              </button>
            </div>
          </div>
        </div>

        {!open && (
          <div
            className="relative cursor-pointer"
            onClick={() => setOpen(true)}
          >
            <div className="relative z-10 flex items-center gap-2.5 rounded-lg bg-card px-2.5 py-[6px]">
              <ToolIcon status={collapsedTop.status} />
              <span className="flex-1 truncate text-[12px] text-foreground/60">
                {collapsedTop.tool}
              </span>
              {collapsedTop.approval && (
                <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90">
                  approval needed
                </span>
              )}
              {collapsedTop.duration && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                  {collapsedTop.duration}
                </span>
              )}
              <VscChevronRight className="size-3 shrink-0 text-foreground/20" />
            </div>

            {rest > 0 && (
              <>
                <div className="absolute top-[6px] right-1 left-1 z-2 h-full rounded-lg bg-card/80" />
                {rest > 1 && (
                  <div className="absolute top-[12px] right-2 left-2 z-1 h-full rounded-lg bg-card/60" />
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
