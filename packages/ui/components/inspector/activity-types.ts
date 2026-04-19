export type ToolCallStatus = "running" | "success" | "error"

export interface ToolCall {
  id: string
  tool: string
  status: ToolCallStatus
  duration?: string
  input?: Record<string, unknown>
  output?: string
  startedAt?: number
}

export interface AgentNode {
  id: string
  label: string
  model?: string
  status: ToolCallStatus
  calls: ToolCall[]
  children?: AgentNode[]
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

export function parseHistoryToolCalls(
  messages: RawHistoryMessage[],
): ToolCall[] {
  const calls: ToolCall[] = []
  let pendingCalls: Array<{ id: string; name: string; args: unknown }> = []

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
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
  }

  return calls
}

export function buildTree(
  calls: ToolCall[],
  status: string | null,
): AgentNode[] {
  if (calls.length === 0) return []

  const agentStatus: ToolCallStatus =
    status === "tool_running" ||
    status === "thinking" ||
    status === "streaming"
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
