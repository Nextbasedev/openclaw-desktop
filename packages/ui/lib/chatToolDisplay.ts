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

// Cache the terminal tool Map across calls so an SSE patch that only mutates
// a *running* tool (or only adds a new running tool) returns the SAME Map
// reference, letting downstream `applyTerminalToolState` callers cheap-out and
// preserving array identity for `<ToolCallSteps>` memoization. The cache is
// keyed off the live array reference and a stable scan of all terminal
// entries, so a real terminal change still produces a new Map.
let lastTerminalCache: {
  messages: ChatMessage[]
  live: InlineToolCall[] | undefined
  signature: string
  map: Map<string, InlineToolCall>
} | null = null

function collectTerminal(
  messages: ChatMessage[],
  live: InlineToolCall[] | undefined,
  visit: (tool: InlineToolCall) => void,
) {
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const tool of message.toolCalls ?? []) {
      if (!tool.id) continue
      if (tool.status !== "success" && tool.status !== "error") continue
      visit(tool)
    }
  }
  for (const tool of live ?? []) {
    if (!tool.id) continue
    if (tool.status !== "success" && tool.status !== "error") continue
    visit(tool)
  }
}

function terminalSignature(
  messages: ChatMessage[],
  live: InlineToolCall[] | undefined,
) {
  // Cheap signature of all terminal tool entries: id|status|resultLen|duration.
  // We do NOT include the running-tool stream here — that's the whole point:
  // a streaming patch that only grows a running tool's resultText must produce
  // the same signature and reuse the cached Map.
  let signature = ""
  collectTerminal(messages, live, (tool) => {
    signature += `${tool.id}|${tool.status}|${tool.resultText ? tool.resultText.length : 0}|${tool.duration ?? ""};`
  })
  return signature
}

export function terminalToolStateById(messages: ChatMessage[], live?: InlineToolCall[]) {
  const signature = terminalSignature(messages, live)
  if (
    lastTerminalCache &&
    lastTerminalCache.signature === signature
  ) {
    return lastTerminalCache.map
  }
  const terminal = new Map<string, InlineToolCall>()
  collectTerminal(messages, live, (tool) => {
    const current = terminal.get(tool.id)
    terminal.set(tool.id, current ? { ...current, ...tool } : tool)
  })
  lastTerminalCache = { messages, live, signature, map: terminal }
  return terminal
}

// Test-only escape hatch so vitest specs can reset state between tests.
export function __resetTerminalToolStateCache() {
  lastTerminalCache = null
}

export function applyTerminalToolState(
  tools: InlineToolCall[],
  terminalById: Map<string, InlineToolCall>,
  options: { finalizeStaleRunning?: boolean } = {}
) {
  if (tools.length === 0) return tools
  if (terminalById.size === 0 && !options.finalizeStaleRunning) return tools
  // Build the projected array, but only allocate a new outer array when at
  // least one tool actually changed. Preserving the input array reference when
  // nothing changed lets <ToolCallSteps>'s React.memo bail out on every SSE
  // tool patch that does not touch this message's tools — which is the common
  // case during streaming (each patch mutates one tool, while ChatView
  // re-renders every row).
  let mutated = false
  const next = tools.map((tool) => {
    const terminal = terminalById.get(tool.id)
    if (!terminal) {
      if (!options.finalizeStaleRunning || (tool.status !== "running" && !tool.awaitingResult)) return tool
      mutated = true
      return {
        ...tool,
        status: "success" as const,
        awaitingResult: false,
      }
    }
    if (tool.status !== "running" && !tool.awaitingResult) return tool
    mutated = true
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
  return mutated ? next : tools
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
