import type { ChatMessage } from "../components/ChatView/types"

export const DEFAULT_MESSAGE_WINDOW_SIZE = 240
export const DEFAULT_MESSAGE_WINDOW_PIN_BUFFER = 20

export type MessageWindow = {
  messages: ChatMessage[]
  hiddenBefore: number
  total: number
}

export function windowChatMessages(
  messages: ChatMessage[],
  pinnedIds: string[] = [],
  windowSize = DEFAULT_MESSAGE_WINDOW_SIZE,
): MessageWindow {
  if (messages.length <= windowSize) return { messages, hiddenBefore: 0, total: messages.length }

  const keep = new Set<string>()
  const pinned = new Set(pinnedIds)
  const start = Math.max(0, messages.length - windowSize)
  for (let i = start; i < messages.length; i += 1) keep.add(messages[i].messageId)

  // Keep a little context around pinned messages so jumping to a pin still works
  // for recent/important content without rendering the whole transcript.
  for (let i = 0; i < messages.length; i += 1) {
    if (!pinned.has(messages[i].messageId)) continue
    const from = Math.max(0, i - DEFAULT_MESSAGE_WINDOW_PIN_BUFFER)
    const to = Math.min(messages.length, i + DEFAULT_MESSAGE_WINDOW_PIN_BUFFER + 1)
    for (let j = from; j < to; j += 1) keep.add(messages[j].messageId)
  }

  const windowed = messages.filter((message) => keep.has(message.messageId))
  const firstIndex = messages.findIndex((message) => message.messageId === windowed[0]?.messageId)
  return {
    messages: windowed,
    hiddenBefore: firstIndex > 0 ? firstIndex : 0,
    total: messages.length,
  }
}
