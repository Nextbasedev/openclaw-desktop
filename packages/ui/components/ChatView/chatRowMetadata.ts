import type { ChatMessage, InlineToolCall } from "./types"

export type ChatRowMetadata = {
  hasLaterAssistantInSameTurn: boolean
  isActiveTurnAssistant: boolean
  shouldFinalizeDisplayedTools: boolean
}

export type ChatRowMetadataResult = {
  byMessageId: Map<string, ChatRowMetadata>
  latestUserIndex: number
  displayedToolIds: Set<string>
}

export function buildChatRowMetadata({
  messages,
  latestUserIndex,
  isGenerating,
  pendingToolsLength,
}: {
  messages: ChatMessage[]
  latestUserIndex: number
  isGenerating: boolean
  pendingToolsLength: number
}): ChatRowMetadataResult {
  const byMessageId = new Map<string, ChatRowMetadata>()
  const displayedToolIds = new Set<string>()
  let hasLaterAssistantTextInTurn = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message.role === "user") {
      byMessageId.set(message.messageId, {
        hasLaterAssistantInSameTurn: false,
        isActiveTurnAssistant: false,
        shouldFinalizeDisplayedTools: false,
      })
      hasLaterAssistantTextInTurn = false
      continue
    }

    for (const tool of message.toolCalls ?? []) {
      if (tool.id) displayedToolIds.add(tool.id)
    }

    const isAssistant = message.role === "assistant"
    const isActiveTurnAssistant = isAssistant && index > latestUserIndex
    const hasLaterAssistantInSameTurn = isAssistant && hasLaterAssistantTextInTurn
    const shouldFinalizeDisplayedTools =
      isAssistant &&
      (index < latestUserIndex || !isGenerating || pendingToolsLength === 0)

    byMessageId.set(message.messageId, {
      hasLaterAssistantInSameTurn,
      isActiveTurnAssistant,
      shouldFinalizeDisplayedTools,
    })

    if (isAssistant && message.text.trim()) {
      hasLaterAssistantTextInTurn = true
    }
  }

  return { byMessageId, latestUserIndex, displayedToolIds }
}

export type ToolSummary = {
  total: number
  running: number
  succeeded: number
  failed: number
  approvalNeeded: number
  urgentTool?: InlineToolCall
}

export function summarizeTools(tools: InlineToolCall[]): ToolSummary {
  const summary: ToolSummary = {
    total: tools.length,
    running: 0,
    succeeded: 0,
    failed: 0,
    approvalNeeded: 0,
  }

  for (const tool of tools) {
    if (tool.approval) summary.approvalNeeded += 1
    if (tool.status === "running") summary.running += 1
    else if (tool.status === "error") summary.failed += 1
    else summary.succeeded += 1
  }

  summary.urgentTool =
    tools.find((tool) => tool.approval) ??
    tools.find((tool) => tool.status === "error") ??
    tools.find((tool) => tool.status === "running") ??
    tools[tools.length - 1]

  return summary
}

export function formatToolSummary(summary: ToolSummary): string {
  const parts: string[] = []
  if (summary.running > 0) parts.push(`${summary.running} running`)
  if (summary.succeeded > 0) parts.push(`${summary.succeeded} done`)
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  if (summary.approvalNeeded > 0) parts.push(`${summary.approvalNeeded} approval`)
  return parts.length > 0 ? parts.join(" · ") : `${summary.total} tool${summary.total === 1 ? "" : "s"}`
}
