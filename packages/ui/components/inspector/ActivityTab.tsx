"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { VscPulse } from "react-icons/vsc"
import type { ToolCall, RawHistoryMessage } from "./activity-types"
import { parseHistoryToolCalls, buildTree } from "./activity-types"
import { AgentNodeBlock } from "./ActivityNodes"

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

export function ActivityTab({
  sessionKey,
}: {
  sessionKey: string | null
}) {
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const callMapRef = useRef<Map<string, ToolCall>>(new Map())
  const bottomRef = useRef<HTMLDivElement>(null)

  const syncState = useCallback(() => {
    setToolCalls(Array.from(callMapRef.current.values()))
  }, [])

  const processToolEvent = useCallback(
    (data: Record<string, unknown>) => {
      const toolCallId = data.toolCallId as string | null
      const name = data.name as string | null
      const phase = data.phase as string | null
      if (!toolCallId || !name) return
      const map = callMapRef.current
      const existing = map.get(toolCallId)
      const fallback: ToolCall = { id: toolCallId, tool: name, status: "running" }

      if (phase === "calling") {
        map.set(toolCallId, {
          ...fallback,
          input: data.args as Record<string, unknown> | undefined,
          startedAt: Date.now(),
        })
      } else if (phase === "result" || phase === "error") {
        const call = existing ?? fallback
        const duration = call.startedAt
          ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
          : undefined
        const result = data.result
        const output = phase === "error"
          ? ((data.error as string) ?? "Unknown error")
          : typeof result === "string" ? result
            : result != null ? JSON.stringify(result, null, 2) : undefined
        map.set(toolCallId, {
          ...call,
          status: phase === "error" ? "error" : "success",
          duration,
          output,
        })
      }
      syncState()
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
      })
    },
    [syncState],
  )

  useEffect(() => {
    if (!sessionKey) {
      callMapRef.current.clear()
      setToolCalls([])
      setStreamStatus(null)
      setHistoryLoaded(false)
      return
    }
    callMapRef.current.clear()
    setToolCalls([])
    setHistoryLoaded(false)
    let cancelled = false

    async function loadHistory() {
      try {
        const history = await invoke<{ messages: RawHistoryMessage[] }>(
          "middleware_chat_history", { input: { sessionKey } },
        )
        if (cancelled) return
        for (const call of parseHistoryToolCalls(history.messages ?? [])) {
          callMapRef.current.set(call.id, call)
        }
        syncState()
        setHistoryLoaded(true)
      } catch {
        if (!cancelled) setHistoryLoaded(true)
      }
    }

    loadHistory()
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    const source = new EventSource(`${serverUrl}/api/stream/chat/${sessionKey}`)

    const handleTool = (evt: MessageEvent) => {
      if (cancelled) return
      try { processToolEvent(JSON.parse(evt.data)) } catch {}
    }
    const handleStatus = (evt: MessageEvent) => {
      if (cancelled) return
      try { setStreamStatus((JSON.parse(evt.data).state as string) ?? null) } catch {}
    }

    source.addEventListener("chat.tool", handleTool)
    source.addEventListener("chat.status", handleStatus)
    return () => { cancelled = true; source.close() }
  }, [sessionKey, processToolEvent, syncState])

  const tree = buildTree(toolCalls, streamStatus)
  const total = toolCalls.length
  const isLive =
    streamStatus === "thinking" ||
    streamStatus === "tool_running" ||
    streamStatus === "streaming"

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
                isLive ? "bg-blue-400" : "bg-muted-foreground/40",
              )}
            />
          </span>
          <span
            className={cn(
              "text-[11px] font-medium transition-colors duration-300",
              isLive ? "text-blue-400" : "text-muted-foreground",
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
              Loading activity…
            </p>
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <VscPulse className="size-5 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              {isLive ? "Waiting for tool calls…" : "No tool calls yet"}
            </p>
          </div>
        ) : (
          <>
            {tree.map((node) => (
              <AgentNodeBlock key={node.id} node={node} />
            ))}
            <div ref={bottomRef} className="h-px" />
          </>
        )}
      </div>
    </div>
  )
}
