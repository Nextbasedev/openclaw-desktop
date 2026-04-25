"use client"

import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscPulse } from "react-icons/vsc"
import { ToolCallRow, StatusBadge, TREE_DOT_COLORS, COUNT_BADGE_COLORS } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { SubagentChatView } from "./SubagentChatView"
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

function AgentHeaderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 1.5 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[18px] w-[18px]"
    >
      <g clipPath="url(#agent-header-icon-clip)">
        <path d="M10.5007 3.8335H3.50065C2.85632 3.8335 2.33398 4.35583 2.33398 5.00016V12.0002C2.33398 12.6445 2.85632 13.1668 3.50065 13.1668H10.5007C11.145 13.1668 11.6673 12.6445 11.6673 12.0002V5.00016C11.6673 4.35583 11.145 3.8335 10.5007 3.8335Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.16667 6.75H5.83333C5.51117 6.75 5.25 7.01117 5.25 7.33333V9.66667C5.25 9.98883 5.51117 10.25 5.83333 10.25H8.16667C8.48883 10.25 8.75 9.98883 8.75 9.66667V7.33333C8.75 7.01117 8.48883 6.75 8.16667 6.75Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.75 2.6665V3.83317" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.75 13.1665V14.3332" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1.16602 10.25H2.33268" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1.16602 6.75H2.33268" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.666 10.25H12.8327" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.666 6.75H12.8327" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.25 2.6665V3.83317" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.25 13.1665V14.3332" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <defs>
        <clipPath id="agent-header-icon-clip">
          <rect width="14" height="14" fill="white" transform="translate(0 1.5)" />
        </clipPath>
      </defs>
    </svg>
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
  const { historyLoaded, tree, isLive, agentToSessionKey } =
    useAgentActivity(sessionKey)

  const selectedId = activeAgentId ?? "root"
  const selectedNode = findNode(tree, selectedId) ?? tree[0] ?? null
  const selectedSubagentSessionKey =
    selectedNode && selectedNode.id !== "root"
      ? agentToSessionKey.get(selectedNode.id) ?? null
      : null
  const selectedIsSubagent = Boolean(selectedNode && selectedNode.id !== "root")
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
  const totalLabel =
    selectedIsSubagent && selectedSubagentSessionKey && totalCount === 0
      ? "Loading"
      : String(totalCount)

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
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-white/6 bg-[#0f1014] max-md:w-[168px]">
        <div className="border-b border-white/6 px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7979a0] max-md:tracking-[0.14em]">
              <span className="flex shrink-0 items-center justify-center text-[#9a9ad2]">
                <AgentHeaderIcon />
              </span>
              <span className="truncate">Agents</span>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-foreground/55 max-md:px-1.5">
              <span className="md:hidden">{subagentCount} sub</span>
              <span className="max-md:hidden">{subagentCount} subagents</span>
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
                    {totalLabel}
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
              {selectedSubagentSessionKey && (
                <div className="mb-3 overflow-hidden rounded-xl border border-white/8 bg-[#0d0e12]">
                  <SubagentChatView
                    sessionKey={selectedSubagentSessionKey}
                    isLive={selectedNode.status === "running"}
                  />
                </div>
              )}
              {filteredCalls.map((call) => (
                <ToolCallRow key={call.id} call={call} />
              ))}
              {filteredCalls.length === 0 && !selectedSubagentSessionKey && (
                <div className="flex min-h-28 items-center justify-center rounded-xl border border-white/6 bg-white/[0.02]">
                  <p className="text-[11px] text-muted-foreground">
                    {selectedIsSubagent
                      ? "Waiting for sub-agent activity..."
                      : "No tool activity for this agent yet"}
                  </p>
                </div>
              )}
              <div ref={bottomRef} className="h-px" />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
