"use client"

import { memo, useMemo } from "react"
import { VscHubot } from "react-icons/vsc"
import { LuBrain, LuShieldCheck, LuTerminal } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallSteps } from "./ToolCallSteps"
import { SubagentCard } from "./SubagentCard"
import { formatToolSummary, summarizeTools } from "./chatRowMetadata"
import type { InlineToolCall, SpawnedSubagent, StreamStatus } from "./types"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

const EMPTY_TOOLS: InlineToolCall[] = []
const EMPTY_SUBAGENTS: SpawnedSubagent[] = []

function statusLabel(status?: StreamStatus | null, label?: string | null) {
  if (label) return label
  if (!status) return null
  if (status === "tool_running") return "Running tools"
  if (status === "thinking") return "Thinking"
  if (status === "streaming") return "Responding"
  if (status === "queued") return "Queued"
  if (status === "running") return "Running"
  if (status === "collect") return "Collecting"
  if (status === "stopping") return "Stopping"
  if (status === "restarting") return "Restarting"
  return null
}

export const WorkTimelineSpine = memo(function WorkTimelineSpine({
  reasoningText,
  reasoningDefaultOpen,
  tools,
  toolsDefaultOpen,
  subagents,
  liveStatus,
  liveStatusLabel,
  onSelectTool,
  onResolveApproval,
  onOpenSubagent,
  sessionKey,
}: {
  reasoningText?: string
  reasoningDefaultOpen?: boolean
  tools?: InlineToolCall[]
  toolsDefaultOpen?: boolean
  subagents?: SpawnedSubagent[]
  liveStatus?: StreamStatus | null
  liveStatusLabel?: string | null
  onSelectTool?: (id: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
  onOpenSubagent: (sub: SpawnedSubagent) => void
  sessionKey: string
}) {
  const trimmedReasoning = reasoningText?.trim()
  const visibleTools = tools ?? EMPTY_TOOLS
  const visibleSubagents = subagents ?? EMPTY_SUBAGENTS
  const toolSummary = useMemo(() => summarizeTools(visibleTools), [visibleTools])
  const activeSubagents = visibleSubagents.filter((sub) => isActiveSubagent(sub.status)).length
  const failedSubagents = visibleSubagents.filter((sub) => sub.status === "failed").length
  const visibleStatus = statusLabel(liveStatus, liveStatusLabel)
  const hasApproval = toolSummary.approvalNeeded > 0
  const hasWork = Boolean(trimmedReasoning) || visibleTools.length > 0 || visibleSubagents.length > 0 || Boolean(visibleStatus)

  if (!hasWork) return null

  return (
    <div className="mb-3 max-w-[85%] rounded-xl border border-border/20 bg-foreground/[0.018] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="mb-1.5 flex min-h-6 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/55">
        <span className="mr-0.5 font-medium text-muted-foreground/75">Work</span>
        {visibleStatus && (
          <span className="rounded-full border border-blue-400/15 bg-blue-400/8 px-2 py-0.5 text-blue-300/85">
            {visibleStatus}
          </span>
        )}
        {trimmedReasoning && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2 py-0.5">
            <LuBrain className="size-3" /> Thinking
          </span>
        )}
        {visibleTools.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2 py-0.5">
            <LuTerminal className="size-3" /> {formatToolSummary(toolSummary)}
          </span>
        )}
        {hasApproval && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/15 bg-amber-400/10 px-2 py-0.5 text-amber-300/90">
            <LuShieldCheck className="size-3" /> approval needed
          </span>
        )}
        {visibleSubagents.length > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2 py-0.5",
              failedSubagents > 0 && "text-rose-300/90",
              activeSubagents > 0 && failedSubagents === 0 && "text-foreground/75"
            )}
          >
            <VscHubot className="size-3" />
            {visibleSubagents.length} agent{visibleSubagents.length === 1 ? "" : "s"}
            {activeSubagents > 0 ? ` · ${activeSubagents} active` : ""}
            {failedSubagents > 0 ? ` · ${failedSubagents} failed` : ""}
          </span>
        )}
      </div>

      {trimmedReasoning && (
        <ThinkingBlock text={trimmedReasoning} defaultOpen={reasoningDefaultOpen} />
      )}
      {visibleTools.length > 0 && (
        <ToolCallSteps
          tools={visibleTools}
          defaultOpen={toolsDefaultOpen}
          onSelectTool={onSelectTool}
          onResolveApproval={onResolveApproval}
          sessionKey={sessionKey}
        />
      )}
      {visibleSubagents.length > 0 && (
        <SubagentCard subagents={visibleSubagents} onOpen={onOpenSubagent} />
      )}
    </div>
  )
})
