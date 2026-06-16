import type { ChatMessage, InlineToolCall } from "@/components/ChatView/types"

function mergeToolCalls(
  existing: InlineToolCall[],
  incoming: InlineToolCall[]
): InlineToolCall[] {
  const merged = new Map<string, InlineToolCall>()
  for (const tool of existing) {
    merged.set(tool.id || `${tool.tool}:${merged.size}`, tool)
  }
  for (const tool of incoming) {
    const key = tool.id || `${tool.tool}:${merged.size}`
    const current = merged.get(key)
    if (!current) {
      merged.set(key, tool)
      continue
    }
    const currentTerminal = current.status === "success" || current.status === "error"
    if (currentTerminal && tool.status === "running") {
      merged.set(key, {
        ...tool,
        ...current,
        duration: current.duration ?? tool.duration,
        startedAt: current.startedAt ?? tool.startedAt,
        completedAt: current.completedAt ?? tool.completedAt,
        resultText: current.resultText ?? tool.resultText,
        awaitingResult: false,
      })
      continue
    }
    const next = { ...current, ...tool }
    if (current.duration && !tool.duration) next.duration = current.duration
    if (current.duration && current.status !== "running") {
      next.duration = current.duration
    }
    merged.set(key, next)
  }
  return Array.from(merged.values())
}

export function mergeToolCallsForDisplay(
  base?: InlineToolCall[],
  live?: InlineToolCall[]
) {
  // Skip live tools that are already completed in the base (message history)
  // to prevent the same tool card from appearing twice.
  const baseIds = new Map((base ?? []).map((tool) => [tool.id, tool]))
  const filteredLive = (live ?? []).filter((tool) => {
    const existing = baseIds.get(tool.id)
    if (!existing) return true
    // If the base already has this tool as completed, don't merge the live version
    if (existing.status === "success" || existing.status === "error") return false
    return true
  })
  return mergeToolCalls(base ?? [], filteredLive)
}

export function terminalToolStateById(messages: ChatMessage[], live?: InlineToolCall[]) {
  const terminal = new Map<string, InlineToolCall>()
  const add = (tool: InlineToolCall) => {
    if (!tool.id) return
    if (tool.status !== "success" && tool.status !== "error") return
    const current = terminal.get(tool.id)
    terminal.set(tool.id, current ? { ...current, ...tool } : tool)
  }
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const tool of message.toolCalls ?? []) add(tool)
  }
  for (const tool of live ?? []) add(tool)
  return terminal
}

export function applyTerminalToolState(
  tools: InlineToolCall[],
  terminalById: Map<string, InlineToolCall>,
  options: { finalizeStaleRunning?: boolean } = {}
) {
  if (tools.length === 0) return tools
  if (terminalById.size === 0 && !options.finalizeStaleRunning) return tools
  return tools.map((tool) => {
    const terminal = terminalById.get(tool.id)
    if (!terminal) {
      if (!options.finalizeStaleRunning || (tool.status !== "running" && !tool.awaitingResult)) return tool
      return {
        ...tool,
        status: "success" as const,
        awaitingResult: false,
      }
    }
    if (tool.status !== "running" && !tool.awaitingResult) return tool
    return {
      ...tool,
      ...terminal,
      duration: terminal.duration ?? tool.duration,
      startedAt: terminal.startedAt ?? tool.startedAt,
      completedAt: terminal.completedAt ?? tool.completedAt,
      resultText: terminal.resultText ?? tool.resultText,
      awaitingResult: false,
    }
  })
}

export function groupAssistantToolCallsByMessage(messages: ChatMessage[]) {
  const grouped = new Map<string, InlineToolCall[]>()
  const suppressed = new Set<string>()
  let firstToolMessageId: string | null = null
  let textAnchorMessageId: string | null = null
  let collected: InlineToolCall[] = []
  let collectedMessageIds: string[] = []

  function flush() {
    const anchorId = textAnchorMessageId ?? firstToolMessageId
    if (anchorId && collected.length > 0) {
      grouped.set(anchorId, collected)
      for (const messageId of collectedMessageIds) {
        if (messageId !== anchorId) suppressed.add(messageId)
      }
    }
    firstToolMessageId = null
    textAnchorMessageId = null
    collected = []
    collectedMessageIds = []
  }

  for (const message of messages) {
    if (message.role === "user") {
      flush()
      continue
    }
    if (message.role !== "assistant") continue
    if (message.text.trim()) {
      textAnchorMessageId ??= message.messageId
    }
    if (!message.toolCalls?.length) continue

    if (!firstToolMessageId) {
      firstToolMessageId = message.messageId
    }
    if (!collectedMessageIds.includes(message.messageId)) {
      collectedMessageIds.push(message.messageId)
    }
    collected = mergeToolCalls(collected, message.toolCalls)
  }

  flush()
  return { grouped, suppressed }
}
