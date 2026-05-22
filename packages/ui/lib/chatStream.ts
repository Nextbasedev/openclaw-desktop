"use client"

import { streamUrl } from "./ipc"
import { frontendLog, sanitizeForLog, sanitizeUrlForLog } from "./clientLogs"

type ChatStreamEvent = {
  type: string
  data: Record<string, unknown>
}

type StreamListener = (event: ChatStreamEvent) => void
type ErrorListener = () => void

type StreamEntry = {
  sessionKey: string
  source: EventSource
  listeners: Set<StreamListener>
  errorListeners: Set<ErrorListener>
  closeTimer: ReturnType<typeof setTimeout> | null
}

const CHAT_STREAM_EVENTS = [
  "chat.status",
  "chat.message",
  "chat.tool",
  "chat.tool.started",
  "chat.tool.result",
  "chat.tool.error",
  "chat.error",
  "chat.agent",
  "chat.ready",
  "stream.error",
  "message",
]

export const CHAT_STREAM_CLOSE_GRACE_MS = 60_000

const streams = new Map<string, StreamEntry>()

function emitToListeners(entry: StreamEntry, event: MessageEvent) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(event.data)
  } catch {
    return
  }
  const payload: Record<string, unknown> = { type: event.type, ...data }
  const payloadSessionKey = payload.sessionKey
  if (typeof payloadSessionKey === "string" && payloadSessionKey !== entry.sessionKey) return
  for (const listener of entry.listeners) {
    listener({ type: event.type, data: payload })
  }
}

function getOrCreateStream(sessionKey: string): StreamEntry {
  const existing = streams.get(sessionKey)
  if (existing) {
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer)
      existing.closeTimer = null
    }
    return existing
  }

  const url = streamUrl(`/api/stream/chat/${sessionKey}`)
  frontendLog("stream", "legacy-chat-stream.start", { sessionKey, url: sanitizeUrlForLog(url) })
  const source = new EventSource(url)
  const entry: StreamEntry = {
    sessionKey,
    source,
    listeners: new Set(),
    errorListeners: new Set(),
    closeTimer: null,
  }

  source.onopen = () => {
    frontendLog("stream", "legacy-chat-stream.open", { sessionKey }, "debug")
  }
  for (const eventName of CHAT_STREAM_EVENTS) {
    source.addEventListener(eventName, (event) => {
      frontendLog("stream", "legacy-chat-stream.event", {
        sessionKey,
        eventName,
        data: sanitizeForLog((event as MessageEvent).data),
      }, "debug")
      emitToListeners(entry, event as MessageEvent)
    })
  }
  source.onerror = () => {
    frontendLog("stream", "legacy-chat-stream.error", { sessionKey }, "error")
    for (const listener of entry.errorListeners) listener()
  }

  streams.set(sessionKey, entry)
  return entry
}

export function subscribeChatStream(
  sessionKey: string,
  listener: StreamListener,
  onError?: ErrorListener,
) {
  const entry = getOrCreateStream(sessionKey)
  entry.listeners.add(listener)
  if (onError) entry.errorListeners.add(onError)
  frontendLog("stream", "legacy-chat-stream.subscribe", {
    sessionKey,
    listenerCount: entry.listeners.size,
    errorListenerCount: entry.errorListeners.size,
  }, "debug")

  return () => {
    entry.listeners.delete(listener)
    if (onError) entry.errorListeners.delete(onError)
    frontendLog("stream", "legacy-chat-stream.unsubscribe", {
      sessionKey,
      listenerCount: entry.listeners.size,
      errorListenerCount: entry.errorListeners.size,
    }, "debug")
    if (entry.listeners.size > 0 || entry.errorListeners.size > 0) return

    entry.closeTimer = setTimeout(() => {
      if (entry.listeners.size > 0 || entry.errorListeners.size > 0) return
      frontendLog("stream", "legacy-chat-stream.close", { sessionKey, reason: "idle-grace-expired" })
      entry.source.close()
      streams.delete(sessionKey)
    }, CHAT_STREAM_CLOSE_GRACE_MS)
  }
}

export function activeChatStreamCount() {
  return streams.size
}

export function clearChatStreamsForTests() {
  for (const entry of streams.values()) {
    if (entry.closeTimer) clearTimeout(entry.closeTimer)
    entry.source.close()
  }
  streams.clear()
}
