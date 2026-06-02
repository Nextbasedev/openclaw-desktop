export type StreamStatus = "idle" | "connected" | "queued" | "running" | "collect" | "thinking" | "tool_running" | "streaming" | "stopping" | "restarting" | "done" | "error"

export type InlineToolCall = {
  id: string
  tool: string
  status: "running" | "success" | "error"
  input?: unknown
  resultText?: string
  duration?: string
  startedAt?: number
  completedAt?: number
  awaitingResult?: boolean
}

export type ChatMessage = {
  messageId: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
  gatewayIndex?: number
  model?: string
  usage?: unknown
  stopReason?: string | null
  toolCalls?: InlineToolCall[]
  attachments?: Array<{ name: string; mimeType: string; content?: string; url?: string; size?: number }>
  [key: string]: unknown
}
