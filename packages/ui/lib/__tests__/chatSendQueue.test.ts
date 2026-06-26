import { beforeEach, describe, expect, it } from "vitest"
import {
  deleteQueuedChatMessage,
  editQueuedChatMessage,
  enqueueChatMessage,
  loadPersistedChatSendQueue,
  persistedChatSendQueueKey,
  savePersistedChatSendQueue,
  takeNextQueuedChatMessage,
  type QueuedChatMessage,
} from "../chatSendQueue"

class LocalStorageMock {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

function queued(id: string, text: string): QueuedChatMessage {
  return {
    id,
    createdAtMs: 1_700_000_000_000,
    payload: {
      text,
      autonomyMode: "manual",
      execPolicy: { security: "full", ask: "off" },
    },
  }
}

describe("chat send queue persistence", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new LocalStorageMock(),
      configurable: true,
    })
  })

  it("stores queued messages per chat session so a chat switch can restore them", () => {
    const sessionA = "agent:main:chat-a"
    const sessionB = "agent:main:chat-b"
    const queueA = enqueueChatMessage([], queued("q1", "run after current answer"))

    savePersistedChatSendQueue(sessionA, queueA)
    savePersistedChatSendQueue(sessionB, [])

    expect(loadPersistedChatSendQueue(sessionA)).toEqual(queueA)
    expect(loadPersistedChatSendQueue(sessionB)).toEqual([])
    expect(globalThis.localStorage.getItem(persistedChatSendQueueKey(sessionA))).toContain("run after current answer")
  })

  it("keeps edit, delete, and drain operations syncable with persisted storage", () => {
    const sessionKey = "agent:main:chat-a"
    const initial = [queued("q1", "first"), queued("q2", "second")]

    savePersistedChatSendQueue(sessionKey, initial)
    const edited = editQueuedChatMessage(loadPersistedChatSendQueue(sessionKey), "q2", "second edited")
    savePersistedChatSendQueue(sessionKey, edited)

    expect(loadPersistedChatSendQueue(sessionKey).at(1)?.payload.text).toBe("second edited")

    const { next, rest } = takeNextQueuedChatMessage(loadPersistedChatSendQueue(sessionKey))
    savePersistedChatSendQueue(sessionKey, rest)

    expect(next?.payload.text).toBe("first")
    expect(loadPersistedChatSendQueue(sessionKey).map((item) => item.id)).toEqual(["q2"])

    const deleted = deleteQueuedChatMessage(loadPersistedChatSendQueue(sessionKey), "q2")
    savePersistedChatSendQueue(sessionKey, deleted)

    expect(loadPersistedChatSendQueue(sessionKey)).toEqual([])
    expect(globalThis.localStorage.getItem(persistedChatSendQueueKey(sessionKey))).toBeNull()
  })
})
