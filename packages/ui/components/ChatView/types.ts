import type { SubagentLifecycleStatus } from "@/lib/subagentLifecycle"

export type ContentBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export type InlineToolCall = {
  id: string
  tool: string
  status: "running" | "success" | "error"
  duration?: string
  startedAt?: number
}

export type MessageBranch = {
  userText: string
  userCreatedAt?: string
  response?: {
    messageId: string
    text: string
    createdAt?: string
    model?: string
    toolCalls?: InlineToolCall[]
  }
}

export type EmbedContent = {
  ref: string
  content: string
  title?: string
}

export type ReplyTo = {
  messageId: string
  role: "user" | "assistant"
  text: string
}

export type ChatMessage = {
  messageId: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
  model?: string
  isOptimistic?: boolean
  animateText?: boolean
  toolCalls?: InlineToolCall[]
  branches?: MessageBranch[]
  activeBranch?: number
  embeds?: EmbedContent[]
  replyTo?: ReplyTo
  gatewayIndex?: number
  attachments?: Array<{
    name: string
    mimeType: string
    content?: string
    url?: string
    size?: number
  }>
  voice?: {
    url: string
    duration?: number
    transcript?: string
  }
}

export type SpawnedSubagent = {
  id: string
  label: string
  task?: string
  sessionKey: string | null
  status: SubagentLifecycleStatus
  toolCallId: string
}

export type StreamStatus =
  | "idle"
  | "connected"
  | "thinking"
  | "tool_running"
  | "streaming"
  | "stopping"
  | "restarting"
  | "done"
  | "error"

export type StreamEventPayload = {
  streamId: string
  event: {
    type: string
    sessionKey?: string
    state?: string
    label?: string
    name?: string
    messageId?: string
    role?: string
    text?: string
    content?: string | ContentBlock[]
    createdAt?: string
    model?: string
    message?: string
    error?: string
    recentMessages?: unknown[]
  }
}
