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

export function mergeActiveTurnToolCalls(
  messages: ChatMessage[],
  pendingTools: InlineToolCall[]
) {
  const merged = new Map<string, InlineToolCall>()

  const add = (tool: InlineToolCall) => {
    const existing = merged.get(tool.id)
    if (!existing) {
      merged.set(tool.id, tool)
      return
    }
    const existingTerminal = existing.status === "success" || existing.status === "error"
    if (existingTerminal && tool.status === "running") {
      merged.set(tool.id, {
        ...tool,
        ...existing,
        duration: existing.duration ?? tool.duration,
        startedAt: existing.startedAt ?? tool.startedAt,
        completedAt: existing.completedAt ?? tool.completedAt,
        resultText: existing.resultText ?? tool.resultText,
        approval: existing.approval ?? tool.approval,
        awaitingResult: false,
      })
      return
    }
    merged.set(tool.id, {
      ...existing,
      ...tool,
      duration: tool.duration ?? existing.duration,
      startedAt: tool.startedAt ?? existing.startedAt,
      completedAt: tool.completedAt ?? existing.completedAt,
      resultText: tool.resultText ?? existing.resultText,
      approval: tool.approval ?? existing.approval,
      awaitingResult: tool.resultText ? false : (tool.awaitingResult ?? existing.awaitingResult),
    })
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const tool of message.toolCalls ?? []) add(tool)
  }
  for (const tool of pendingTools) add(tool)
  return Array.from(merged.values())
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
  let collected: InlineToolCall[] = []

  function flush() {
    if (firstToolMessageId && collected.length > 0) {
      grouped.set(firstToolMessageId, collected)
    }
    firstToolMessageId = null
    collected = []
  }

  for (const message of messages) {
    if (message.role === "user") {
      flush()
      continue
    }
    if (message.role !== "assistant") continue
    const tools = message.toolCalls ?? []
    const hasText = message.text.trim().length > 0
    const hasTools = tools.length > 0
    if (hasText && hasTools && firstToolMessageId && collected.length > 0) {
      // Reloaded canonical history can attach the same completed tool summary
      // to the final text message after earlier tool-only rows. Keep one stack
      // above the answer text instead of rendering a duplicate stack directly
      // before the final response.
      suppressed.add(message.messageId)
      collected = mergeToolCalls(collected, tools)
      flush()
      continue
    }
    if (hasText) {
      // Assistant text is the visible boundary of a response segment. Do not
      // keep merging later tool activity into the earlier steps block, or one
      // new running tool makes the completed steps above old answers look like
      // they are loading again.
      flush()
    }
    if (!hasTools) continue

    if (!firstToolMessageId) {
      firstToolMessageId = message.messageId
    } else {
      suppressed.add(message.messageId)
    }
    collected = mergeToolCalls(collected, tools)
  }

  flush()
  return { grouped, suppressed }
}
