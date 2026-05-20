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
  return mergeToolCalls(base ?? [], live ?? [])
}

export function groupAssistantToolCallsByMessage(messages: ChatMessage[]) {
  const grouped = new Map<string, InlineToolCall[]>()
  const suppressed = new Set<string>()
  let block: ChatMessage[] = []

  function flush() {
    if (block.length === 0) return
    const toolMessages = block.filter((message) => message.toolCalls?.length)
    if (toolMessages.length === 0) {
      block = []
      return
    }

    const textTarget = block.find(
      (message) => message.role === "assistant" && message.text.trim().length > 0
    )
    const fallbackToolTarget = toolMessages[0]
    const target = textTarget ?? fallbackToolTarget
    const collected = toolMessages.reduce<InlineToolCall[]>(
      (acc, message) => mergeToolCalls(acc, message.toolCalls ?? []),
      []
    )

    grouped.set(target.messageId, collected)
    for (const message of toolMessages) {
      if (message.messageId === target.messageId) continue
      if (!message.text.trim()) suppressed.add(message.messageId)
    }
    if (textTarget) {
      for (const message of toolMessages) {
        if (!message.text.trim()) suppressed.add(message.messageId)
      }
    }
    block = []
  }

  for (const message of messages) {
    if (message.role === "user") {
      flush()
      continue
    }
    if (message.role === "assistant") block.push(message)
  }

  flush()
  return { grouped, suppressed }
}
