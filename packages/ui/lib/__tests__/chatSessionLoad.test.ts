import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  activeChatStreamCount,
  CHAT_STREAM_CLOSE_GRACE_MS,
  clearChatStreamsForTests,
  subscribeChatStream,
} from "../chatStream"

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
    vi.stubGlobal("EventSource", MockEventSource)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    clearChatStreamsForTests()
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
    vi.advanceTimersByTime(CHAT_STREAM_CLOSE_GRACE_MS)
    expect(MockEventSource.instances[0].closed).toBe(true)
    expect(activeChatStreamCount()).toBe(0)
  })

})
