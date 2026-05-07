import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { activeChatStreamCount, subscribeChatStream } from "../chatStream"
import {
  clearChatSessionStoreForTests,
  publishChatSessionMessages,
  subscribeChatSessionMessages,
} from "../chatSessionStore"

type Listener = (event: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []
  listeners = new Map<string, Listener[]>()
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }
}

describe("chat tab load characteristics", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.instances = []
    clearChatSessionStoreForTests()
    vi.stubGlobal("EventSource", MockEventSource)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("does not multiply streams for repeated subscribers to one session", () => {
    const unsubscribers = Array.from({ length: 3 }, () =>
      subscribeChatStream("agent:main:shared", vi.fn()),
    )

    expect(MockEventSource.instances).toHaveLength(1)
    expect(activeChatStreamCount()).toBe(1)

    unsubscribers[0]()
    unsubscribers[1]()
    vi.advanceTimersByTime(300)
    expect(MockEventSource.instances[0].closed).toBe(false)

    unsubscribers[2]()
    vi.advanceTimersByTime(300)
    expect(MockEventSource.instances[0].closed).toBe(true)
    expect(activeChatStreamCount()).toBe(0)
  })

  it("fans out 50 shared message updates to 3 tab subscribers", () => {
    const subscribers = [vi.fn(), vi.fn(), vi.fn()]
    const unsubscribers = subscribers.map((subscriber) =>
      subscribeChatSessionMessages("agent:main:shared", subscriber),
    )

    for (let i = 0; i < 50; i++) {
      publishChatSessionMessages("agent:main:shared", [
        { messageId: `a${i}`, role: "assistant", text: `message ${i}` },
      ])
    }

    for (const subscriber of subscribers) {
      expect(subscriber).toHaveBeenCalledTimes(50)
      expect(subscriber).toHaveBeenLastCalledWith(
        [{ messageId: "a49", role: "assistant", text: "message 49" }],
        undefined,
      )
    }

    unsubscribers.forEach((unsubscribe) => unsubscribe())
  })
})
