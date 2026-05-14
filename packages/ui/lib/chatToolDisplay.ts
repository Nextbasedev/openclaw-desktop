import type { ChatMessage, InlineToolCall } from "../components/ChatView/types"

function mergeToolCalls(base: InlineToolCall[], live: InlineToolCall[] = []) {
  const merged = new Map<string, InlineToolCall>()
  const fallbackKey = (tool: InlineToolCall) => tool.id || `${tool.tool}:${merged.size}`
  for (const tool of base) merged.set(fallbackKey(tool), tool)
  for (const tool of live) {
    const key = fallbackKey(tool)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, tool)
      continue
    }
    const next = { ...existing, ...tool }
    if (existing.duration && !tool.duration) next.duration = existing.duration
    if (existing.duration && existing.status !== "running") next.duration = existing.duration
    if (existing.resultText && !tool.resultText) next.resultText = existing.resultText
    if (existing.approval && !tool.approval) next.approval = existing.approval
    merged.set(key, next)
  }
  return Array.from(merged.values())
}

function assistantTurnBounds(messages: ChatMessage[], index: number) {
  let start = index
  while (start > 0 && messages[start - 1]?.role !== "user") start--
  let end = index
  while (end + 1 < messages.length && messages[end + 1]?.role !== "user") end++
  return { start, end }
}

function latestAssistantIndexInRange(messages: ChatMessage[], start: number, end: number) {
  for (let i = end; i >= start; i--) {
    if (messages[i]?.role === "assistant") return i
  }
  return -1
}

export function toolCallsForResponseStack(params: {
  messages: ChatMessage[]
  index: number
  liveTools: InlineToolCall[]
  isGenerating: boolean
}) {
  const { messages, index, liveTools, isGenerating } = params
  const message = messages[index]
  if (!message) return []

  if (message.role === "user") {
    const isLast = index === messages.length - 1
    return isLast && isGenerating ? liveTools : []
  }

  if (message.role !== "assistant") return message.toolCalls ?? []

  const { start, end } = assistantTurnBounds(messages, index)
  const latestAssistantIndex = latestAssistantIndexInRange(messages, start, end)
  if (index !== latestAssistantIndex) return []

  const turnTools: InlineToolCall[] = []
  for (let i = start; i <= end; i++) {
    const item = messages[i]
    if (item?.role === "assistant" && item.toolCalls?.length) {
      turnTools.push(...item.toolCalls)
    }
  }

  const latestUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return i
    }
    return -1
  })()
  const isCurrentAssistantTurn = isGenerating && index > latestUserIndex
  return mergeToolCalls(turnTools, isCurrentAssistantTurn ? liveTools : [])
}
