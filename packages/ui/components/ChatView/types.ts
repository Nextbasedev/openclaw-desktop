import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import type { SubagentLifecycleStatus } from "@/lib/subagentLifecycle"

export type ContentBlock = {
  type: string
  text?: string
  id?: string
  toolCallId?: string
  tool_call_id?: string
  name?: string
  toolName?: string
  tool_name?: string
  tool?: string
  input?: unknown
  arguments?: unknown
  args?: unknown
  parameters?: unknown
  argsMeta?: unknown
  result?: unknown
  resultMeta?: unknown
  duration?: string
  durationMs?: number
  status?: "running" | "success" | "error" | "result" | "done" | "complete" | "completed" | "failed"
  phase?: string
  startedAtMs?: number
  finishedAtMs?: number | null
  isError?: boolean
}

export type ChatTokenUsage = {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  total: number | null
  raw?: unknown
}

export type InlineToolCall = {
  id: string
  tool: string
  status: "running" | "success" | "error"
  duration?: string
  startedAt?: number
  completedAt?: number
  input?: unknown
  resultText?: string
  awaitingResult?: boolean
  approval?: {
    id: string
    slug?: string
    command?: string
    allowedDecisions: Array<"allow-once" | "allow-always" | "deny">
  }
}

export type MessageBranch = {
  userText: string
  userCreatedAt?: string
  response?: {
    messageId: string
    text: string
    createdAt?: string
    model?: string
    usage?: ChatTokenUsage | null
    stopReason?: string | null
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
  selections?: Array<{
    messageId: string
    text: string
    comment?: string
  }>
}

export type ChatMessage = {
  messageId: string
  role: "user" | "assistant"
  text: string
  createdAt?: string
  model?: string
  usage?: ChatTokenUsage | null
  stopReason?: string | null
  isOptimistic?: boolean
  sendStatus?: "sending" | "failed"
  sendError?: string | null
  retryPayload?: ChatComposerSubmit
  animateText?: boolean
  reasoningText?: string
  toolCalls?: InlineToolCall[]
  branches?: MessageBranch[]
  activeBranch?: number
  embeds?: EmbedContent[]
  replyTo?: ReplyTo
  gatewayIndex?: number
  runId?: string
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

export type EditPreviewState = {
  branchSessionKey: string
  sourceUserMessageId: string
  sourceAssistantMessageId?: string | null
  original: {
    user: ChatMessage
    assistant?: ChatMessage | null
  }
  edited: {
    user: ChatMessage
    assistant?: ChatMessage | null
  }
  status: "streaming" | "ready" | "error"
  error?: string | null
}

export type StreamStatus =
  | "idle"
  | "connected"
  | "queued"
  | "running"
  | "collect"
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
    usage?: ChatTokenUsage | null
    stopReason?: string | null
    message?: string
    error?: string
    recentMessages?: unknown[]
  }
}
