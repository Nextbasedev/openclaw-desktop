import type { ChatComposerSubmit } from "@/lib/chatAttachments"

export const MAX_QUEUED_CHAT_MESSAGES = 5

export type QueuedChatMessage = {
  id: string
  payload: ChatComposerSubmit
  createdAtMs: number
}

export function canEnqueueChatMessage(queue: QueuedChatMessage[]): boolean {
  return queue.length < MAX_QUEUED_CHAT_MESSAGES
}

export function enqueueChatMessage(
  queue: QueuedChatMessage[],
  item: QueuedChatMessage,
): QueuedChatMessage[] {
  if (!canEnqueueChatMessage(queue)) return queue
  return [...queue, item]
}

export function editQueuedChatMessage(
  queue: QueuedChatMessage[],
  id: string,
  text: string,
): QueuedChatMessage[] {
  return queue.map((item) =>
    item.id === id
      ? { ...item, payload: { ...item.payload, text } }
      : item
  )
}

export function deleteQueuedChatMessage(
  queue: QueuedChatMessage[],
  id: string,
): QueuedChatMessage[] {
  return queue.filter((item) => item.id !== id)
}

export function takeNextQueuedChatMessage(queue: QueuedChatMessage[]): {
  next: QueuedChatMessage | null
  rest: QueuedChatMessage[]
} {
  const [next, ...rest] = queue
  return { next: next ?? null, rest }
}

export function persistedChatSendQueueKey(sessionKey: string): string {
  return `openclaw-chat-send-queue:v1:${sessionKey}`
}

function isQueuedChatMessage(value: unknown): value is QueuedChatMessage {
  if (!value || typeof value !== "object") return false
  const item = value as QueuedChatMessage
  return Boolean(
    typeof item.id === "string" &&
      typeof item.createdAtMs === "number" &&
      item.payload &&
      typeof item.payload.text === "string"
  )
}

export function loadPersistedChatSendQueue(
  sessionKey: string,
): QueuedChatMessage[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(persistedChatSendQueueKey(sessionKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueuedChatMessage).slice(0, MAX_QUEUED_CHAT_MESSAGES)
  } catch {
    return []
  }
}

export function savePersistedChatSendQueue(
  sessionKey: string,
  queue: QueuedChatMessage[],
): void {
  if (typeof localStorage === "undefined") return
  try {
    const key = persistedChatSendQueueKey(sessionKey)
    if (queue.length > 0) {
      localStorage.setItem(
        key,
        JSON.stringify(queue.slice(0, MAX_QUEUED_CHAT_MESSAGES)),
      )
    } else {
      localStorage.removeItem(key)
    }
  } catch {}
}
