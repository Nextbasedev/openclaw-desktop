"use client"

import { useRef } from "react"
import { cn } from "@/lib/utils"
import { VscPulse } from "react-icons/vsc"
import { AgentNodeBlock } from "./ActivityNodes"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import { SubagentChatView } from "./SubagentChatView"

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

function findNode(
  nodes: import("./activity-types").AgentNode[],
  id: string,
): import("./activity-types").AgentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

export function ActivityTab({
  sessionKey,
  activeAgentId,
}: {
  sessionKey: string | null
  activeAgentId: string | null
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const {
    toolCalls,
    historyLoaded,
    tree,
    isLive,
    agentToSessionKey,
  } = useAgentActivity(sessionKey)

  const isSubagent =
    activeAgentId && activeAgentId !== "root"
  const subSessionKey = isSubagent
    ? agentToSessionKey.get(activeAgentId) ?? null
    : null

  const filteredTree =
    isSubagent
      ? (() => {
          const node = findNode(tree, activeAgentId)
          return node
            ? [{ ...node, children: undefined }]
            : tree
        })()
      : tree

  const total = filteredTree.reduce(
    (sum, n) => sum + n.calls.length,
    0,
  )

  if (!sessionKey) return <EmptyActivity />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2">
            {isLive && (
              <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
            )}
            <span
              className={cn(
                "relative size-2 rounded-full transition-colors duration-300",
                isLive
                  ? "bg-blue-400"
                  : "bg-muted-foreground/40",
              )}
            />
          </span>
          <span
            className={cn(
              "text-[11px] font-medium transition-colors duration-300",
              isLive
                ? "text-blue-400"
                : "text-muted-foreground",
            )}
          >
            {isLive ? "Live" : "Idle"}
          </span>
          <span className="ml-auto rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {total} tool call{total !== 1 ? "s" : ""}
          </span>
        </div>

        {isLive && (
          <div className="mt-2.5 h-[2px] overflow-hidden rounded-full bg-secondary/40">
            <div className="activity-shimmer h-full w-full rounded-full" />
          </div>
        )}
      </div>

      <div className="h-px bg-border/30" />

      <div className="flex-1 overflow-y-auto p-2">
        {!historyLoaded ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
            <p className="text-[11px] text-muted-foreground">
              Loading activity...
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

            {filteredTree.length === 0 &&
            !isSubagent ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <VscPulse className="size-5 text-muted-foreground/40" />
                <p className="text-[11px] text-muted-foreground">
                  {isLive
                    ? "Waiting for tool calls..."
                    : "No tool calls yet"}
                </p>
              </div>
            ) : (
              <>
                {filteredTree.map((node) => (
                  <AgentNodeBlock
                    key={node.id}
                    node={node}
                  />
                ))}
                <div ref={bottomRef} className="h-px" />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
