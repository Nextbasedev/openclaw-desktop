"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChevronRight, VscChevronDown, VscCircleFilled } from "react-icons/vsc"

/* ── Mock data ── */

type ToolCallStatus = "running" | "success" | "error"

interface ToolCall {
  id: string
  tool: string
  status: ToolCallStatus
  duration?: string
  input?: Record<string, unknown>
  output?: string
}

interface AgentNode {
  id: string
  label: string
  model?: string
  status: ToolCallStatus
  calls: ToolCall[]
  children?: AgentNode[]
}

const MOCK_TREE: AgentNode[] = [
  {
    id: "root",
    label: "main",
    model: "claude-opus-4-6",
    status: "success",
    calls: [
      {
        id: "c1",
        tool: "web_search",
        status: "success",
        duration: "1.2s",
        input: { query: "next.js 15 new features" },
        output: 'Search results: 12 results found for "next.js 15 new features"...',
      },
      {
        id: "c2",
        tool: "Read",
        status: "success",
        duration: "0.1s",
        input: { path: "/root/workspace/README.md" },
        output: "# OpenClaw Desktop\n\nA modern desktop app...",
      },
      {
        id: "c3",
        tool: "exec",
        status: "error",
        duration: "3.4s",
        input: { command: "pnpm build" },
        output: "Error: Module not found 'missing-package'",
      },
    ],
    children: [
      {
        id: "sub1",
        label: "subagent:inspector-panel-build",
        model: "claude-sonnet-4-6",
        status: "running",
        calls: [
          {
            id: "s1",
            tool: "Read",
            status: "success",
            duration: "0.1s",
            input: { path: "/packages/ui/app/page.tsx" },
            output: '"use client"\n\nimport { Header } from "@/common/Header"...',
          },
          {
            id: "s2",
            tool: "Write",
            status: "running",
            input: { path: "/components/inspector/InspectorPanel.tsx" },
          },
        ],
      },
    ],
  },
]

/* ── Status badge ── */

function StatusDot({ status }: { status: ToolCallStatus }) {
  return (
    <VscCircleFilled
      className={cn("size-2 shrink-0", {
        "text-yellow-400 animate-pulse": status === "running",
        "text-emerald-400": status === "success",
        "text-red-400": status === "error",
      })}
    />
  )
}

/* ── Single tool call row ── */

function ToolCallRow({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {expanded ? (
          <VscChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <VscChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusDot status={call.status} />
        <span className="flex-1 font-mono text-[11px] text-foreground">{call.tool}</span>
        {call.duration && (
          <span className="font-mono text-[10px] text-muted-foreground">{call.duration}</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/20 bg-black/30 px-3 py-2 font-mono text-[10px]">
          {call.input && (
            <div className="mb-2">
              <span className="text-muted-foreground">INPUT</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-all text-[#7dd3fc]">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div>
              <span className="text-muted-foreground">OUTPUT</span>
              <pre
                className={cn("mt-0.5 whitespace-pre-wrap break-all", {
                  "text-emerald-300": call.status === "success",
                  "text-red-300": call.status === "error",
                  "text-yellow-300": call.status === "running",
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
    <div
      className={cn("border-b border-border/20 last:border-0", {
        "ml-3 border-l border-border/30": depth > 0,
      })}
    >
      {/* Agent header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        {expanded ? (
          <VscChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <VscChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusDot status={node.status} />
        <div className="flex flex-1 flex-col min-w-0">
          <span className="font-mono text-[11px] font-semibold text-foreground truncate">
            {node.label}
          </span>
          {node.model && (
            <span className="font-mono text-[9px] text-muted-foreground">{node.model}</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {node.calls.length} calls
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/20">
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

/* ── Activity tab ── */

export function ActivityTab() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0a0a0a]">
      {/* Live indicator */}
      <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5">
        <VscCircleFilled className="size-2 animate-pulse text-emerald-400" />
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          Live feed
        </span>
      </div>

      {/* Scrollable tree */}
      <div className="flex-1 overflow-y-auto">
        {MOCK_TREE.map((node) => (
          <AgentNodeBlock key={node.id} node={node} />
        ))}
      </div>
    </div>
  )
}
