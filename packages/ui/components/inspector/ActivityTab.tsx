"use client"

import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronDown, VscPulse, VscSearch } from "react-icons/vsc"
import { ToolCallRow, StatusBadge, TREE_DOT_COLORS, COUNT_BADGE_COLORS } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { SubagentChatView } from "./SubagentChatView"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AgentNode, ToolCallStatus } from "./activity-types"

const MAX_VISIBLE_SUBAGENT_TABS = 4

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

function flattenAgents(nodes: AgentNode[]): AgentNode[] {
  const result: AgentNode[] = []
  for (const node of nodes) {
    if (node.id !== "root") result.push(node)
    if (node.children?.length) result.push(...flattenAgents(node.children))
  }
  return result
}

function latestActivityAt(node: AgentNode): number {
  const callTimes = node.calls.map((call) => call.startedAt ?? 0)
  const childTimes = (node.children ?? []).map(latestActivityAt)
  return Math.max(0, ...callTimes, ...childTimes)
}

function statusRank(status: ToolCallStatus): number {
  if (status === "running") return 0
  if (status === "error") return 1
  return 2
}

function sortAgentsForTabs(agents: AgentNode[]): AgentNode[] {
  return [...agents].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status)
    if (byStatus !== 0) return byStatus

    const byRecent = latestActivityAt(b) - latestActivityAt(a)
    if (byRecent !== 0) return byRecent

    return a.label.localeCompare(b.label)
  })
}

function makeVisibleAgents(
  sortedAgents: AgentNode[],
  selectedId: string,
): AgentNode[] {
  const selected = sortedAgents.find((agent) => agent.id === selectedId)
  const visible = sortedAgents.slice(0, MAX_VISIBLE_SUBAGENT_TABS)

  if (!selected || visible.some((agent) => agent.id === selected.id)) {
    return visible
  }

  return [selected, ...visible.filter((agent) => agent.id !== selected.id)].slice(
    0,
    MAX_VISIBLE_SUBAGENT_TABS,
  )
}

function AgentTab({
  node,
  active,
  onSelect,
}: {
  node: AgentNode
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      title={node.description || node.label}
      className={cn(
        "inline-flex h-8 max-w-[132px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
        active
          ? "border-white/15 bg-white/[0.08] text-foreground"
          : "border-white/8 bg-white/[0.025] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", TREE_DOT_COLORS[node.status])} />
      <span className="min-w-0 truncate">
        {node.id === "root" ? "Main" : node.label}
      </span>
    </button>
  )
}

function MoreAgentsPopover({
  agents,
  selectedId,
  onSelect,
}: {
  agents: AgentNode[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agents
    return agents.filter((agent) => {
      return (
        agent.label.toLowerCase().includes(q) ||
        agent.description?.toLowerCase().includes(q) ||
        agent.status.includes(q)
      )
    })
  }, [agents, query])

  if (agents.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.025] px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          More
          <span className="rounded bg-white/[0.06] px-1 py-0.5 text-[10px] tabular-nums">
            {agents.length}
          </span>
          <VscChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 rounded-xl border border-white/10 bg-[#151515] p-2 shadow-2xl">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-2">
          <VscSearch className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search subagents…"
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/55"
          />
        </div>

        <div className="max-h-72 overflow-y-auto pr-1">
          {filteredAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                selectedId === agent.id
                  ? "bg-white/[0.08]"
                  : "hover:bg-white/[0.045]",
              )}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TREE_DOT_COLORS[agent.status])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {agent.label}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/60">
                  {agent.description || agent.status}
                </span>
              </span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", COUNT_BADGE_COLORS[agent.status])}>
                {agent.calls.length}
              </span>
            </button>
          ))}
          {filteredAgents.length === 0 && (
            <div className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              No matching subagents
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
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
  const [filter, setFilter] = useState<"all" | "success" | "error">("all")
  const [openToolId, setOpenToolId] = useState<string | null>(null)

  function handleToolOpenChange(id: string, open: boolean) {
    setOpenToolId(open ? id : null)
  }
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
  const allSubagents = useMemo(() => sortAgentsForTabs(flattenAgents(tree)), [tree])
  const visibleSubagents = useMemo(
    () => makeVisibleAgents(allSubagents, selectedId),
    [allSubagents, selectedId],
  )
  const overflowSubagents = useMemo(() => {
    const visibleIds = new Set(visibleSubagents.map((agent) => agent.id))
    return allSubagents.filter((agent) => !visibleIds.has(agent.id))
  }, [allSubagents, visibleSubagents])

  const runningSubagentCount = allSubagents.filter((agent) => agent.status === "running").length
  const errorSubagentCount = allSubagents.filter((agent) => agent.status === "error").length

  const totalEvents = useMemo(() => {
    const count = (ns: AgentNode[]): number =>
      ns.reduce(
        (s, n) => s + n.calls.length + count(n.children ?? []),
        0,
      )
    return count(tree)
  }, [tree])

  const filteredCalls = useMemo(() => {
    if (!selectedNode) return []
    const calls = filter === "all"
      ? selectedNode.calls
      : selectedNode.calls.filter((c) => c.status === filter)
    return [...calls].reverse()
  }, [selectedNode, filter])

  const runningCount =
    selectedNode?.calls.filter((c) => c.status === "running")
      .length ?? 0
  const totalCount = selectedNode?.calls.length ?? 0
  const totalLabel =
    selectedIsSubagent && selectedSubagentSessionKey && totalCount === 0
      ? "Loading"
      : String(totalCount)

  if (sessionKey && !historyLoaded) {
    return (
      <div className="flex h-full flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/65">
          <VscPulse className="size-4 animate-pulse" />
          Loading activity for this topic…
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="rounded-xl border border-border/25 bg-card/60 p-3">
              <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
              <div className="mt-2 h-2 w-full animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </div>
    )
  }

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
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-[#121212]">
      <div className="shrink-0 border-b border-border/30 bg-card/50 px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
          {mainNode && (
            <AgentTab
              node={mainNode}
              active={selectedId === "root"}
              onSelect={(id) => onAgentSelect?.(id)}
            />
          )}
          {visibleSubagents.map((agent) => (
            <AgentTab
              key={agent.id}
              node={agent}
              active={selectedId === agent.id}
              onSelect={(id) => onAgentSelect?.(id)}
            />
          ))}
          <MoreAgentsPopover
            agents={overflowSubagents}
            selectedId={selectedId}
            onSelect={(id) => onAgentSelect?.(id)}
          />
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/65">
          <span className={cn("size-1.5 shrink-0 rounded-full", isLive ? "bg-amber-400" : "bg-muted-foreground/40")} />
          <span>{isLive ? "Live" : "Idle"}</span>
          <span className="text-muted-foreground/30">/</span>
          <span>{allSubagents.length} subagents</span>
          {runningSubagentCount > 0 && (
            <>
              <span className="text-muted-foreground/30">/</span>
              <span className="text-amber-300">{runningSubagentCount} running</span>
            </>
          )}
          {errorSubagentCount > 0 && (
            <>
              <span className="text-muted-foreground/30">/</span>
              <span className="text-rose-300">{errorSubagentCount} errors</span>
            </>
          )}
          <span className="ml-auto shrink-0 tabular-nums text-foreground/40">
            {totalEvents} events
          </span>
        </div>
      </div>

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
              <h3 className="min-w-0 truncate text-[14px] font-semibold text-foreground">
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
                {(["all", "success", "error"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      "cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                      filter === f
                        ? "bg-white/[0.08] text-foreground"
                        : "text-muted-foreground/50 hover:text-muted-foreground",
                    )}
                  >
                    {f === "all" ? "All" : f === "success" ? "Success" : "Error"}
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
                open={openToolId === call.id}
                onOpenChange={handleToolOpenChange}
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
  )
}
