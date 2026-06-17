import { describe, expect, test } from "vitest"

import {
  MAX_QUEUED_CHAT_MESSAGES,
  canEnqueueChatMessage,
  deleteQueuedChatMessage,
  editQueuedChatMessage,
  enqueueChatMessage,
  takeNextQueuedChatMessage,
  type QueuedChatMessage,
} from "./chatSendQueue"

function item(id: string, text: string): QueuedChatMessage {
  return { id, createdAtMs: 1, payload: { text } }
}

describe("chatSendQueue", () => {
  test("keeps messages in send order", () => {
    const queue = enqueueChatMessage(enqueueChatMessage([], item("a", "first")), item("b", "second"))

    expect(queue.map((queued) => queued.payload.text)).toEqual(["first", "second"])
  })

  test("does not enqueue beyond the max queue size", () => {
    const fullQueue = Array.from({ length: MAX_QUEUED_CHAT_MESSAGES }, (_, index) =>
      item(String(index), `queued ${index}`)
    )

    expect(canEnqueueChatMessage(fullQueue)).toBe(false)
    expect(enqueueChatMessage(fullQueue, item("overflow", "too much"))).toBe(fullQueue)
  })

  test("edits only the targeted queued message", () => {
    const queue = [item("a", "first"), item("b", "second")]

    expect(editQueuedChatMessage(queue, "b", "changed").map((queued) => queued.payload.text)).toEqual([
      "first",
      "changed",
    ])
  })

  test("deletes only the targeted queued message", () => {
    const queue = [item("a", "first"), item("b", "second")]

    expect(deleteQueuedChatMessage(queue, "a").map((queued) => queued.id)).toEqual(["b"])
  })

  test("takes the next queued message FIFO", () => {
    const queue = [item("a", "first"), item("b", "second")]

    expect(takeNextQueuedChatMessage(queue)).toEqual({ next: queue[0], rest: [queue[1]] })
  })
})
