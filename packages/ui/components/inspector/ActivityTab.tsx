"use client"

import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscArrowLeft, VscChevronDown, VscPulse, VscSearch } from "react-icons/vsc"
import { StatusBadge, TREE_DOT_COLORS, COUNT_BADGE_COLORS } from "./ActivityNodes"
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
  onSelect: (id: string, sessionKey?: string | null, label?: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id, undefined, node.label)}
      title={node.description || node.label}
      className={cn(
        "inline-flex h-8 max-w-[132px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
        active
          ? "border-black/15 bg-black/[0.055] text-foreground dark:border-white/15 dark:bg-white/[0.08]"
          : "border-black/8 bg-black/[0.025] text-muted-foreground hover:bg-black/[0.045] hover:text-foreground dark:border-white/8 dark:bg-white/[0.025] dark:hover:bg-white/[0.05]",
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
  onSelect: (id: string, sessionKey?: string | null, label?: string) => void
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
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-black/8 bg-black/[0.025] dark:border-white/8 dark:bg-white/[0.025] px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.05] hover:text-foreground"
        >
          More
          <span className="rounded bg-black/[0.045] dark:bg-white/[0.06] px-1 py-0.5 text-[10px] tabular-nums">
            {agents.length}
          </span>
          <VscChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 rounded-xl border border-black/[0.10] bg-[var(--glass-bg)] dark:border-white/10 dark:bg-[#151515] p-2 shadow-2xl">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-black/[0.08] bg-black/[0.035] dark:border-white/8 dark:bg-black/20 px-2">
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
              onClick={() => onSelect(agent.id, agent.sessionKey ?? null, agent.label)}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                selectedId === agent.id
                  ? "bg-black/[0.055] dark:bg-white/[0.08]"
                  : "hover:bg-black/[0.04] dark:hover:bg-white/[0.045]",
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

function SubagentDashboardCard({
  node,
  active,
  onSelect,
}: {
  node: AgentNode
  active: boolean
  onSelect: (id: string, sessionKey?: string | null, label?: string) => void
}) {
  const running = node.calls.filter((call) => call.status === "running").length
  const errors = node.calls.filter((call) => call.status === "error").length
  const latest = latestActivityAt(node)

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id, node.sessionKey ?? null, node.label)}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border px-4 py-3.5 text-left transition-all",
        "bg-gradient-to-br from-black/[0.035] to-black/[0.012] shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:from-white/[0.055] dark:to-white/[0.018] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        active
          ? "border-foreground/22 ring-1 ring-foreground/10"
          : "border-border/35 hover:border-border/70 hover:bg-black/[0.045] dark:hover:bg-white/[0.05]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1 size-2 shrink-0 rounded-full shadow-[0_0_12px_currentColor]", TREE_DOT_COLORS[node.status])} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {node.label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">
            {node.description || "Sub-agent session"}
          </p>
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/55">
        <span>{node.calls.length} events</span>
        {running > 0 && <span className="text-amber-300">{running} running</span>}
        {errors > 0 && <span className="text-rose-300">{errors} errors</span>}
        {node.model && <span>{node.model}</span>}
        {node.sessionKey && <span title={node.sessionKey}>linked</span>}
        {latest > 0 && <span className="ml-auto normal-case tracking-normal">{new Date(latest).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
    </button>
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
  onAgentSelect?: (id: string, sessionKey?: string | null, label?: string) => void
  focusedToolCallId: string | null
  onClearFocusedToolCall?: () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { historyLoaded, tree, isLive, agentToSessionKey } =
    useAgentActivity(sessionKey)

  const allSubagents = useMemo(() => sortAgentsForTabs(flattenAgents(tree)), [tree])
  const selectedId = activeAgentId ?? "root"
  const selectedNode = selectedId === "root" ? null : findNode(tree, selectedId)
  const selectedSubagentSessionKey =
    selectedNode && selectedNode.id !== "root"
      ? agentToSessionKey.get(selectedNode.id) ?? null
      : null

  const runningSubagentCount = allSubagents.filter((agent) => agent.status === "running").length
  const errorSubagentCount = allSubagents.filter((agent) => agent.status === "error").length
  const completedSubagentCount = allSubagents.filter((agent) => agent.status === "success").length

  const totalEvents = useMemo(() => {
    const count = (ns: AgentNode[]): number =>
      ns.reduce(
        (s, n) => s + n.calls.length + count(n.children ?? []),
        0,
      )
    return count(tree)
  }, [tree])

  if (sessionKey && !historyLoaded) {
    return (
      <div className="flex h-full flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/65">
          <VscPulse className="size-4 animate-pulse" />
          Loading subagents for this topic…
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
          No subagents yet
        </p>
      </div>
    )
  }

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-background dark:bg-[#121212]">
      <div className="shrink-0 border-b border-border/30 bg-card/45 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">
              <span className={cn("size-1.5 rounded-full", isLive ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.55)]" : "bg-muted-foreground/35")} />
              {isLive ? "Live subagent monitor" : "Subagent monitor"}
            </div>
            <h2 className="mt-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              Subagents
            </h2>
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-1.5 text-center font-mono text-[10px] tabular-nums">
            <div className="rounded-lg border border-border/30 bg-black/[0.025] dark:bg-white/[0.025] px-2 py-1.5">
              <p className="text-foreground">{allSubagents.length}</p>
              <p className="uppercase tracking-wider text-muted-foreground/45">total</p>
            </div>
            <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.045] px-2 py-1.5">
              <p className="text-amber-300">{runningSubagentCount}</p>
              <p className="uppercase tracking-wider text-muted-foreground/45">run</p>
            </div>
            <div className="rounded-lg border border-emerald-300/15 bg-emerald-300/[0.04] px-2 py-1.5">
              <p className="text-emerald-300">{completedSubagentCount}</p>
              <p className="uppercase tracking-wider text-muted-foreground/45">done</p>
            </div>
            <div className="rounded-lg border border-rose-300/15 bg-rose-300/[0.045] px-2 py-1.5">
              <p className="text-rose-300">{errorSubagentCount}</p>
              <p className="uppercase tracking-wider text-muted-foreground/45">err</p>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
          <span>{totalEvents} total events</span>
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
      ) : selectedSubagentSessionKey && selectedNode ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-12 items-center gap-3 border-b border-border/30 bg-background px-4 dark:bg-[#121212]">
            <button
              type="button"
              onClick={() => onAgentSelect?.("root")}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.055] dark:hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Back to subagents"
            >
              <VscArrowLeft className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{selectedNode.label}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground/55">Subagent chat</p>
            </div>
            <StatusBadge status={selectedNode.status} />
          </div>
          <SubagentChatView
            sessionKey={selectedSubagentSessionKey}
            isLive={selectedNode.status === "running"}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {allSubagents.length > 0 ? (
            <div className="space-y-3">
              {allSubagents.map((agent) => (
                <SubagentDashboardCard
                  key={agent.id}
                  node={agent}
                  active={false}
                  onSelect={(id, subagentSessionKey, label) => onAgentSelect?.(id, subagentSessionKey, label)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-border/30 bg-black/[0.02] dark:bg-white/[0.02]">
              <p className="text-[12px] text-muted-foreground">
                No subagents spawned yet
              </p>
            </div>
          )}
            <div ref={bottomRef} className="h-px" />
        </div>
      )}
    </section>
  )
}
