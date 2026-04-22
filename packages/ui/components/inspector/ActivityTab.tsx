"use client"

import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscPulse, VscSettings } from "react-icons/vsc"
import { ToolCallRow, StatusBadge, TREE_DOT_COLORS, COUNT_BADGE_COLORS } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import type { AgentNode } from "./activity-types"

function findNode(
  nodes: AgentNode[],
  id: string,
): AgentNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

function AgentTreeItem({
  node,
  isActive,
  onSelect,
}: {
  node: AgentNode
  isActive: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-all cursor-pointer",
        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
      )}
    >
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          TREE_DOT_COLORS[node.status],
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="text-[12px] font-medium text-foreground">
          {node.label}
        </span>
        {node.description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">
            {node.description.length > 60
              ? node.description.slice(0, 60) + "..."
              : node.description}
          </p>
        )}
      </div>
      <span
        className={cn(
          "mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
          COUNT_BADGE_COLORS[node.status],
        )}
      >
        {node.calls.length}
      </span>
    </button>
  )
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mainExpanded, setMainExpanded] = useState(true)
  const [filter, setFilter] = useState<"all" | "success">("all")
  const { historyLoaded, tree, isLive } = useAgentActivity(sessionKey)

  const selectedId = activeAgentId ?? "root"
  const selectedNode = findNode(tree, selectedId) ?? tree[0] ?? null
  const mainNode = tree[0] ?? null
  const childCount = mainNode?.children?.length ?? 0

  const totalEvents = useMemo(() => {
    const count = (ns: AgentNode[]): number =>
      ns.reduce(
        (s, n) => s + n.calls.length + count(n.children ?? []),
        0,
      )
    return count(tree)
  }, [tree])

  const subagentCount = useMemo(() => {
    const count = (ns: AgentNode[]): number =>
      ns.reduce(
        (s, n) =>
          s + (n.id === "root" ? 0 : 1) + count(n.children ?? []),
        0,
      )
    return count(tree)
  }, [tree])

  const filteredCalls = useMemo(() => {
    if (!selectedNode) return []
    if (filter === "all") return selectedNode.calls
    return selectedNode.calls.filter((c) => c.status === filter)
  }, [selectedNode, filter])

  const runningCount =
    selectedNode?.calls.filter((c) => c.status === "running")
      .length ?? 0
  const totalCount = selectedNode?.calls.length ?? 0

  if (!sessionKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <VscPulse className="size-5 text-muted-foreground/50" />
        <p className="text-[12px] text-muted-foreground">
          No activity yet
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#0b0c0f]">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-white/6 bg-[#0f1014]">
        <div className="border-b border-white/6 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7979a0]">
            <VscSettings className="size-3.5" />
            Agents
            <span className="ml-auto text-[10px] font-normal tracking-normal text-foreground/45">
              {subagentCount} subagents
            </span>
          </div>
        </div>

        <div className="border-b border-white/6 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] text-foreground/70">
            <span
              className={cn(
                "size-1.5 rounded-full",
                isLive ? "bg-amber-400" : "bg-muted-foreground/40",
              )}
            />
            {isLive ? "Session active" : "Session idle"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {mainNode && (
            <div>
              <button
                type="button"
                onClick={() => {
                  onAgentSelect?.("root")
                  setMainExpanded((p) => !p)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors cursor-pointer",
                  selectedId === "root"
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/[0.02]",
                )}
              >
                {mainExpanded ? (
                  <VscChevronDown className="size-3 text-muted-foreground/50" />
                ) : (
                  <VscChevronRight className="size-3 text-muted-foreground/50" />
                )}
                <span className="flex-1 text-[13px] font-semibold text-foreground">
                  Main
                </span>
                {childCount > 0 && (
                  <span className="text-[11px] text-muted-foreground/50">
                    {childCount} sub
                  </span>
                )}
              </button>

              {mainExpanded && mainNode.children && (
                <div className="ml-2 mt-1 space-y-0.5 border-l border-white/6 pl-1">
                  {mainNode.children.map((child) => (
                    <AgentTreeItem
                      key={child.id}
                      node={child}
                      isActive={selectedId === child.id}
                      onSelect={(id) => onAgentSelect?.(id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/6 px-4 py-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Activity view</span>
            <span className="text-foreground/40">
              {totalEvents} events
            </span>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#111217]">
        {!historyLoaded ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
          </div>
        ) : !selectedNode ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <VscPulse className="size-5 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              No activity
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-white/6 px-5 py-4">
              <div className="flex items-center gap-3">
                <h3 className="text-[14px] font-semibold text-foreground">
                  {selectedNode.id === "root"
                    ? "Main agent"
                    : selectedNode.label}
                </h3>
                <StatusBadge status={selectedNode.status} />
              </div>
              <div className="mt-3 flex items-center gap-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total{" "}
                  <span className="text-foreground/70">
                    {totalCount}
                  </span>
                </span>
                {runningCount > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                    Running{" "}
                    <span>{runningCount}</span>
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {(["all", "success"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors cursor-pointer",
                        filter === f
                          ? "bg-white/[0.08] text-foreground"
                          : "text-muted-foreground/50 hover:text-muted-foreground",
                      )}
                    >
                      {f === "all" ? "All" : "Success"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {filteredCalls.map((call) => (
                <ToolCallRow key={call.id} call={call} />
              ))}
              <div ref={bottomRef} className="h-px" />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
