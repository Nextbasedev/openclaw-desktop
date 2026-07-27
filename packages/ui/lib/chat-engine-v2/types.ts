export const CHAT_PROJECTION_VERSION = 3

export type RunStatusV2 = "idle" | "queued" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted"

export type ActiveRunV2 = {
  runId: string
  gatewayRunId?: string | null
  clientMessageId?: string | null
  idempotencyKey?: string | null
  status: RunStatusV2 | string
  statusLabel?: string | null
  startedAtMs?: number
  updatedAtMs?: number
}

export type ToolCallProjectionV2 = {
  toolCallId?: string
  id?: string
  sessionKey?: string
  runId?: string | null
  messageId?: string | null
  name?: string
  phase?: string
  status?: "running" | "success" | "error" | string
  argsMeta?: unknown
  resultMeta?: unknown
  startedAtMs?: number
  finishedAtMs?: number | null
  updatedAtMs?: number
}

export type MessageProjectionV2 = unknown

export type ChatBootstrapV2 = {
  ok: boolean
  source?: string
  projectionVersion?: number
  sessionKey: string
  sessionId?: string | null
  runStatus?: RunStatusV2 | string
  statusLabel?: string | null
  activeRun?: ActiveRunV2 | null
  messages: MessageProjectionV2[]
  messageCount: number
  tools?: ToolCallProjectionV2[]
  toolCalls?: ToolCallProjectionV2[]
  cursor?: number
  projection?: { cursor?: number; lastSeq?: number; liveSubscribed?: boolean; version?: number }
  /** Compatibility only for old consumers. Prefer canonical runStatus/statusLabel. */
  sessionStatus?: string | null
}

export type PatchPayloadV2 = {
  projectionVersion?: number
  semanticType?: string
  sessionKey?: string
  message?: MessageProjectionV2
  messageId?: string
  optimisticId?: string
  clientMessageId?: string | null
  idempotencyKey?: string | null
  gatewayMessageId?: string
  messageSeq?: number
  gatewayIndex?: number
  runId?: string
  gatewayRunId?: string | null
  runStatus?: RunStatusV2 | string
  status?: RunStatusV2 | string | null
  statusLabel?: string | null
  activeRun?: ActiveRunV2 | null
  toolCallId?: string
  toolCall?: ToolCallProjectionV2
  text?: string | null
  delta?: string | null
  [key: string]: unknown
}

export type PatchFrame = {
  type: "patch"
  patch: {
    cursor: number
    type: "chat.message.upsert" | "chat.message.confirmed" | "chat.message.remove" | "chat.status" | "session.status" | "session.upsert" | string
    sessionKey: string | null
    payload: PatchPayloadV2 | unknown
    createdAtMs: number
  }
}

export type HelloFrame = {
  type: "hello"
  clientId: string
  afterCursor: number
  replayCount: number
  replayHasMore?: boolean
  replayWindowExceeded?: boolean
  recovery?: "bootstrap" | string | null
}

export type StreamFrame = PatchFrame | HelloFrame

export type CachedChatBootstrapV2 = {
  source?: string
  projectionVersion?: number
  messages?: unknown[]
  messageCount?: number
  cursor?: number
  v2Cursor?: number
  runStatus?: RunStatusV2 | string
  statusLabel?: string | null
  activeRun?: ActiveRunV2 | null
  tools?: ToolCallProjectionV2[]
  toolCalls?: ToolCallProjectionV2[]
  branchData?: unknown
  /** Compatibility mirror for legacy ChatView code. Prefer top-level messages/cursor/runStatus. */
  history?: { messages?: unknown[]; sessionStatus?: string | null }
}
