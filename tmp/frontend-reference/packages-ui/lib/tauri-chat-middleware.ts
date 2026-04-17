import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type ToolOutputVisibility = "hidden" | "metadata-only" | "full"

export type ChatReadyEvent = {
  type: "chat.ready"
  sessionKey: string
  thinkingLevel: string | null
  verboseLevel: string | null
  toolOutputVisibility: ToolOutputVisibility
  recentMessages: Array<{
    id: string | null
    role: string
    text: string
    createdAt: string | null
    model: string | null
  }>
}

export type ChatStatusEvent = {
  type: "chat.status"
  sessionKey: string
  state: "connected" | "sending" | "thinking" | "tool_running" | "streaming" | "done" | "error"
  label?: string | null
}

export type ChatToolEvent = {
  type: "chat.tool"
  sessionKey: string
  runId: string | null
  verboseLevel: string | null
  toolOutputVisibility: ToolOutputVisibility
  phase: string | null
  name: string | null
  toolCallId: string | null
  args?: unknown | null
  partialResult?: unknown | null
  result?: unknown | null
  error?: string | null
}

export type ChatMessageEvent = {
  type: "chat.message"
  sessionKey: string
  messageId: string | null
  role: string
  content: unknown
  text: string
  createdAt: string | null
  model: string | null
}

export type ChatErrorEvent = {
  type: "chat.error"
  sessionKey: string
  message: string
}

export type ChatStreamEvent = ChatReadyEvent | ChatStatusEvent | ChatToolEvent | ChatMessageEvent | ChatErrorEvent

type StreamEnvelope = {
  streamId: string
  event: ChatStreamEvent
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ === "object"
}

export async function createChatSession(input: {
  label?: string
  model?: string
  agentId?: string
  verboseLevel?: string
}) {
  return invoke<{ sessionKey: string }>("middleware_chat_create_session", { input })
}

export async function deleteChatSession(sessionKey: string) {
  return invoke<{ deleted: boolean; sessionKey: string }>("middleware_chat_delete_session", {
    input: { sessionKey },
  })
}

export async function getChatHistory(sessionKey: string) {
  return invoke<{
    sessionKey: string
    thinkingLevel: string | null
    verboseLevel: string | null
    messages: Array<{
      id: string
      role: string
      content: unknown
      text: string
      createdAt: string
      model: string | null
    }>
  }>("middleware_chat_history", { input: { sessionKey } })
}

export async function sendChatMessage(input: { sessionKey: string; text: string; timeoutMs?: number }) {
  return invoke<{ accepted: boolean; sessionKey: string; runId: string | null; status: string }>(
    "middleware_chat_send",
    { input },
  )
}

export async function startChatStream(input: {
  sessionKey: string
  onEvent: (event: ChatStreamEvent) => void
}) {
  const started = await invoke<{ streamId: string; sessionKey: string }>("middleware_chat_stream_start", {
    input: { sessionKey: input.sessionKey },
  })

  const unlisten = await listen<StreamEnvelope>("middleware://chat-event", (event) => {
    const payload = event.payload
    if (!payload || payload.streamId !== started.streamId) return
    input.onEvent(payload.event)
  })

  return {
    streamId: started.streamId,
    sessionKey: started.sessionKey,
    async stop() {
      await safeStopStream(started.streamId, unlisten)
    },
  }
}

async function safeStopStream(streamId: string, unlisten: UnlistenFn) {
  try {
    await invoke("middleware_chat_stream_stop", { input: { streamId } })
  } finally {
    unlisten()
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}
