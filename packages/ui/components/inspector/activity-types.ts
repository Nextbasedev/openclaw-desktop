import { randomId } from "../../lib/id"
import {
  extractSubagentSessionKey,
  extractSubagentSessionKeys,
} from "../../lib/subagentSession"

export type ToolCallStatus = "running" | "success" | "error"

export interface ToolCall {
  id: string
  tool: string
  status: ToolCallStatus
  duration?: string
  input?: Record<string, unknown>
  output?: string
  startedAt?: number
  completedAt?: number
  messageId?: string
  messageIndex?: number
  messagePreview?: string
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
  isError?: boolean
  status?: unknown
  duration?: string
  durationMs?: number
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
  error?: unknown
  status?: unknown
  timestamp?: number
  createdAt?: string
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

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function messageTimestampMs(msg: RawHistoryMessage): number | undefined {
  if (typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp)) return msg.timestamp
  if (msg.createdAt) {
    const parsed = Date.parse(msg.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function formatDuration(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 100) return "0.1s"
  return `${(ms / 1000).toFixed(1)}s`
}

function resultDurationMs(msg: RawHistoryMessage, resultText: string): number | undefined {
  const detailsDuration = objectValue(msg.details, "durationMs") ?? objectValue(msg.details, "tookMs")
  if (typeof detailsDuration === "number" && Number.isFinite(detailsDuration)) return detailsDuration
  try {
    const parsed = JSON.parse(resultText)
    const duration = objectValue(parsed, "durationMs") ?? objectValue(parsed, "tookMs")
    if (typeof duration === "number" && Number.isFinite(duration)) return duration
  } catch {}
  return undefined
}

function resultStatus(msg: RawHistoryMessage, resultText: string): ToolCallStatus {
  if (msg.isError === true || msg.status === "error" || msg.error) return "error"
  const detailStatus = objectValue(msg.details, "status")
  const detailExitCode = objectValue(msg.details, "exitCode")
  if (detailStatus === "error" || detailStatus === "failed") return "error"
  if (typeof detailExitCode === "number" && Number.isFinite(detailExitCode) && detailExitCode !== 0) return "error"
  if (resultText) {
    try {
      const parsed = JSON.parse(resultText)
      const parsedStatus = objectValue(parsed, "status")
      const parsedExitCode = objectValue(parsed, "exitCode")
      if (parsedStatus === "error" || parsedStatus === "failed" || objectValue(parsed, "error")) return "error"
      if (typeof parsedExitCode === "number" && Number.isFinite(parsedExitCode) && parsedExitCode !== 0) return "error"
    } catch {
      if (/^\s*(error|failed|exception|traceback)\b/i.test(resultText)) return "error"
    }
  }
  return "success"
}

function previewText(value: string): string | undefined {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
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
  let pendingCalls: Array<{ id: string; name: string; args: unknown; startedAt?: number; duration?: string; status?: ToolCallStatus; messageId?: string; messageIndex?: number; messagePreview?: string }> = []
  const pendingById = new Map<string, { id: string; name: string; args: unknown; startedAt?: number; duration?: string; status?: ToolCallStatus; messageId?: string; messageIndex?: number; messagePreview?: string }>()
  const spawnOrder: string[] = []
  let currentSubagentId: string | null = null
  let latestUserPreview: string | undefined
  let latestUserMessageId: string | undefined
  let latestUserMessageIndex: number | undefined

  for (const [messageIndex, msg] of messages.entries()) {
    const text = visibleTextFromMessage(msg)

    if (msg.role === "user" && text) {
      if (!/<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>/.test(text)) {
        latestUserPreview = previewText(text)
        latestUserMessageId = msg.id
        latestUserMessageIndex = messageIndex
      }
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
          const startedAt = messageTimestampMs(msg)
          pendingCalls = tcBlocks.map((b) => ({
            id: toolBlockId(b) ?? randomId(),
            name: b.name ?? "unknown",
            args: toolBlockArgs(b),
            startedAt,
            duration: b.duration,
            status: b.is_error === true || b.isError === true || b.status === "error" ? "error" : undefined,
            messageId: latestUserMessageId ?? msg.id,
            messageIndex: latestUserMessageIndex ?? messageIndex,
            messagePreview: latestUserPreview,
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
            status: block.type === "tool_result_error" || block.is_error === true ? "error" : (matched.status ?? "success"),
            duration: matched.duration,
            input: matched.args as Record<string, unknown> | undefined,
            output: resultText || undefined,
            startedAt: matched.startedAt,
            messageId: matched.messageId,
            messageIndex: matched.messageIndex,
            messagePreview: matched.messagePreview,
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
      const status = resultStatus(msg, resultText)

      const matched = msg.toolCallId
        ? pendingById.get(msg.toolCallId) ?? { id: msg.toolCallId, name: msg.toolName ?? "unknown", args: null }
        : pendingCalls.shift()
      if (matched) {
        pendingById.delete(matched.id)
        pendingCalls = pendingCalls.filter((call) => call.id !== matched.id)
        const call: ToolCall = {
          id: matched.id,
          tool: matched.name,
          status,
          duration:
            matched.duration ??
            formatDuration(
              resultDurationMs(msg, resultText) ??
                (messageTimestampMs(msg) !== undefined &&
                matched.startedAt !== undefined
                  ? messageTimestampMs(msg)! - matched.startedAt
                  : undefined),
            ),
          input: matched.args as Record<string, unknown> | undefined,
          output: resultText || undefined,
          startedAt: matched.startedAt,
          completedAt: messageTimestampMs(msg),
          messageId: matched.messageId,
          messageIndex: matched.messageIndex,
          messagePreview: matched.messagePreview,
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
            phase: status === "error" ? "error" : "start",
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
      status: remaining.status ?? "running",
      duration: remaining.duration,
      input: remaining.args as Record<string, unknown> | undefined,
      startedAt: remaining.startedAt,
      messageId: remaining.messageId,
      messageIndex: remaining.messageIndex,
      messagePreview: remaining.messagePreview,
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

export function finalizeStaleRunningActivity(
  calls: ToolCall[],
  agents: Map<string, AgentInfo>,
): { calls: ToolCall[]; agents: Map<string, AgentInfo> } {
  return {
    calls: calls.map((call) =>
      call.status === "running" ? { ...call, status: "success" } : call,
    ),
    agents: new Map(
      Array.from(agents.entries()).map(([id, info]) => [
        id,
        info.phase === "start" || info.phase === "working"
          ? { ...info, phase: "done" }
          : info,
      ]),
    ),
  }
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
