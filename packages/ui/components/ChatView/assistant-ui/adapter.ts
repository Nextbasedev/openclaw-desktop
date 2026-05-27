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
  let currentUserTurnId = "start"
  let assistantOrdinalInTurn = 0

  return messages.map((message) => {
    if (message.role === "user") {
      currentUserTurnId = message.messageId
      assistantOrdinalInTurn = 0
      return toAssistantMessage(message)
    }

    assistantOrdinalInTurn += 1
    const displayId = `assistant-turn:${currentUserTurnId}:${assistantOrdinalInTurn}`
    return toAssistantMessage(message, displayId)
  })
}

export function assistantTextFromAppendMessage(message: { content?: readonly unknown[] }): string {
  return (message.content ?? [])
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
}
