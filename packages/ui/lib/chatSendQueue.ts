import type { ChatComposerSubmit } from "@/lib/chatAttachments"

export type QueuedChatMessage = {
  id: string
  payload: ChatComposerSubmit
  createdAtMs: number
}

export function enqueueChatMessage(
  queue: QueuedChatMessage[],
  item: QueuedChatMessage,
): QueuedChatMessage[] {
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
