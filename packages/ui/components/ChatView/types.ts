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

export type ChatMessage = {
  messageId: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
  model?: string
  isOptimistic?: boolean
  toolCalls?: InlineToolCall[]
  branches?: MessageBranch[]
  activeBranch?: number
}

export type SpawnedSubagent = {
  id: string
  label: string
  sessionKey: string | null
  status: "running" | "done" | "error"
  toolCallId: string
}

export type StreamStatus =
  | "idle"
  | "connected"
  | "thinking"
  | "tool_running"
  | "streaming"
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
  }
}
