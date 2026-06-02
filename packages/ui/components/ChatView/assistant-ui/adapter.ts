import type { ExternalThreadMessage } from "@assistant-ui/react"
import type { ChatMessage, InlineToolCall } from "../types"

export type OpenClawAssistantMessage = ExternalThreadMessage & {
  metadata: ExternalThreadMessage["metadata"] & {
    custom: {
      openclaw: ChatMessage
    }
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function toolInput(tool: InlineToolCall): { args?: JsonRecord; argsText?: string } {
  const input = tool.input
  if (isRecord(input)) return { args: input }
  if (typeof input === "string") return { argsText: input }
  if (input == null) return { args: {} }
  return { argsText: JSON.stringify(input) }
}

function toolResult(tool: InlineToolCall): unknown | undefined {
  if (typeof tool.resultText === "string") return tool.resultText
  if (tool.approval) {
    return {
      approval: tool.approval,
      awaitingResult: tool.awaitingResult ?? false,
    }
  }
  return undefined
}

function createdAt(message: ChatMessage): Date {
  const value = message.createdAt ? new Date(message.createdAt) : null
  return value && Number.isFinite(value.getTime()) ? value : new Date(0)
}

function mergeText(existing: string, incoming: string) {
  if (!existing.trim()) return incoming
  if (!incoming.trim()) return existing
  if (incoming.startsWith(existing)) return incoming
  if (existing.includes(incoming)) return existing
  return `${existing}\n\n${incoming}`
}

function mergeToolCalls(existing?: ChatMessage["toolCalls"], incoming?: ChatMessage["toolCalls"]): ChatMessage["toolCalls"] {
  if (!existing?.length) return incoming
  if (!incoming?.length) return existing
  const merged = new Map(existing.map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    const current = merged.get(tool.id)
    if (!current) {
      merged.set(tool.id, tool)
      continue
    }
    const currentTerminal = current.status === "success" || current.status === "error"
    const staleRunningIncoming = currentTerminal && tool.status === "running"
    merged.set(tool.id, staleRunningIncoming
      ? {
          ...tool,
          ...current,
          duration: current.duration ?? tool.duration,
          startedAt: current.startedAt ?? tool.startedAt,
          completedAt: current.completedAt ?? tool.completedAt,
          resultText: current.resultText ?? tool.resultText,
          awaitingResult: false,
        }
      : { ...current, ...tool }
    )
  }
  return Array.from(merged.values())
}

function mergeAssistantMessages(messages: ChatMessage[]): ChatMessage {
  const [first, ...rest] = messages
  if (!first) throw new Error("mergeAssistantMessages requires at least one message")

  return rest.reduce<ChatMessage>((merged, message) => ({
    ...merged,
    ...message,
    messageId: merged.messageId,
    text: mergeText(merged.text, message.text),
    reasoningText: mergeText(merged.reasoningText ?? "", message.reasoningText ?? "") || undefined,
    toolCalls: mergeToolCalls(merged.toolCalls, message.toolCalls),
    embeds: [...(merged.embeds ?? []), ...(message.embeds ?? [])],
    attachments: [...(merged.attachments ?? []), ...(message.attachments ?? [])],
    animateText: Boolean(merged.animateText || message.animateText),
    isOptimistic: Boolean(merged.isOptimistic || message.isOptimistic),
    sendStatus: message.sendStatus ?? merged.sendStatus,
    sendError: message.sendError ?? merged.sendError,
  }), first)
}

function coalesceAssistantTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let assistantBuffer: ChatMessage[] = []

  const flushAssistantBuffer = () => {
    if (assistantBuffer.length === 0) return
    result.push(mergeAssistantMessages(assistantBuffer))
    assistantBuffer = []
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      assistantBuffer.push(message)
      continue
    }
    flushAssistantBuffer()
    result.push(message)
  }

  flushAssistantBuffer()
  return result
}

function convertAttachments(message: ChatMessage): ExternalThreadMessage["attachments"] {
  return (message.attachments ?? []).map((attachment, index) => ({
    id: `${message.messageId}:attachment:${index}`,
    type: attachment.mimeType.startsWith("image/") ? "image" : "document",
    name: attachment.name,
    contentType: attachment.mimeType,
    status: { type: "complete" as const },
    content: attachment.content
      ? [
          attachment.mimeType.startsWith("image/")
            ? { type: "image" as const, image: attachment.content }
            : { type: "text" as const, text: attachment.content },
        ]
      : [],
    file: undefined,
  })) as ExternalThreadMessage["attachments"]
}

export function toAssistantMessage(
  message: ChatMessage,
  displayId = message.messageId,
): OpenClawAssistantMessage {
  const content: Array<Record<string, unknown>> = []

  if (message.reasoningText) {
    content.push({ type: "reasoning", text: message.reasoningText })
  }

  if (message.text) {
    content.push({ type: "text", text: message.text })
  }

  for (const tool of message.toolCalls ?? []) {
    const input = toolInput(tool)
    const result = toolResult(tool)
    content.push({
      type: "tool-call",
      toolCallId: tool.id,
      toolName: tool.tool,
      ...input,
      ...(result === undefined ? {} : { result }),
      ...(tool.status === "error" ? { isError: true } : {}),
      status:
        tool.status === "running"
          ? { type: "running" }
          : tool.status === "error"
            ? { type: "complete", reason: "error" }
            : { type: "complete" },
    })
  }

  return {
    id: displayId,
    role: message.role,
    createdAt: createdAt(message),
    content: content as unknown as OpenClawAssistantMessage["content"],
    attachments: convertAttachments(message),
    status:
      message.role === "assistant"
        ? message.animateText
          ? { type: "running" as const }
          : { type: "complete" as const, reason: "stop" as const }
        : undefined,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { openclaw: message },
    },
  } as OpenClawAssistantMessage
}

export function toAssistantMessages(messages: readonly ChatMessage[]): OpenClawAssistantMessage[] {
  const coalesced = coalesceAssistantTurns(messages)
  let currentTurnIndex = 0
  let assistantOrdinalInTurn = 0

  return coalesced.map((message) => {
    if (message.role === "user") {
      currentTurnIndex += 1
      assistantOrdinalInTurn = 0
      return toAssistantMessage(message, `user-turn:${currentTurnIndex}`)
    }

    assistantOrdinalInTurn += 1
    const displayId = `assistant-turn:${currentTurnIndex}:${assistantOrdinalInTurn}`
    return toAssistantMessage(message, displayId)
  })
}

export function assistantTextFromAppendMessage(message: { content?: readonly unknown[] }): string {
  return (message.content ?? [])
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
}
