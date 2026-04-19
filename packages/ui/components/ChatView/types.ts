export type ContentBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export type ChatMessage = {
  messageId: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
  model?: string
  isOptimistic?: boolean
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
