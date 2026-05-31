"use client"

import { useMemo, useState, memo } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight } from "react-icons/vsc"
import { LuShieldCheck } from "react-icons/lu"
import { ToolCallDetails, getToolDetailState } from "./ToolCallDetails"
import type { InlineToolCall } from "./types"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"
export type ExecutionDisplayMode = "general" | "power"

function ToolIcon({ status }: { status: InlineToolCall["status"] }) {
  return (
    <span
      className={cn(
        "relative size-2 shrink-0 rounded-full",
        status === "running" && "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.7)] after:absolute after:inset-0 after:rounded-full after:bg-blue-400 after:animate-ping",
        status === "error" && "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.55)]",
        status === "success" && "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]"
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

function toolStatusLabel(call: InlineToolCall) {
  if (call.status === "running") return "running"
  if (call.status === "error") return "failed"
  return "done"
}

function friendlyToolText(call: InlineToolCall, subject: string) {
  const name = normalizeToolName(call.tool).toLowerCase()
  if (/read|cat|file/.test(name)) return `Read ${subject}`
  if (/write|edit|patch/.test(name)) return `Updated ${subject}`
  if (/exec|shell|bash|command/.test(name)) return `Ran ${subject}`
  if (/process|poll/.test(name)) return `Checked process ${subject}`
  if (/plan/.test(name)) return `Updated plan${subject && subject !== call.tool ? ` — ${subject}` : ""}`
  return `${toolVerb(call.tool).toLowerCase()} ${subject}`
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
    <div className={cn("rounded-md transition-colors duration-100", approval && "border border-amber-400/15 bg-amber-400/[0.035]")}>
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
          "group flex w-full items-center gap-2 bg-transparent px-1.5 py-[5px] text-left",
          open ? "rounded-t-md rounded-b-none bg-card/55" : "rounded-md",
          "cursor-pointer transition-colors duration-100",
          "hover:bg-card/55"
        )}
      >
        <ToolIcon status={call.status} />
        <span className="shrink-0 font-mono text-[11px] font-semibold tracking-[0.16em] text-amber-300/80">
          {toolVerb(call.tool)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/82">
          {subject}
        </span>
        {approval && (
          <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90">
            approval needed
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/45 tabular-nums">
          {metrics}
        </span>
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

function thinkingSummary(text: string) {
  const cleaned = text
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.slice(0, 180) || "Reasoning"
}

function ThinkingRow({
  text,
  open,
  onOpenChange,
  onInteract,
}: {
  text: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onInteract?: () => void
}) {
  return (
    <div className="rounded-md transition-colors duration-100">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onInteract?.()
          onOpenChange(!open)
        }}
        className={cn(
          "group flex w-full items-center gap-2 bg-transparent px-1.5 py-[5px] text-left",
          open ? "rounded-t-md rounded-b-none bg-card/55" : "rounded-md",
          "cursor-pointer transition-colors duration-100 hover:bg-card/55"
        )}
      >
        <span className="relative size-2 shrink-0 rounded-full bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.55)]" />
        <span className="shrink-0 font-mono text-[11px] font-semibold tracking-[0.16em] text-violet-300/85">
          THINKING
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/82">
          {thinkingSummary(text)}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/45 tabular-nums">
          {formatBytes(text.length)}
        </span>
        <span className="flex size-5 shrink-0 items-center justify-center rounded text-foreground/20 transition-colors">
          {open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-250 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "border-t border-border/10 bg-card/35 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground/80 transition-all duration-250 ease-out whitespace-pre-wrap",
              open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
            )}
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralWorkCard({
  tools,
  thinkingText,
  openItemId,
  onToolOpenChange,
  onThinkingOpenChange,
  onSelectTool,
  onInteract,
  onResolveApproval,
  sessionKey,
}: {
  tools: InlineToolCall[]
  thinkingText: string
  openItemId: string | null
  onToolOpenChange: (id: string, open: boolean) => void
  onThinkingOpenChange: (open: boolean) => void
  onSelectTool?: (id: string) => void
  onInteract?: () => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
  sessionKey?: string
}) {
  const [open, setOpen] = useState(false)
  const total = tools.length + (thinkingText ? 1 : 0)
  const failed = tools.filter((tool) => tool.status === "error").length
  const running = tools.some((tool) => tool.status === "running")
  const title = failed > 0
    ? `Hit ${failed} issue${failed === 1 ? "" : "s"} while working`
    : running
      ? "Working through the request"
      : tools.length > 0
        ? `Completed ${tools.length} step${tools.length === 1 ? "" : "s"}`
        : "Thought through the next step"

  return (
    <div className="overflow-hidden rounded-xl border border-border/35 bg-card/35">
      <button
        type="button"
        onClick={() => {
          onInteract?.()
          setOpen((value) => !value)
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-card/55"
      >
        <span className={cn(
          "size-2.5 shrink-0 rounded-full",
          failed > 0 ? "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.45)]" : running ? "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.6)]" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
        )} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-foreground/90">{title}</span>
          <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground/55">
            {total} event{total !== 1 ? "s" : ""}{failed > 0 ? ` · ${failed} failed` : running ? " · running" : ""}
          </span>
        </span>
        <span className={cn("text-muted-foreground/45 transition-transform", open && "rotate-90")}>
          <VscChevronRight className="size-3.5" />
        </span>
      </button>
      {open && (
        <div className="border-t border-border/20 px-3.5 py-2">
          {thinkingText && (
            <ThinkingRow
              text={thinkingText}
              open={openItemId === "thinking"}
              onOpenChange={onThinkingOpenChange}
              onInteract={onInteract}
            />
          )}
          {tools.map((call) => {
            const { inputText } = getToolDetailState(call)
            const subject = toolSubject(call, inputText)
            return (
              <div key={call.id} className="border-t border-border/10 first:border-t-0">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onInteract?.()
                    onToolOpenChange(call.id, openItemId !== call.id)
                  }}
                  className="flex w-full cursor-pointer items-start gap-2 py-2 text-left"
                >
                  <ToolIcon status={call.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground/82">{friendlyToolText(call, subject)}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground/50">{call.tool} · {toolStatusLabel(call)}</span>
                  </span>
                  <VscChevronRight className={cn("mt-0.5 size-3 shrink-0 text-muted-foreground/35 transition-transform", openItemId === call.id && "rotate-90")} />
                </button>
                {openItemId === call.id && (
                  <div className="pb-2">
                    <ToolCallDetails
                      call={call}
                      inputText={getToolDetailState(call).inputText}
                      outputText={getToolDetailState(call).outputText}
                      fullOutputText={getToolDetailState(call).fullOutputText}
                      sessionKey={sessionKey}
                    />
                  </div>
                )}
                {call.approval && (
                  <ToolRow
                    call={call}
                    open={false}
                    onOpenChange={onToolOpenChange}
                    onSelect={onSelectTool}
                    onInteract={onInteract}
                    onResolveApproval={onResolveApproval}
                    sessionKey={sessionKey}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const ToolCallSteps = memo(function ToolCallSteps({
  tools,
  thinkingText,
  mode = "power",
  onSelectTool,
  onInteract,
  onResolveApproval,
  sessionKey,
}: {
  tools: InlineToolCall[]
  thinkingText?: string
  mode?: ExecutionDisplayMode
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
  const trimmedThinking = thinkingText?.trim() ?? ""
  const total = orderedTools.length + (trimmedThinking ? 1 : 0)
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  function handleToolOpenChange(id: string, nextOpen: boolean) {
    onInteract?.()
    setOpenItemId(nextOpen ? id : null)
  }

  function handleThinkingOpenChange(nextOpen: boolean) {
    onInteract?.()
    setOpenItemId(nextOpen ? "thinking" : null)
  }

  if (!total) return null

  if (mode === "general") {
    return (
      <div className="mb-2 ml-1 max-w-full">
        <GeneralWorkCard
          tools={orderedTools}
          thinkingText={trimmedThinking}
          openItemId={openItemId}
          onToolOpenChange={handleToolOpenChange}
          onThinkingOpenChange={handleThinkingOpenChange}
          onSelectTool={onSelectTool}
          onInteract={onInteract}
          onResolveApproval={onResolveApproval}
          sessionKey={sessionKey}
        />
      </div>
    )
  }

  return (
    <div className="mb-2 ml-1 border-l border-border/20 pl-2">
      <div className="mb-0.5 flex items-center gap-1.5 py-1 text-muted-foreground/45">
        <span className="text-[11px] font-medium">Steps</span>
        <span className="font-mono text-[10px] tabular-nums">
          {total} event{total !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-0.5">
        {trimmedThinking && (
          <ThinkingRow
            text={trimmedThinking}
            open={openItemId === "thinking"}
            onOpenChange={handleThinkingOpenChange}
            onInteract={onInteract}
          />
        )}
        {orderedTools.map((call) => (
          <ToolRow
            key={call.id}
            call={call}
            open={openItemId === call.id}
            onOpenChange={handleToolOpenChange}
            onSelect={onSelectTool}
            onInteract={onInteract}
            onResolveApproval={onResolveApproval}
            sessionKey={sessionKey}
          />
        ))}
      </div>
    </div>
  )
})
