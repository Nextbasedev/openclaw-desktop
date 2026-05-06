import { randomId } from "@/lib/id"
import {
  extractSubagentSessionKey,
  extractSubagentSessionKeys,
} from "@/lib/subagentSession"

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
  description?: string
  model?: string
  status: ToolCallStatus
  calls: ToolCall[]
  children?: AgentNode[]
}

export interface AgentInfo {
  runId: string
  phase: string
  label: string
  description?: string
  sessionKey?: string
}

type ContentBlock = {
  type?: string
  id?: string
  tool_use_id?: string
  toolUseId?: string
  name?: string
  arguments?: unknown
  args?: unknown
  input?: unknown
  text?: string
  content?: string
  output?: string
  is_error?: boolean
}

export type RawHistoryMessage = {
  id?: string
  role?: string
  toolCallId?: string
  toolName?: string
  content?: string | ContentBlock[]
  text?: string
  details?: unknown
  isError?: boolean
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

function normalizeToolContentType(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function isToolCallBlock(block: ContentBlock): boolean {
  const type = normalizeToolContentType(block.type)
  return type === "toolcall" || type === "tool_call" || type === "tooluse" || type === "tool_use"
}

function isToolResultBlock(block: ContentBlock): boolean {
  const type = normalizeToolContentType(block.type)
  return type === "toolresult" || type === "tool_result" || type === "tool_result_error"
}

function toolBlockId(block: ContentBlock): string | undefined {
  return block.id || block.tool_use_id || block.toolUseId
}

function toolBlockArgs(block: ContentBlock): unknown {
  return block.arguments ?? block.args ?? block.input ?? null
}

function toolResultBlockText(block: ContentBlock): string {
  const value = block.text ?? block.content ?? block.output
  if (typeof value === "string") return value
  if (value != null) {
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }
  return ""
}

function resultTextFromMessage(msg: RawHistoryMessage): string {
  const text = msg.text || extractResultText(msg.content)
  if (text) return text
  if (msg.details != null) {
    try { return JSON.stringify(msg.details, null, 2) } catch { return String(msg.details) }
  }
  return ""
}

function visibleTextFromMessage(msg: RawHistoryMessage): string {
  if (typeof msg.text === "string" && msg.text) return msg.text
  if (typeof msg.content === "string") return msg.content
  return extractResultText(msg.content)
}

export type HistoryParseResult = {
  calls: ToolCall[]
  agents: Map<string, AgentInfo>
  subagentSessionKeys: Map<string, string>
}

export function parseHistoryToolCalls(
  messages: RawHistoryMessage[],
): HistoryParseResult {
  const calls: ToolCall[] = []
  const agents = new Map<string, AgentInfo>()
  const subagentSessionKeys = new Map<string, string>()
  let pendingCalls: Array<{ id: string; name: string; args: unknown }> = []
  const pendingById = new Map<string, { id: string; name: string; args: unknown }>()
  const spawnOrder: string[] = []
  let currentSubagentId: string | null = null

  for (const msg of messages) {
    const text = visibleTextFromMessage(msg)

    if (msg.role === "user" && text) {
      const completed = /\bstatus:\s*completed successfully\b/i.test(text)
      const failed = /\bstatus:\s*(failed|errored|error)\b/i.test(text)
      if (completed || failed) {
        for (const key of extractSubagentSessionKeys(text)) {
          const agentId = subagentSessionKeys.get(key)
          if (!agentId) continue
          const current = agents.get(agentId)
          if (current) {
            agents.set(agentId, {
              ...current,
              phase: failed ? "error" : "done",
              sessionKey: key,
            })
          }
        }
      }
    }

    if (msg.role === "assistant") {
      const keys = extractSubagentSessionKeys(text)
      for (const key of keys) {
        if (!subagentSessionKeys.has(key) && spawnOrder.length > 0) {
          subagentSessionKeys.set(key, spawnOrder.shift()!)
        }
      }

      if (Array.isArray(msg.content)) {
        for (const b of msg.content as ContentBlock[]) {
          const blockKeys = extractSubagentSessionKeys(b)
          for (const key of blockKeys) {
            if (!subagentSessionKeys.has(key) && spawnOrder.length > 0) {
              subagentSessionKeys.set(key, spawnOrder.shift()!)
            }
          }
        }

        const tcBlocks = (msg.content as ContentBlock[]).filter(isToolCallBlock)
        if (tcBlocks.length > 0) {
          pendingCalls = tcBlocks.map((b) => ({
            id: toolBlockId(b) ?? randomId(),
            name: b.name ?? "unknown",
            args: toolBlockArgs(b),
          }))
          for (const call of pendingCalls) pendingById.set(call.id, call)
        }

        const resultBlocks = (msg.content as ContentBlock[]).filter(isToolResultBlock)
        for (const block of resultBlocks) {
          const blockId = toolBlockId(block)
          const matched = blockId
            ? pendingById.get(blockId) ?? { id: blockId, name: msg.toolName ?? "unknown", args: null }
            : pendingCalls.shift()
          if (!matched) continue
          pendingById.delete(matched.id)
          pendingCalls = pendingCalls.filter((call) => call.id !== matched.id)
          const resultText = toolResultBlockText(block)
          calls.push({
            id: matched.id,
            tool: matched.name,
            status: block.type === "tool_result_error" || block.is_error === true ? "error" : "success",
            input: matched.args as Record<string, unknown> | undefined,
            output: resultText || undefined,
            subagentOf:
              currentSubagentId &&
              matched.name !== "sessions_spawn" &&
              matched.name !== "sessions_yield"
                ? currentSubagentId
                : undefined,
          })
        }
      }
    } else if (
      msg.role === "tool" ||
      msg.role === "tool_result" ||
      msg.role === "toolResult"
    ) {
      const resultText = resultTextFromMessage(msg)
      let isError = false
      try {
        const parsed = JSON.parse(resultText)
        isError = parsed.status === "error" || msg.isError === true
      } catch {
        isError = msg.isError === true
      }

      const matched = msg.toolCallId
        ? pendingById.get(msg.toolCallId) ?? { id: msg.toolCallId, name: msg.toolName ?? "unknown", args: null }
        : pendingCalls.shift()
      if (matched) {
        pendingById.delete(matched.id)
        pendingCalls = pendingCalls.filter((call) => call.id !== matched.id)
        const call: ToolCall = {
          id: matched.id,
          tool: matched.name,
          status: isError ? "error" : "success",
          input: matched.args as Record<string, unknown> | undefined,
          output: resultText || undefined,
          subagentOf:
            currentSubagentId &&
            matched.name !== "sessions_spawn" &&
            matched.name !== "sessions_yield"
              ? currentSubagentId
              : undefined,
        }
        calls.push(call)
        if (matched.name === "sessions_spawn") {
          const args = matched.args as Record<string, unknown> | null
          const label = (args?.label as string) ?? (args?.agentId as string) ?? `sub-${matched.id.slice(-6)}`
          const task = (args?.task as string) ?? undefined
          const agentId = `spawn:${matched.id}`
          const childSessionKey = extractSubagentSessionKey(resultText)
          agents.set(agentId, {
            runId: agentId,
            phase: isError ? "error" : "start",
            label,
            description: task,
            sessionKey: childSessionKey ?? undefined,
          })
          if (childSessionKey) {
            subagentSessionKeys.set(childSessionKey, agentId)
          } else {
            spawnOrder.push(agentId)
          }
          currentSubagentId = agentId
        } else if (matched.name === "sessions_yield" && currentSubagentId) {
          const current = agents.get(currentSubagentId)
          if (current) agents.set(currentSubagentId, { ...current, phase: "done" })
          currentSubagentId = null
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
      subagentOf:
        currentSubagentId &&
        remaining.name !== "sessions_spawn" &&
        remaining.name !== "sessions_yield"
          ? currentSubagentId
          : undefined,
    })
    if (remaining.name === "sessions_spawn") {
      const args = remaining.args as Record<string, unknown> | null
      const label = (args?.label as string) ?? (args?.agentId as string) ?? `sub-${remaining.id.slice(-6)}`
      const task = (args?.task as string) ?? undefined
      const agentId = `spawn:${remaining.id}`
      agents.set(agentId, { runId: agentId, phase: "start", label, description: task })
      spawnOrder.push(agentId)
      currentSubagentId = agentId
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
      description: info.description,
      status: agentStatus(info.phase, aCalls),
      calls: aCalls,
    })
  }

  const mainPhase =
    status === "tool_running" ||
    status === "thinking" ||
    status === "streaming"
      ? "start"
      : status === "done"
        ? "done"
        : status === "error"
          ? "error"
          : mainCalls.length > 0
            ? "done"
            : null
  const mainStatus = agentStatus(mainPhase, mainCalls)
  const mainNode: AgentNode = {
    id: "root",
    label: "main",
    status: mainStatus,
    calls: mainCalls.filter((c) => c.tool !== "sessions_spawn" && c.tool !== "subagents"),
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
