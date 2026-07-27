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
    if (message.role !== "assistant" || !message.toolCalls?.length) continue

    if (!firstToolMessageId) {
      firstToolMessageId = message.messageId
    } else {
      suppressed.add(message.messageId)
    }
    collected = mergeToolCalls(collected, message.toolCalls)
  }

  flush()
  return { grouped, suppressed }
}
