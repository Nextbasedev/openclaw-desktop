"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscChevronRight, VscPulse } from "react-icons/vsc"
import { ToolCallRow, StatusBadge, TREE_DOT_COLORS, COUNT_BADGE_COLORS } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { SubagentChatView } from "./SubagentChatView"
import type { AgentNode } from "./activity-types"

const AGENT_SIDEBAR_MIN = 140
const AGENT_SIDEBAR_MAX = 260
const AGENT_SIDEBAR_DEFAULT = 180

function getAgentSidebarDefaults() {
  if (typeof window === "undefined") {
    return { min: AGENT_SIDEBAR_MIN, max: AGENT_SIDEBAR_MAX, default: AGENT_SIDEBAR_DEFAULT }
  }
  if (window.innerWidth < 768) {
    return { min: 108, max: 168, default: 128 }
  }
  return { min: AGENT_SIDEBAR_MIN, max: AGENT_SIDEBAR_MAX, default: AGENT_SIDEBAR_DEFAULT }
}

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
        "flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-all cursor-pointer",
        isActive
          ? "border-white/[0.14] bg-white/5"
          : "border-transparent hover:bg-white/3",
      )}
    >
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          TREE_DOT_COLORS[node.status],
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="truncate text-[12px] font-medium text-foreground">
          {node.label}
        </span>
        {node.description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">
            {node.description}
          </p>
        )}
      </div>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
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
  focusedToolCallId,
  onClearFocusedToolCall,
}: {
  sessionKey: string | null
  activeAgentId: string | null
  onAgentSelect?: (id: string) => void
  focusedToolCallId: string | null
  onClearFocusedToolCall?: () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mainExpanded, setMainExpanded] = useState(true)
  const [filter, setFilter] = useState<"all" | "success">("all")
  const { historyLoaded, tree, isLive, agentToSessionKey } =
    useAgentActivity(sessionKey)

  const agentSidebarRef = useRef(getAgentSidebarDefaults())
  const [sidebarWidth, setSidebarWidth] = useState(agentSidebarRef.current.default)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    function onResize() {
      const next = getAgentSidebarDefaults()
      agentSidebarRef.current = next
      setSidebarWidth((prev) => Math.min(next.max, Math.max(next.min, prev)))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
      setIsDragging(true)
    },
    [sidebarWidth],
  )

  useEffect(() => {
    if (!isDragging) return
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const { min, max } = agentSidebarRef.current
      const newWidth = Math.min(max, Math.max(min, dragRef.current.startWidth + delta))
      setSidebarWidth(newWidth)
    }
    function onMouseUp() {
      setIsDragging(false)
      dragRef.current = null
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isDragging])

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
    <div className="relative flex h-full overflow-hidden">
      <div className="flex shrink-0 flex-col" style={{ width: sidebarWidth }}>
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/30 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-white">
            <span className="flex shrink-0 items-center justify-center text-white">
              <AgentHeaderIcon />
            </span>
            <span className="truncate">Agents</span>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-foreground/55">
            {subagentCount}
          </span>
        </div>

        <div className="border-b border-border/30 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/70">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                isLive ? "bg-amber-400" : "bg-muted-foreground/40",
              )}
            />
            <span className="truncate">
              {isLive ? "Session active" : "Session idle"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 py-2">
          {mainNode && (
            <div>
              <button
                type="button"
                onClick={() => {
                  onAgentSelect?.("root")
                  setMainExpanded((p) => !p)
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors cursor-pointer",
                  selectedId === "root"
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/[0.02]",
                )}
              >
                {mainExpanded ? (
                  <VscChevronDown className="size-3 shrink-0 text-muted-foreground/50" />
                ) : (
                  <VscChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                  Main
                </span>
                {childCount > 0 && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
                    {childCount}
                  </span>
                )}
              </button>

              {mainExpanded &&
                mainNode.children &&
                mainNode.children.length > 0 && (
                  <div className="ml-3 mt-1">
                    {mainNode.children.map((child, index, arr) => {
                      const isLast = index === arr.length - 1
                      return (
                        <div
                          key={child.id}
                          className={cn(
                            "relative pl-2.5",
                            !isLast && "pb-1",
                          )}
                        >
                          {isLast ? (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute left-0 top-0 h-4.5 w-2.5 rounded-bl-sm border-b border-l border-white/10"
                            />
                          ) : (
                            <>
                              <span
                                aria-hidden
                                className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-white/10"
                              />
                              <span
                                aria-hidden
                                className="pointer-events-none absolute left-0 top-4.5 h-px w-2.5 bg-white/10"
                              />
                            </>
                          )}
                          <AgentTreeItem
                            node={child}
                            isActive={selectedId === child.id}
                            onSelect={(id) => onAgentSelect?.(id)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="border-t border-border/30 px-2 py-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">Activity</span>
            <span className="shrink-0 tabular-nums text-foreground/40">
              {totalEvents}
            </span>
          </div>
        </div>
      </div>

      <div
        onMouseDown={handleDragStart}
        className="w-[3px] shrink-0 cursor-col-resize bg-transparent"
      />

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#121212]">
        {!historyLoaded ? (
          <div className="flex-1 px-3 py-4">
            <div className="mb-4 space-y-2 border-b border-border/30 px-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-24 animate-pulse rounded bg-secondary/50" />
                <div className="h-4 w-14 animate-pulse rounded-full bg-secondary/30" />
              </div>
              <div className="flex items-center gap-4 pt-1">
                <div className="h-3 w-16 animate-pulse rounded bg-secondary/40" />
                <div className="ml-auto flex gap-1">
                  <div className="h-5 w-10 animate-pulse rounded-md bg-secondary/30" />
                  <div className="h-5 w-14 animate-pulse rounded-md bg-secondary/20" />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {[28, 20, 32, 18, 24, 22, 26, 20].map((w, i) => (
                <div key={i} className="flex items-center gap-3 px-1.5 py-1">
                  <div
                    className="flex h-7 animate-pulse items-center rounded-md bg-secondary/40"
                    style={{ width: `${w * 4}px` }}
                  />
                  <div className="ml-auto flex items-center gap-3">
                    <div className="h-3 w-10 animate-pulse rounded bg-secondary/25" />
                    <div className="h-3 w-12 animate-pulse rounded bg-secondary/20" />
                  </div>
                </div>
              ))}
            </div>
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
            <div className="border-b border-border/30 px-5 py-4">
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
                <div className="mb-3 overflow-hidden rounded-xl border border-border/30 bg-[#121212]">
                  <SubagentChatView
                    sessionKey={selectedSubagentSessionKey}
                    isLive={selectedNode.status === "running"}
                  />
                </div>
              )}
              {filteredCalls.map((call) => (
                <ToolCallRow
                  key={call.id}
                  call={call}
                  focused={call.id === focusedToolCallId}
                  onFocusHandled={onClearFocusedToolCall}
                />
              ))}
              {filteredCalls.length === 0 && !selectedSubagentSessionKey && (
                <div className="flex min-h-28 items-center justify-center rounded-xl border border-border/30 bg-white/[0.02]">
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

      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  )
}
