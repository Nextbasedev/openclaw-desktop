"use client"

import { useMemo, useState, memo } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight } from "react-icons/vsc"
import { LuShieldCheck } from "react-icons/lu"
import { ToolCallDetails, getToolDetailState } from "./ToolCallDetails"
import type { InlineToolCall } from "./types"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

function toolBadge(tool: string) {
  const normalized = normalizeToolName(tool).toLowerCase()
  if (normalized === "session_status") {
    return { label: "SESSION", className: "bg-[#dcf0e3] text-[#2f6245] dark:bg-[#2a3a2e] dark:text-[#b7dfc1]" }
  }
  if (normalized === "read") {
    return { label: "READ", className: "bg-[#daeaf8] text-[#1d5d96] dark:bg-[#1e3049] dark:text-[#8dbdff]" }
  }
  if (normalized === "memory_search" || normalized === "memory_get") {
    return { label: normalized === "memory_search" ? "MEM SEARCH" : "MEM", className: "bg-[#ede6f8] text-[#6450a8] dark:bg-[#3a2850] dark:text-[#c9b0ff]" }
  }
  if (normalized === "exec" || normalized === "process") {
    return { label: normalized === "process" ? "PROCESS" : "EXEC", className: "bg-[#e4f0d8] text-[#52762d] dark:bg-[#2a3a1e] dark:text-[#bde98f]" }
  }
  return { label: toolVerb(tool), className: "bg-[#e5e3de] text-[#55534f] dark:bg-[#333333] dark:text-[#c9c7c2]" }
}

function StatusDot({ status }: { status: InlineToolCall["status"] }) {
  return (
    <span
      className={cn(
        "absolute left-[3px] top-[14px] z-10 size-2 rounded-full ring-2 ring-[#ffffff] dark:ring-[#1a1a1a]",
        status === "success" && "bg-[#16a34a] dark:bg-[#4ade8a]",
        status === "running" && "bg-[#16a34a] dark:bg-[#4ade8a] animate-pulse",
        status === "error" && "bg-red-500 dark:bg-red-400"
      )}
    />
  )
}

function decisionLabel(decision: ApprovalDecision) {
  if (decision === "allow-once") return "Approve once"
  if (decision === "allow-always") return "Always allow"
  return "Decline"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function unwrapToolInput(value: unknown): Record<string, unknown> | null {
  let record = asRecord(value)
  for (let i = 0; i < 4 && record; i += 1) {
    const nested = record.input ?? record.args ?? record.arguments ?? record.parameters
    const nestedRecord = asRecord(nested)
    if (!nestedRecord) return record
    record = nestedRecord
  }
  return record
}

function firstString(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function firstUsefulString(record: Record<string, unknown> | null) {
  if (!record) return null
  for (const [key, value] of Object.entries(record)) {
    if (["input", "args", "arguments", "parameters"].includes(key)) continue
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function normalizeToolName(tool: string) {
  return tool
    .replace(/^functions\./, "")
    .replace(/^tools\./, "")
    .replace(/^mcp__[\w-]+__/, "")
}

function toolVerb(tool: string) {
  const normalized = normalizeToolName(tool)
  const short = normalized.split(/[.:/]/).pop() || normalized
  return short.replace(/[_-]/g, " ").toUpperCase()
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function toolSubject(call: InlineToolCall, inputText: string) {
  const record = unwrapToolInput(call.input)
  const name = normalizeToolName(call.tool).toLowerCase()
  const picked = /exec|shell|bash|command/.test(name)
    ? firstString(record, ["command", "cmd", "script"])
    : /read|cat|file/.test(name)
      ? firstString(record, ["path", "file", "filename", "filePath"])
      : /write|edit|patch/.test(name)
        ? firstString(record, ["path", "file", "filename", "target"])
        : /fetch|web|url/.test(name)
          ? firstString(record, ["url", "href", "target"])
          : firstString(record, ["command", "path", "url", "query", "message", "prompt", "text", "file", "name"])

  const subject = picked || firstUsefulString(record) || call.tool
  return compactWhitespace(subject).slice(0, 180)
}

function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes}B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)}K`
  return `${(bytes / 1000 / 1000).toFixed(1)}M`
}

function toolMetrics(text: string, call: InlineToolCall) {
  if (call.status === "running") return "running"
  if (!text.trim()) return call.status === "error" ? "error" : "done"
  const lineCount = text.split("\n").length
  return `${formatBytes(text.length)} · ${lineCount}L`
}

function toolOrderTime(call: InlineToolCall) {
  if (typeof call.startedAt === "number" && Number.isFinite(call.startedAt)) return call.startedAt
  if (typeof call.completedAt === "number" && Number.isFinite(call.completedAt)) return call.completedAt
  return Number.POSITIVE_INFINITY
}

function sortToolsByCallOrder(tools: InlineToolCall[]) {
  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((a, b) => {
      const timeDelta = toolOrderTime(a.tool) - toolOrderTime(b.tool)
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta
      return a.index - b.index
    })
    .map(({ tool }) => tool)
}

function ToolRow({
  call,
  open,
  onOpenChange,
  onSelect,
  onInteract,
  onResolveApproval,
  sessionKey,
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
  sessionKey?: string
}) {
  const { inputText, outputText, fullOutputText, hasDetails } = getToolDetailState(call)
  const subject = toolSubject(call, inputText)
  const metrics = toolMetrics(fullOutputText ?? outputText, call)
  const badge = toolBadge(call.tool)
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
    <div className={cn("relative pl-7 transition-colors duration-100", approval && "rounded-lg bg-amber-400/[0.035]")}>
      <StatusDot status={call.status} />
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
          "group flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left",
          open ? "rounded-t-md rounded-b-none bg-white/5" : "rounded-md bg-white/5",
          "border border-white/10",
          "cursor-pointer transition-colors duration-100",
          "hover:bg-white/[0.07]"
        )}
      >
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none", badge.className)}>
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-[#1c1c1a] dark:text-[#e8e6e0]">
          {subject}
        </span>
        {approval && (
          <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90">
            approval needed
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-[#a8a6a1] dark:text-[#555553] tabular-nums">
          {metrics}
        </span>
        <span
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={onSelect ? "Open in Subagents" : undefined}
          title={onSelect ? "Open in Subagents" : undefined}
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
              ? "cursor-pointer text-muted-foreground/35 hover:bg-white/5 hover:text-foreground"
              : "text-foreground/20"
          )}
        >
          {hasDetails && open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
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
                fullOutputText={fullOutputText}
                sessionKey={sessionKey}
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

export const ToolCallSteps = memo(function ToolCallSteps({
  tools,
  defaultOpen = true,
  onSelectTool,
  onInteract,
  onResolveApproval,
  sessionKey,
}: {
  tools: InlineToolCall[]
  defaultOpen?: boolean
  onSelectTool?: (id: string) => void
  onInteract?: () => void
  sessionKey?: string
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}) {
  const orderedTools = useMemo(() => sortToolsByCallOrder(tools), [tools])
  const total = orderedTools.length
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  const [stepsOpen, setStepsOpen] = useState(defaultOpen)

  function handleToolOpenChange(id: string, nextOpen: boolean) {
    onInteract?.()
    setOpenToolId(nextOpen ? id : null)
  }

  if (!total) return null

  return (
    <div className="mb-2 ml-1 pl-2">
      <button
        type="button"
        onClick={() => {
          onInteract?.()
          setStepsOpen((open) => !open)
        }}
        className="mb-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded py-1 text-left text-muted-foreground/45 transition-colors hover:text-muted-foreground/75"
        aria-expanded={stepsOpen}
      >
        {stepsOpen ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        <span className="text-[11px] font-medium">Steps</span>
        <span className="font-mono text-[10px] tabular-nums">
          {total} tool{total !== 1 ? "s" : ""}
        </span>
      </button>
      {stepsOpen && (
        <div className="relative z-0 space-y-1.5 overflow-visible before:absolute before:bottom-4 before:left-[6.5px] before:top-4 before:w-px before:bg-[#d4d2cd] before:content-[''] dark:before:bg-[#444444]">
          {orderedTools.map((call) => (
            <ToolRow
              key={call.id}
              call={call}
              open={openToolId === call.id}
              onOpenChange={handleToolOpenChange}
              onSelect={onSelectTool}
              onInteract={onInteract}
              onResolveApproval={onResolveApproval}
              sessionKey={sessionKey}
            />
          ))}
        </div>
      )}
    </div>
  )
})
