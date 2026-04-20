"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronRight,
  VscChevronDown,
  VscChip,
  VscPulse,
  VscFilter,
  VscChevronUp,
} from "react-icons/vsc"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { ToolCallRow } from "./ActivityNodes"
import type { AgentNode, ToolCall, ToolCallStatus } from "./activity-types"

function findNode(nodes: AgentNode[], id: string): AgentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

function statusDot(status: ToolCallStatus, isRunning?: boolean): string {
  if (isRunning || status === "running") return "bg-blue-400"
  if (status === "error") return "bg-rose-400"
  if (status === "success") return "bg-emerald-400"
  return "bg-muted-foreground/40"
}

function countBadgeColor(status: ToolCallStatus, runs: number): string {
  if (runs > 0) return "bg-emerald-400/15 text-emerald-400"
  if (status === "error") return "bg-rose-400/15 text-rose-400"
  if (status === "running") return "bg-amber-400/15 text-amber-400"
  return "bg-secondary/60 text-muted-foreground"
}

function AgentTreeRow({
  node,
  depth,
  isSelected,
  onSelect,
}: {
  node: AgentNode
  depth: number
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const runs = node.calls.filter((c) => c.status === "running").length
  const total = node.calls.length
  const hasChildren = (node.children?.length ?? 0) > 0
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          "group relative flex w-full items-center gap-2 py-1.5 pr-2 text-left",
          "cursor-pointer transition-colors",
          isSelected
            ? "bg-blue-500/10"
            : "hover:bg-foreground/5",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {isSelected && (
          <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-blue-400" />
        )}
        {hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((p) => !p)
            }}
            className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-foreground"
          >
            {open ? (
              <VscChevronDown className="size-3" />
            ) : (
              <VscChevronRight className="size-3" />
            )}
          </span>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}

        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            statusDot(node.status, runs > 0),
            runs > 0 && "animate-pulse",
          )}
        />

        {depth === 0 ? (
          <VscChip className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-[12px] leading-tight",
              depth === 0 ? "font-semibold text-foreground" : "text-foreground/90",
            )}
          >
            {node.label}
          </span>
          {depth > 0 && (
            <span className="truncate text-[10.5px] leading-tight text-muted-foreground/70">
              {node.calls[0]?.tool
                ? node.calls[0].tool.replace(/_/g, " ")
                : "idle"}
            </span>
          )}
        </div>

        {depth === 0 && hasChildren && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {node.children?.length} sub
          </span>
        )}
        {total > 0 && (
          <span
            className={cn(
              "rounded-md px-1.5 py-px text-[10px] tabular-nums",
              countBadgeColor(node.status, runs),
            )}
          >
            {total}
          </span>
        )}
      </button>

      {hasChildren && open && (
        <div>
          {node.children?.map((child) => (
            <AgentTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              isSelected={isSelected && false}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentTree({
  tree,
  selectedId,
  onSelect,
  isLive,
  subagentCount,
}: {
  tree: AgentNode[]
  selectedId: string
  onSelect: (id: string) => void
  isLive: boolean
  subagentCount: number
}) {
  return (
    <div className="flex h-full w-[240px] shrink-0 flex-col border-r border-border/50 bg-card/40">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300">
            <VscChip className="size-3.5" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Agents
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">
          {subagentCount} subagent{subagentCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="relative flex size-1.5">
          {isLive && (
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/70" />
          )}
          <span
            className={cn(
              "relative size-1.5 rounded-full",
              isLive ? "bg-amber-400" : "bg-muted-foreground/40",
            )}
          />
        </span>
        <span className="text-[11px] text-muted-foreground">
          {isLive ? "Session active" : "Session idle"}
        </span>
      </div>

      <div className="h-px bg-border/30" />

      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <VscPulse className="size-4 text-muted-foreground/40" />
            <p className="text-[10.5px] leading-relaxed text-muted-foreground/60">
              No agents yet
            </p>
          </div>
        ) : (
          tree.map((node) => (
            <AgentTreeRow
              key={node.id}
              node={node}
              depth={0}
              isSelected={selectedId === node.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

type StatusFilter = "all" | ToolCallStatus
type ToolFilter = "all" | string

function AgentDetail({
  node,
  isLive,
}: {
  node: AgentNode | null
  isLive: boolean
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all")

  const calls = node?.calls ?? []
  const toolKinds = useMemo(() => {
    const set = new Set<string>()
    for (const c of calls) set.add(c.tool)
    return Array.from(set)
  }, [calls])

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false
      if (toolFilter !== "all" && c.tool !== toolFilter) return false
      return true
    })
  }, [calls, statusFilter, toolFilter])

  const successCount = calls.filter((c) => c.status === "success").length
  const errorCount = calls.filter((c) => c.status === "error").length
  const runningCount = calls.filter((c) => c.status === "running").length
  const lastCall = calls[calls.length - 1]

  if (!node) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <VscPulse className="size-5 text-muted-foreground/40" />
          <p className="text-[11px] text-muted-foreground">
            Select an agent to inspect
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <h3 className="font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[13px] text-foreground">
            {node.label}
          </h3>
          <StatusPill status={node.status} />
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">
          {lastCall?.tool ? `Last: ${lastCall.tool}` : "Waiting for activity…"}
        </p>

        <div className="mt-2.5 flex items-center gap-3 text-[11px]">
          <span className="text-muted-foreground/70">TOTAL</span>
          <span className="tabular-nums text-foreground">{calls.length}</span>
          {successCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              <span className="tabular-nums">{successCount}</span>
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-rose-400">
              <span className="size-1.5 rounded-full bg-rose-400" />
              <span className="tabular-nums">{errorCount}</span>
            </span>
          )}
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400" />
              <span className="tabular-nums">{runningCount}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-y border-border/30 px-3 py-1.5">
        <VscFilter className="size-3 text-muted-foreground/70" />
        <FilterChip
          label="all"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <FilterChip
          label="success"
          active={statusFilter === "success"}
          onClick={() => setStatusFilter("success")}
        />
        {errorCount > 0 && (
          <FilterChip
            label="error"
            active={statusFilter === "error"}
            onClick={() => setStatusFilter("error")}
          />
        )}
        <div className="h-3 w-px bg-border/40" />
        <FilterChip
          label="all"
          active={toolFilter === "all"}
          onClick={() => setToolFilter("all")}
        />
        {toolKinds.slice(0, 3).map((kind) => (
          <FilterChip
            key={kind}
            label={kind}
            active={toolFilter === kind}
            onClick={() => setToolFilter(kind)}
          />
        ))}
        <button
          type="button"
          className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
          title="Collapse all"
        >
          <VscChevronUp className="size-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <VscPulse className="size-5 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              {isLive ? "Waiting for tool calls…" : "No tool calls"}
            </p>
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
        active
          ? "bg-blue-500/20 text-blue-300"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: ToolCallStatus }) {
  const map: Record<ToolCallStatus, { label: string; cls: string }> = {
    running: {
      label: "running",
      cls: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
    },
    success: {
      label: "success",
      cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    },
    error: {
      label: "error",
      cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    },
  }
  const m = map[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] ring-1",
        m.cls,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "running" && "bg-blue-400",
          status === "success" && "bg-emerald-400",
          status === "error" && "bg-rose-400",
        )}
      />
      {m.label}
    </span>
  )
}

function countSubagents(tree: AgentNode[]): number {
  let n = 0
  for (const node of tree) {
    if (node.children) n += node.children.length
  }
  return n
}

export function ActivityTab({
  sessionKey,
  activeAgentId,
  onAgentSelect,
}: {
  sessionKey: string | null
  activeAgentId: string | null
  onAgentSelect?: (id: string) => void
}) {
  const { tree, isLive, historyLoaded } = useAgentActivity(sessionKey)
  const [selectedId, setSelectedId] = useState<string>(
    activeAgentId ?? tree[0]?.id ?? "root",
  )
  const handleSelect = (id: string) => {
    setSelectedId(id)
    onAgentSelect?.(id)
  }

  const effectiveId = useMemo(() => {
    const candidate = selectedId || activeAgentId || tree[0]?.id || "root"
    if (findNode(tree, candidate)) return candidate
    return tree[0]?.id ?? "root"
  }, [selectedId, activeAgentId, tree])

  const selectedNode = findNode(tree, effectiveId)
  const subagentCount = countSubagents(tree)

  if (!sessionKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary/30 ring-1 ring-border/20">
          <VscPulse className="size-5 text-muted-foreground/50" />
        </div>
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-muted-foreground">
            No activity yet
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground/60">
            Tool calls and agent actions will appear here
          </p>
        </div>
      </div>
    )
  }

  if (!historyLoaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
        <p className="text-[11px] text-muted-foreground">Loading activity…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-row overflow-hidden">
      <AgentTree
        tree={tree}
        selectedId={effectiveId}
        onSelect={handleSelect}
        isLive={isLive}
        subagentCount={subagentCount}
      />
      <AgentDetail node={selectedNode} isLive={isLive} />
    </div>
  )
}

// Satisfy unused import guard
export type { ToolCall }
