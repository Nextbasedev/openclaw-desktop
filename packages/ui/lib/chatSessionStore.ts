"use client"

import type { ChatMessage, StreamStatus } from "@/components/ChatView/types"

type MessageListener = (messages: ChatMessage[], sourceId?: string) => void
type StatusListener = (status: StreamStatus, sourceId?: string) => void

type SessionRecord = {
  messages: ChatMessage[]
  status: StreamStatus
  messageListeners: Set<MessageListener>
  statusListeners: Set<StatusListener>
  updatedAt: number
}

const sessions = new Map<string, SessionRecord>()

function recordFor(sessionKey: string): SessionRecord {
  let record = sessions.get(sessionKey)
  if (!record) {
    record = {
      messages: [],
      status: "idle",
      messageListeners: new Set(),
      statusListeners: new Set(),
      updatedAt: Date.now(),
    }
    sessions.set(sessionKey, record)
  }
  return record
}

export function getCachedChatSessionMessages(sessionKey: string): ChatMessage[] | null {
  const messages = sessions.get(sessionKey)?.messages
  return messages && messages.length > 0 ? messages : null
}

export function publishChatSessionMessages(
  sessionKey: string,
  messages: ChatMessage[],
  sourceId?: string,
) {
  const record = recordFor(sessionKey)
  record.messages = messages
  record.updatedAt = Date.now()
  for (const listener of record.messageListeners) listener(messages, sourceId)
}

export function subscribeChatSessionMessages(
  sessionKey: string,
  listener: MessageListener,
) {
  const record = recordFor(sessionKey)
  record.messageListeners.add(listener)
  return () => {
    record.messageListeners.delete(listener)
    if (
      record.messageListeners.size === 0 &&
      record.statusListeners.size === 0 &&
      record.messages.length === 0
    ) {
      sessions.delete(sessionKey)
    }
  }
}

export function getCachedChatSessionStatus(sessionKey: string): StreamStatus | null {
  return sessions.get(sessionKey)?.status ?? null
}

export function publishChatSessionStatus(
  sessionKey: string,
  status: StreamStatus,
  sourceId?: string,
) {
  const record = recordFor(sessionKey)
  record.status = status
  record.updatedAt = Date.now()
  for (const listener of record.statusListeners) listener(status, sourceId)
}

export function subscribeChatSessionStatus(
  sessionKey: string,
  listener: StatusListener,
) {
  const record = recordFor(sessionKey)
  record.statusListeners.add(listener)
  return () => {
    record.statusListeners.delete(listener)
    if (
      record.messageListeners.size === 0 &&
      record.statusListeners.size === 0 &&
      record.messages.length === 0
    ) {
      sessions.delete(sessionKey)
    }
  }
}

export function chatSessionStoreStats() {
  return Array.from(sessions.entries()).map(([sessionKey, record]) => ({
    sessionKey,
    messages: record.messages.length,
    status: record.status,
    messageSubscribers: record.messageListeners.size,
    statusSubscribers: record.statusListeners.size,
    updatedAt: record.updatedAt,
  }))
}

export function clearChatSessionStoreForTests() {
  sessions.clear()
}
