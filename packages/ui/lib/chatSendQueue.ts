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
