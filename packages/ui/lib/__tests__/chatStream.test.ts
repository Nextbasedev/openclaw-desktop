import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { subscribeChatStream, activeChatStreamCount } from "../chatStream"

type Listener = (event: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []
  listeners = new Map<string, Listener[]>()
  onerror: (() => void) | null = null
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

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, data: JSON.stringify(data) } as MessageEvent)
    }
  }

  close() {
    this.closed = true
  }
}

describe("shared chat stream", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("shares one EventSource for multiple subscribers to the same session", () => {
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = subscribeChatStream("agent:main:test", first)
    const unsubscribeSecond = subscribeChatStream("agent:main:test", second)

    expect(MockEventSource.instances).toHaveLength(1)
    expect(activeChatStreamCount()).toBe(1)

    MockEventSource.instances[0].emit("chat.tool", { toolCallId: "tc_1" })

    expect(first).toHaveBeenCalledWith({
      type: "chat.tool",
      data: { type: "chat.tool", toolCallId: "tc_1" },
    })
    expect(second).toHaveBeenCalledWith({
      type: "chat.tool",
      data: { type: "chat.tool", toolCallId: "tc_1" },
    })

    unsubscribeFirst()
    vi.advanceTimersByTime(300)
    expect(MockEventSource.instances[0].closed).toBe(false)

    unsubscribeSecond()
    vi.advanceTimersByTime(300)
    expect(MockEventSource.instances[0].closed).toBe(true)
    expect(activeChatStreamCount()).toBe(0)
  })
})
