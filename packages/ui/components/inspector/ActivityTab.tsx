"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  VscChevronRight,
  VscChevronDown,
  VscCircleFilled,
  VscPulse,
} from "react-icons/vsc"

/* ── Types ── */

type ToolCallStatus = "running" | "success" | "error"

interface ToolCall {
  id: string
  tool: string
  status: ToolCallStatus
  duration?: string
  input?: Record<string, unknown>
  output?: string
  startedAt?: number
}

interface AgentNode {
  id: string
  label: string
  model?: string
  status: ToolCallStatus
  calls: ToolCall[]
  children?: AgentNode[]
}

/* ── Build agent tree from flat tool events ── */

function buildTree(calls: ToolCall[], status: string | null): AgentNode[] {
  if (calls.length === 0) return []

  const agentStatus: ToolCallStatus =
    status === "tool_running" || status === "thinking" || status === "streaming"
      ? "running"
      : calls.some((c) => c.status === "error")
        ? "error"
        : "success"

  return [
    {
      id: "root",
      label: "main",
      status: agentStatus,
      calls,
    },
  ]
}

/* ── Status indicator ── */

function StatusIndicator({ status }: { status: ToolCallStatus }) {
  return (
    <span
      className={cn(
        "relative flex size-[7px] shrink-0",
        status === "running" && "animate-pulse",
      )}
    >
      <VscCircleFilled
        className={cn("size-[7px]", {
          "text-amber-400": status === "running",
          "text-emerald-400": status === "success",
          "text-red-400": status === "error",
        })}
      />
    </span>
  )
}

/* ── Tool call row ── */

function ToolCallRow({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group/row">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-[7px] text-left transition-colors",
          "hover:bg-secondary/30",
          expanded && "bg-secondary/20",
        )}
      >
        <span className="flex size-3.5 items-center justify-center text-muted-foreground/70">
          {expanded ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        </span>
        <StatusIndicator status={call.status} />
        <code className="flex-1 truncate text-[12px] text-foreground/90">{call.tool}</code>
        {call.duration && (
          <span className="tabular-nums text-[11px] text-muted-foreground/70">{call.duration}</span>
        )}
      </button>

      {expanded && (
        <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-border/40 bg-background/60">
          {call.input && (
            <div className="border-b border-border/30 px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Input
              </p>
              <pre className="whitespace-pre-wrap break-all text-[11px] leading-[1.5] text-sky-300/90">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div className="px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Output
              </p>
              <pre
                className={cn("whitespace-pre-wrap break-all text-[11px] leading-[1.5]", {
                  "text-emerald-300/90": call.status === "success",
                  "text-red-300/90": call.status === "error",
                  "text-amber-300/90": call.status === "running",
                })}
              >
                {call.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Agent node (recursive) ── */

function AgentNodeBlock({ node, depth = 0 }: { node: AgentNode; depth?: number }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className={cn(depth > 0 && "ml-2.5 border-l border-border/30")}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="flex size-3.5 items-center justify-center text-muted-foreground/70">
          {expanded ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        </span>
        <StatusIndicator status={node.status} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium text-foreground">{node.label}</span>
          {node.model && (
            <span className="text-[10px] text-muted-foreground/70">{node.model}</span>
          )}
        </div>
        <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {node.calls.length}
        </span>
      </button>

      {expanded && (
        <div>
          {node.calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
          {node.children?.map((child) => (
            <AgentNodeBlock key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Empty state ── */

function EmptyActivity() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <VscPulse className="size-10 text-muted-foreground/20" />
      <div>
        <p className="text-[12px] font-medium text-muted-foreground/50">No activity yet</p>
        <p className="mt-1 text-[11px] text-muted-foreground/30">
          Tool calls will appear here when a message is sent
        </p>
      </div>
    </div>
  )
}

/* ── Activity tab ── */

export function ActivityTab({ sessionKey }: { sessionKey: string | null }) {
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const callMapRef = useRef<Map<string, ToolCall>>(new Map())

  const processToolEvent = useCallback((data: Record<string, unknown>) => {
    const toolCallId = data.toolCallId as string | null
    const name = data.name as string | null
    const phase = data.phase as string | null
    if (!toolCallId || !name) return

    const map = callMapRef.current
    const existing = map.get(toolCallId)

    if (phase === "calling") {
      const call: ToolCall = {
        id: toolCallId,
        tool: name,
        status: "running",
        input: data.args as Record<string, unknown> | undefined,
        startedAt: Date.now(),
      }
      map.set(toolCallId, call)
    } else if (phase === "result") {
      const call = existing ?? { id: toolCallId, tool: name, status: "running" as ToolCallStatus }
      const duration = call.startedAt
        ? `${((Date.now() - call.startedAt) / 1000).toFixed(1)}s`
        : undefined
      const result = data.result
      const output = typeof result === "string"
        ? result
        : result != null
          ? JSON.stringify(result, null, 2)
          : undefined
      map.set(toolCallId, { ...call, status: "success", duration, output })
    } else if (phase === "error") {
      const call = existing ?? { id: toolCallId, tool: name, status: "running" as ToolCallStatus }
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

    setToolCalls(Array.from(map.values()))
  }, [])

  useEffect(() => {
    if (!sessionKey) {
      callMapRef.current.clear()
      setToolCalls([])
      setStreamStatus(null)
      return
    }

    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    const source = new EventSource(`${serverUrl}/api/stream/chat/${sessionKey}`)

    const handleTool = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data)
        processToolEvent(data)
      } catch {}
    }

    const handleStatus = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data)
        setStreamStatus((data.state as string) ?? null)
      } catch {}
    }

    source.addEventListener("chat.tool", handleTool)
    source.addEventListener("chat.status", handleStatus)

    return () => source.close()
  }, [sessionKey, processToolEvent])

  const tree = buildTree(toolCalls, streamStatus)
  const totalCalls = toolCalls.length
  const isLive = streamStatus === "thinking" || streamStatus === "tool_running" || streamStatus === "streaming"

  if (!sessionKey) return <EmptyActivity />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Live indicator bar */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <VscPulse className={cn("size-3.5", isLive ? "text-emerald-400 animate-pulse" : "text-muted-foreground/50")} />
        <span className={cn("text-[11px] font-medium", isLive ? "text-emerald-400" : "text-muted-foreground")}>
          {isLive ? "Live" : "Idle"}
        </span>
        <span className="ml-auto rounded-md bg-secondary/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {totalCalls} tool call{totalCalls !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="h-px bg-border/30" />

      {/* Scrollable tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-muted-foreground/50">
              {isLive ? "Waiting for tool calls..." : "No tool calls in this session"}
            </p>
          </div>
        ) : (
          tree.map((node) => (
            <AgentNodeBlock key={node.id} node={node} />
          ))
        )}
      </div>
    </div>
  )
}
