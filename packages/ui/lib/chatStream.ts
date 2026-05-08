"use client"

import { streamUrl } from "./ipc"

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
  "chat.error",
  "chat.agent",
  "chat.ready",
  "stream.error",
  "message",
]

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

  const source = new EventSource(
    streamUrl(`/api/stream/chat/${sessionKey}`),
  )
  const entry: StreamEntry = {
    sessionKey,
    source,
    listeners: new Set(),
    errorListeners: new Set(),
    closeTimer: null,
  }

  for (const eventName of CHAT_STREAM_EVENTS) {
    source.addEventListener(eventName, (event) => {
      emitToListeners(entry, event as MessageEvent)
    })
  }
  source.onerror = () => {
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

  return () => {
    entry.listeners.delete(listener)
    if (onError) entry.errorListeners.delete(onError)
    if (entry.listeners.size > 0 || entry.errorListeners.size > 0) return

    entry.closeTimer = setTimeout(() => {
      if (entry.listeners.size > 0 || entry.errorListeners.size > 0) return
      entry.source.close()
      streams.delete(sessionKey)
    }, 250)
  }
}

export function activeChatStreamCount() {
  return streams.size
}
