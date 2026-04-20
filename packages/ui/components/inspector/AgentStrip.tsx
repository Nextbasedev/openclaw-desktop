"use client"

import { cn } from "@/lib/utils"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import type { AgentNode } from "./activity-types"

function AgentButton({
  node,
  isActive,
  onClick,
  indent,
}: {
  node: AgentNode
  isActive: boolean
  onClick: () => void
  indent?: boolean
}) {
  const runs = node.calls.filter((c) => c.status === "running").length
  const hasError = node.calls.some((c) => c.status === "error") || node.status === "error"
  const isRunning = runs > 0 || node.status === "running"

  return (
    <button
      type="button"
      onClick={onClick}
      title={node.label}
      className={cn(
        "group relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2",
        "cursor-pointer transition-all duration-150",
        isActive
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        indent && "scale-90 opacity-80",
      )}
    >
      <div className="relative flex size-7 items-center justify-center rounded-md bg-secondary/50">
        <span className="text-[10px] font-bold uppercase">
          {node.label.slice(0, 2)}
        </span>
        {isRunning && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-blue-400 animate-pulse" />
        )}
        {hasError && !isRunning && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-rose-400" />
        )}
      </div>
      <span className="w-full truncate text-center text-[8px] font-medium leading-tight">
        {node.label}
      </span>
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-blue-400" />
      )}
    </button>
  )
}

function flattenNodes(nodes: AgentNode[]): AgentNode[] {
  const result: AgentNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children) result.push(...node.children)
  }
  return result
}

export function AgentStrip({
  sessionKey,
  activeAgentId,
  onAgentSelect,
}: {
  sessionKey: string | null
  activeAgentId: string | null
  onAgentSelect: (id: string) => void
}) {
  const { tree, isLive, toolCalls } = useAgentActivity(sessionKey)
  const allNodes = flattenNodes(tree)
  const hasSubAgents = allNodes.length > 1

  if (tree.length === 0 && !isLive) return null
  if (!hasSubAgents) return null

  return (
    <div
      className={cn(
        "flex w-11 shrink-0 flex-col items-center border-l border-border/50 bg-card/50",
        "overflow-y-auto overflow-x-hidden py-2",
      )}
    >
      <div className="mb-2 flex flex-col items-center gap-1">
        <span className="relative flex size-2">
          {isLive && (
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
          )}
          <span
            className={cn(
              "relative size-2 rounded-full",
              isLive ? "bg-blue-400" : "bg-muted-foreground/30",
            )}
          />
        </span>
        <span className="text-[7px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          {toolCalls.length}
        </span>
      </div>

      <div className="h-px w-5 bg-border/30" />

      <div className="mt-2 flex w-full flex-col gap-0.5 px-0.5">
        {tree.map((node) => (
          <div key={node.id}>
            <AgentButton
              node={node}
              isActive={activeAgentId === node.id}
              onClick={() => onAgentSelect(node.id)}
            />
            {node.children?.map((child) => (
              <AgentButton
                key={child.id}
                node={child}
                isActive={activeAgentId === child.id}
                onClick={() => onAgentSelect(child.id)}
                indent
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
