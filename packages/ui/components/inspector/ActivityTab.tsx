"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { VscPulse } from "react-icons/vsc"
import type {
  ToolCall,
  ToolCallStatus,
  RawHistoryMessage,
} from "./activity-types"
import { parseHistoryToolCalls, buildTree } from "./activity-types"
import { AgentNodeBlock } from "./ActivityNodes"

function EmptyActivity() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <VscPulse className="size-10 text-muted-foreground/20" />
      <div>
        <p className="text-[12px] font-medium text-muted-foreground/50">
          No activity yet
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/30">
          Tool calls will appear here when a message is sent
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

      if (phase === "calling") {
        map.set(toolCallId, {
          id: toolCallId,
          tool: name,
          status: "running",
          input: data.args as Record<string, unknown> | undefined,
          startedAt: Date.now(),
        })
      } else if (phase === "result") {
        const call = existing ?? {
          id: toolCallId,
          tool: name,
          status: "running" as ToolCallStatus,
        }
        const duration = call.startedAt
          ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
          : undefined
        const result = data.result
        const output =
          typeof result === "string"
            ? result
            : result != null
              ? JSON.stringify(result, null, 2)
              : undefined
        map.set(toolCallId, {
          ...call,
          status: "success",
          duration,
          output,
        })
      } else if (phase === "error") {
        const call = existing ?? {
          id: toolCallId,
          tool: name,
          status: "running" as ToolCallStatus,
        }
        const duration = call.startedAt
          ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
          : undefined
        map.set(toolCallId, {
          ...call,
          status: "error",
          duration,
          output: (data.error as string) ?? "Unknown error",
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
        const history = await invoke<{
          messages: RawHistoryMessage[]
        }>("middleware_chat_history", { input: { sessionKey } })
        if (cancelled) return

        const historyCalls = parseHistoryToolCalls(
          history.messages ?? [],
        )
        for (const call of historyCalls) {
          callMapRef.current.set(call.id, call)
        }
        syncState()
        setHistoryLoaded(true)
      } catch {
        if (!cancelled) setHistoryLoaded(true)
      }
    }

    loadHistory()

    const serverUrl =
      process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    const source = new EventSource(
      `${serverUrl}/api/stream/chat/${sessionKey}`,
    )

    const handleTool = (evt: MessageEvent) => {
      if (cancelled) return
      try {
        processToolEvent(JSON.parse(evt.data))
      } catch {}
    }

    const handleStatus = (evt: MessageEvent) => {
      if (cancelled) return
      try {
        setStreamStatus(
          (JSON.parse(evt.data).state as string) ?? null,
        )
      } catch {}
    }

    source.addEventListener("chat.tool", handleTool)
    source.addEventListener("chat.status", handleStatus)

    return () => {
      cancelled = true
      source.close()
    }
  }, [sessionKey, processToolEvent, syncState])

  const tree = buildTree(toolCalls, streamStatus)
  const totalCalls = toolCalls.length
  const isLive =
    streamStatus === "thinking" ||
    streamStatus === "tool_running" ||
    streamStatus === "streaming"

  if (!sessionKey) return <EmptyActivity />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <VscPulse
          className={cn(
            "size-3.5",
            isLive
              ? "text-emerald-400 animate-pulse"
              : "text-muted-foreground/50",
          )}
        />
        <span
          className={cn(
            "text-[11px] font-medium",
            isLive ? "text-emerald-400" : "text-muted-foreground",
          )}
        >
          {isLive ? "Live" : "Idle"}
        </span>
        <span className="ml-auto rounded-md bg-secondary/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {totalCalls} tool call{totalCalls !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="h-px bg-border/30" />

      <div className="flex-1 overflow-y-auto py-1">
        {!historyLoaded ? (
          <div className="px-4 py-8 text-center">
            <div className="mx-auto mb-2 h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
            <p className="text-[11px] text-muted-foreground/50">
              Loading activity…
            </p>
          </div>
        ) : tree.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-muted-foreground/50">
              {isLive
                ? "Waiting for tool calls…"
                : "No tool calls in this session"}
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
