"use client"

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export type ChatHistoryMessage = {
  id: string
  role: string
  content: unknown
  text: string
  createdAt: string
  model?: string | null
}

export type ChatStreamEnvelope = {
  streamId: string
  event: {
    type: "chat.ready" | "chat.status" | "chat.message" | "chat.tool" | "chat.error"
    sessionKey: string
    [key: string]: unknown
  }
}

export async function chatHistory(sessionKey: string) {
  return invoke<{
    sessionKey: string
    thinkingLevel?: string | null
    verboseLevel?: string | null
    messages: ChatHistoryMessage[]
  }>("middleware_chat_history", {
    input: { sessionKey },
  })
}

export async function chatSend(input: {
  sessionKey: string
  text: string
}) {
  return invoke<{
    accepted?: boolean
    sessionKey?: string
    runId?: string | null
    status?: string | null
  }>("middleware_chat_send", {
    input: {
      sessionKey: input.sessionKey,
      text: input.text,
    },
  })
}

export async function chatStreamStart(sessionKey: string) {
  return invoke<{ streamId: string; sessionKey: string }>("middleware_chat_stream_start", {
    input: { sessionKey },
  })
}

export async function chatStreamStop(streamId: string) {
  return invoke<{ stopped: boolean; streamId: string }>("middleware_chat_stream_stop", {
    input: { streamId },
  })
}

export async function listenChatEvents(
  handler: (payload: ChatStreamEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<ChatStreamEnvelope>("middleware://chat-event", (event) => {
    handler(event.payload)
  })
}
