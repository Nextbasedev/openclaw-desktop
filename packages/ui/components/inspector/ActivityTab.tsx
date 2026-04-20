"use client"

import { useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronDown,
  VscChevronRight,
  VscDebugStart,
  VscHubot,
  VscPulse,
  VscSettings,
} from "react-icons/vsc"
import { AgentNodeBlock } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { SubagentChatView } from "./SubagentChatView"
import type { AgentNode } from "./activity-types"

function EmptyActivity() {
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

function HierarchyRow({
  node,
  activeAgentId,
  onSelect,
  nested = false,
}: {
  node: AgentNode
  activeAgentId: string | null
  onSelect?: (id: string) => void
  nested?: boolean
}) {
  const isActive = activeAgentId === node.id
  const runningCount = node.calls.filter((call) => call.status === "running").length
  const errorCount = node.calls.filter((call) => call.status === "error").length
  const childCount = node.children?.length ?? 0
  const isRunning = node.status === "running" || runningCount > 0
  const hasError = node.status === "error" || errorCount > 0
  const countLabel = childCount > 0 ? `${childCount} subagents` : `${node.calls.length} calls`

  return (
    <button
      type="button"
      onClick={() => onSelect?.(node.id)}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150",
        nested && "ml-4 w-[calc(100%-1rem)] rounded-lg py-2",
        isActive
          ? "border-[#5f5cff]/35 bg-[#5f5cff]/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "border-border/10 bg-white/[0.02] text-foreground/85 hover:border-border/25 hover:bg-white/[0.045]",
      )}
    >
      {nested && (
        <span className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border/20" />
      )}

      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/10 bg-[#14151a] text-[10px] font-semibold uppercase tracking-wide text-foreground/75">
        {node.id === "root" ? "M" : node.label.slice(0, 2)}
        {isRunning && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-blue-400" />
        )}
        {hasError && !isRunning && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-rose-400" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-foreground">
            {node.id === "root" ? "Main agent" : node.label}
          </span>
          {isRunning && (
            <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-blue-300">
              live
            </span>
          )}
          {hasError && !isRunning && (
            <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-rose-300">
              error
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{countLabel}</span>
          {node.model && <span className="truncate">{node.model}</span>}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 text-[10px] text-muted-foreground">
        <span className="rounded-md bg-white/[0.04] px-1.5 py-px tabular-nums text-foreground/70">
          {node.calls.length}
        </span>
        {childCount > 0 ? (
          <VscChevronDown className="size-3 text-muted-foreground/60" />
        ) : (
          <VscChevronRight className="size-3 text-muted-foreground/35" />
        )}
      </div>
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
  const {
    historyLoaded,
    tree,
    isLive,
    agentToSessionKey,
  } = useAgentActivity(sessionKey)

  const selectedAgentId = activeAgentId ?? "root"
  const selectedNode = selectedAgentId ? findNode(tree, selectedAgentId) : tree[0] ?? null
  const isSubagent = !!selectedNode && selectedNode.id !== "root"
  const subSessionKey = isSubagent
    ? agentToSessionKey.get(selectedNode.id) ?? null
    : null

  const totalToolCalls = useMemo(() => {
    function count(nodes: AgentNode[]): number {
      return nodes.reduce((sum, node) => sum + node.calls.length + count(node.children ?? []), 0)
    }
    return count(tree)
  }, [tree])

  const subagentCount = useMemo(() => {
    function count(nodes: AgentNode[]): number {
      return nodes.reduce((sum, node) => sum + (node.id === "root" ? 0 : 1) + count(node.children ?? []), 0)
    }
    return count(tree)
  }, [tree])

  if (!sessionKey) return <EmptyActivity />

  return (
    <div className="flex h-full overflow-hidden bg-[#0b0c0f] text-foreground">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-white/6 bg-[#0f1014]">
        <div className="border-b border-white/6 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#7979a0]">
            <VscHubot className="size-3.5" />
            Agents
            <span className="ml-auto rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] tracking-normal text-foreground/55">
              {subagentCount} subagents
            </span>
          </div>
        </div>

        <div className="border-b border-white/6 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] text-foreground/75">
            <span className={cn("size-1.5 rounded-full", isLive ? "bg-emerald-400" : "bg-muted-foreground/40")} />
            <span>{isLive ? "Session active" : "Session idle"}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2.5">
          <div className="space-y-2">
            {tree.map((node) => (
              <div key={node.id} className="space-y-2">
                <HierarchyRow
                  node={node}
                  activeAgentId={selectedAgentId}
                  onSelect={onAgentSelect}
                />
                {node.children?.map((child) => (
                  <HierarchyRow
                    key={child.id}
                    node={child}
                    activeAgentId={selectedAgentId}
                    onSelect={onAgentSelect}
                    nested
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/6 px-4 py-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Activity view</span>
            <div className="flex items-center gap-1.5 text-foreground/45">
              <VscSettings className="size-3" />
              <span>{totalToolCalls} events</span>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#111217]">
        <div className="border-b border-white/6 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/6 bg-[#171922] text-[#8c8cff]">
              <VscDebugStart className={cn("size-4", isLive && "animate-pulse")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[13px] font-medium text-foreground">
                  {selectedNode?.id === "root" || !selectedNode ? "Main agent activity" : selectedNode.label}
                </h3>
                <span className="rounded-full border border-white/6 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                  {selectedNode?.calls.length ?? 0} tool calls
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isSubagent
                  ? "Subagent conversation and tool execution"
                  : "Live tool execution across the current session"}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/6 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", isLive ? "bg-blue-400" : "bg-muted-foreground/40")} />
              {isLive ? "Live" : "Idle"}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!historyLoaded ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
              <p className="text-[11px] text-muted-foreground">
                Loading activity...
              </p>
            </div>
          ) : !selectedNode ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-12">
              <VscPulse className="size-5 text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground">
                No agent activity yet
              </p>
            </div>
          ) : (
            <>
              {isSubagent && subSessionKey && (
                <SubagentChatView
                  sessionKey={subSessionKey}
                  isLive={isLive}
                />
              )}

              <div className="space-y-2">
                <AgentNodeBlock
                  key={selectedNode.id}
                  node={{ ...selectedNode, children: undefined }}
                />
                <div ref={bottomRef} className="h-px" />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
