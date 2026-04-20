export type ToolCallStatus = "running" | "success" | "error"

export interface ToolCall {
  id: string
  tool: string
  status: ToolCallStatus
  duration?: string
  input?: Record<string, unknown>
  output?: string
  startedAt?: number
  runId?: string
  subagentOf?: string
}

export interface AgentNode {
  id: string
  label: string
  model?: string
  status: ToolCallStatus
  calls: ToolCall[]
  children?: AgentNode[]
}

export interface AgentInfo {
  runId: string
  phase: string
  label: string
}

type ContentBlock = {
  type?: string
  id?: string
  name?: string
  arguments?: unknown
  input?: unknown
  text?: string
  content?: string
  output?: string
}

export type RawHistoryMessage = {
  id?: string
  role?: string
  content?: string | ContentBlock[]
  text?: string
}

function extractResultText(content?: string | ContentBlock[]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((b) => b?.text ?? b?.content ?? b?.output ?? "")
    .filter(Boolean)
    .join("\n")
}

export type HistoryParseResult = {
  calls: ToolCall[]
  agents: Map<string, AgentInfo>
  subagentSessionKeys: Map<string, string>
}

const SUBAGENT_KEY_RE = /agent:main:subagent:[0-9a-f-]{36}/g

export function parseHistoryToolCalls(
  messages: RawHistoryMessage[],
): HistoryParseResult {
  const calls: ToolCall[] = []
  const agents = new Map<string, AgentInfo>()
  const subagentSessionKeys = new Map<string, string>()
  let pendingCalls: Array<{ id: string; name: string; args: unknown }> = []
  const spawnOrder: string[] = []

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = typeof msg.content === "string"
        ? msg.content
        : (msg.text ?? "")
      const keys = text.match(SUBAGENT_KEY_RE) ?? []
      for (const key of keys) {
        if (!subagentSessionKeys.has(key) && spawnOrder.length > 0) {
          subagentSessionKeys.set(key, spawnOrder.shift()!)
        }
      }

      if (Array.isArray(msg.content)) {
        for (const b of msg.content as ContentBlock[]) {
          const blockText = b.text ?? ""
          const blockKeys = blockText.match(SUBAGENT_KEY_RE) ?? []
          for (const key of blockKeys) {
            if (!subagentSessionKeys.has(key) && spawnOrder.length > 0) {
              subagentSessionKeys.set(key, spawnOrder.shift()!)
            }
          }
        }

        const tcBlocks = (msg.content as ContentBlock[]).filter(
          (b) => b.type === "toolCall" || b.type === "tool_use",
        )
        if (tcBlocks.length > 0) {
          pendingCalls = tcBlocks.map((b) => ({
            id: b.id ?? crypto.randomUUID(),
            name: b.name ?? "unknown",
            args: b.arguments ?? b.input ?? null,
          }))
        }
      }
    } else if (
      msg.role === "tool" ||
      msg.role === "tool_result" ||
      msg.role === "toolResult"
    ) {
      const resultText = extractResultText(msg.content)
      const isError =
        resultText.includes('"status": "error"') ||
        resultText.includes('"status":"error"')

      if (pendingCalls.length > 0) {
        const matched = pendingCalls.shift()!
        calls.push({
          id: matched.id,
          tool: matched.name,
          status: isError ? "error" : "success",
          input: matched.args as Record<string, unknown> | undefined,
          output: resultText || undefined,
        })
        if (matched.name === "sessions_spawn") {
          const args = matched.args as Record<string, unknown> | null
          const label = (args?.label as string) ?? (args?.agentId as string) ?? `sub-${matched.id.slice(-6)}`
          const agentId = `spawn:${matched.id}`
          agents.set(agentId, { runId: agentId, phase: isError ? "error" : "done", label })
          const childKeyMatch = resultText.match(/"childSessionKey"\s*:\s*"([^"]+)"/)
          if (childKeyMatch) {
            subagentSessionKeys.set(childKeyMatch[1], agentId)
          } else {
            spawnOrder.push(agentId)
          }
        }
      }
    }
  }

  for (const remaining of pendingCalls) {
    calls.push({
      id: remaining.id,
      tool: remaining.name,
      status: "running",
      input: remaining.args as Record<string, unknown> | undefined,
    })
    if (remaining.name === "sessions_spawn") {
      const args = remaining.args as Record<string, unknown> | null
      const label = (args?.label as string) ?? (args?.agentId as string) ?? `sub-${remaining.id.slice(-6)}`
      const agentId = `spawn:${remaining.id}`
      agents.set(agentId, { runId: agentId, phase: "start", label })
      spawnOrder.push(agentId)
    }
  }

  return { calls, agents, subagentSessionKeys }
}

export function buildTree(
  calls: ToolCall[],
  status: string | null,
  agents: Map<string, AgentInfo>,
): AgentNode[] {
  if (calls.length === 0 && agents.size === 0) return []

  const mainCalls: ToolCall[] = []
  const agentCalls = new Map<string, ToolCall[]>()

  for (const call of calls) {
    const agentId = call.subagentOf
    if (agentId) {
      const list = agentCalls.get(agentId) ?? []
      list.push(call)
      agentCalls.set(agentId, list)
    } else {
      mainCalls.push(call)
    }
  }

  const nodes: AgentNode[] = []

  for (const [agentId, info] of agents) {
    if (agentId === "root") continue
    const aCalls = agentCalls.get(agentId) ?? []
    nodes.push({
      id: agentId,
      label: info.label || `agent-${agentId.slice(0, 8)}`,
      status: agentStatus(info.phase, aCalls),
      calls: aCalls,
    })
  }

  const mainStatus = agentStatus(
    status === "tool_running" || status === "thinking" || status === "streaming"
      ? "start"
      : null,
    mainCalls,
  )
  const mainNode: AgentNode = {
    id: "root",
    label: "main",
    status: mainStatus,
    calls: mainCalls.filter((c) => c.tool !== "sessions_spawn"),
    children: nodes.length > 0 ? nodes : undefined,
  }

  return [mainNode]
}

function agentStatus(
  phase: string | null,
  calls: ToolCall[],
): ToolCallStatus {
  if (phase === "start") return "running"
  if (phase === "error") return "error"
  if (phase === "done") return "success"
  if (calls.some((c) => c.status === "error")) return "error"
  if (calls.some((c) => c.status === "running")) return "running"
  return "success"
}
