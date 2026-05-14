"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscError } from "react-icons/vsc"
import { LuLoader, LuShieldCheck, LuTerminal } from "react-icons/lu"
import { ToolCallDetails, getToolDetailState } from "./ToolCallDetails"
import type { InlineToolCall } from "./types"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

function ToolIcon({ status }: { status: InlineToolCall["status"] }) {
  if (status === "running") {
    return <LuLoader className="size-3.5 shrink-0 animate-spin text-blue-400" />
  }
  if (status === "error") {
    return <VscError className="size-3.5 shrink-0 text-rose-400" />
  }
  return <LuTerminal className="size-3.5 shrink-0 text-foreground/40" />
}

function decisionLabel(decision: ApprovalDecision) {
  if (decision === "allow-once") return "Approve once"
  if (decision === "allow-always") return "Always allow"
  return "Decline"
}

function ToolRow({
  call,
  open,
  onOpenChange,
  onSelect,
  onInteract,
  onResolveApproval,
}: {
  call: InlineToolCall
  open: boolean
  onOpenChange: (id: string, open: boolean) => void
  onSelect?: (id: string) => void
  onInteract?: () => void
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
        approval && "border border-amber-400/15 bg-amber-400/[0.035]"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onInteract?.()
          if (hasDetails) {
            onOpenChange(call.id, !open)
          } else {
            onSelect?.(call.id)
          }
        }}
        className={cn(
          "flex w-full items-center gap-2.5 bg-card px-2.5 py-[6px] text-left",
          open ? "rounded-t-md rounded-b-none" : "rounded-md",
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
        <span
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={onSelect ? "Open in Activity" : undefined}
          title={onSelect ? "Open in Activity" : undefined}
          onClick={(e) => {
            if (!onSelect) return
            e.stopPropagation()
            onInteract?.()
            onSelect(call.id)
          }}
          onKeyDown={(e) => {
            if (!onSelect || (e.key !== "Enter" && e.key !== " ")) return
            e.preventDefault()
            e.stopPropagation()
            onInteract?.()
            onSelect(call.id)
          }}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded transition-colors",
            onSelect
              ? "cursor-pointer text-muted-foreground/45 hover:bg-white/5 hover:text-foreground"
              : "text-foreground/20"
          )}
        >
          <VscChevronRight className="size-3" />
        </span>
      </button>

      {hasDetails && (
        <div
          className="grid transition-[grid-template-rows] duration-250 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "transition-all duration-250 ease-out",
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
        <div className="px-2.5 pt-0.5 pb-2">
          <div className="rounded-lg border border-amber-400/10 bg-background/45 p-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-amber-200/90">
              <LuShieldCheck className="size-3.5" />
              Command approval required
            </div>
            {approval.command && (
              <pre className="mb-2 max-h-24 overflow-auto rounded-md bg-black/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/75">
                {approval.command}
              </pre>
            )}
            {resolved ? (
              <div className="text-[11px] text-muted-foreground">
                {resolved === "deny" ? "Declined" : "Approved"}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {approval.allowedDecisions.map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={Boolean(resolving)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onInteract?.()
                      void resolve(decision)
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60",
                      decision === "deny"
                        ? "bg-red-400/10 text-red-300 hover:bg-red-400/15"
                        : "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15"
                    )}
                  >
                    {resolving === decision
                      ? "Working…"
                      : decisionLabel(decision)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ToolCallSteps({
  tools,
  defaultOpen = false,
  onSelectTool,
  onInteract,
  onResolveApproval,
  autoOpenLatestResult = false,
}: {
  tools: InlineToolCall[]
  defaultOpen?: boolean
  autoOpenLatestResult?: boolean
  onSelectTool?: (id: string) => void
  onInteract?: () => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  const lastAutoOpenedResultRef = useRef<string | null>(null)

  useEffect(() => {
    if (!autoOpenLatestResult) return
    const latestCompletedWithDetails = [...tools]
      .reverse()
      .find((tool) => tool.status !== "running" && getToolDetailState(tool).hasDetails)
    if (!latestCompletedWithDetails) return
    const signature = `${latestCompletedWithDetails.id}:${latestCompletedWithDetails.status}:${latestCompletedWithDetails.resultText ?? ""}:${latestCompletedWithDetails.duration ?? ""}`
    if (lastAutoOpenedResultRef.current === signature) return
    lastAutoOpenedResultRef.current = signature
    setOpen(true)
    setOpenToolId(latestCompletedWithDetails.id)
  }, [autoOpenLatestResult, tools])

  function handleToolOpenChange(id: string, nextOpen: boolean) {
    onInteract?.()
    setOpenToolId(nextOpen ? id : null)
  }

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
            onOpenChange={handleToolOpenChange}
            onSelect={onSelectTool}
            onInteract={onInteract}
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
        onClick={() => {
          onInteract?.()
          setOpen((p) => !p)
        }}
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
                  onOpenChange={handleToolOpenChange}
                  onSelect={onSelectTool}
                  onInteract={onInteract}
                  onResolveApproval={onResolveApproval}
                />
              ))}
              <button
                type="button"
                onClick={() => {
                  onInteract?.()
                  setOpen(false)
                }}
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
            onClick={() => {
              onInteract?.()
              setOpen(true)
            }}
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
