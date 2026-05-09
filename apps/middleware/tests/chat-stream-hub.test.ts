import { afterEach, describe, expect, it, vi } from "vitest"

const gatewayState = vi.hoisted(() => ({
  connectCalls: [] as any[],
  listener: null as null | ((message: any) => void),
}))

vi.mock("../src/services/gateway.js", () => ({
  withGatewayReadRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  connectGateway: vi.fn(async (...args: any[]) => {
    gatewayState.connectCalls.push(args)
    return {
      request: vi.fn(async () => ({ ok: true, payload: {} })),
      on: vi.fn((listener: (message: any) => void) => {
        gatewayState.listener = listener
        return vi.fn()
      }),
      close: vi.fn(),
    }
  }),
}))

const hub = await import("../src/services/chat-stream-hub.js")

function makeClient(sessionKey: string) {
  const writes: string[] = []
  const cleanup = hub.registerChatStreamClient({
    requestedSessionKey: sessionKey,
    activeSessionKey: sessionKey,
    res: { write: (chunk: string) => { writes.push(chunk); return true } },
  })
  return { writes, cleanup }
}

afterEach(() => {
  hub.resetChatStreamHubForTests()
  gatewayState.connectCalls.length = 0
  gatewayState.listener = null
})

describe("chat stream hub", () => {
  it("uses one shared event gateway for multiple chat stream clients", async () => {
    makeClient("agent:main:a")
    makeClient("agent:main:b")
    await vi.waitFor(() => expect(gatewayState.connectCalls).toHaveLength(1))
    expect(gatewayState.connectCalls[0][1]).toMatchObject({ purpose: "event" })
  })

  it("fanout sends matching session messages to subscribed clients", () => {
    const a = makeClient("agent:main:a")
    const b = makeClient("agent:main:b")
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:a", message: { id: "m1", role: "assistant", text: "hello" } } } as any)
    expect(a.writes.join("\n")).toContain("hello")
    expect(b.writes.join("\n")).not.toContain("hello")
  })

  it("does not send unrelated session events to a client", () => {
    const a = makeClient("agent:main:a")
    hub.handleGatewayEvent({ type: "event", event: "session.tool", payload: { sessionKey: "agent:main:b", data: { name: "x", phase: "start" } } } as any)
    expect(a.writes.join("\n")).not.toContain("chat.tool")
  })

  it("does not broadcast session events that have no session key", () => {
    const a = makeClient("agent:main:a")
    const b = makeClient("agent:main:b")
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { message: { role: "assistant", text: "leak" } } } as any)
    expect(a.writes.join("\n")).not.toContain("leak")
    expect(b.writes.join("\n")).not.toContain("leak")
  })

  it("closing one UI SSE client does not close shared event gateway", async () => {
    const a = makeClient("agent:main:a")
    makeClient("agent:main:b")
    await vi.waitFor(() => expect(gatewayState.connectCalls).toHaveLength(1))
    a.cleanup()
    expect(gatewayState.connectCalls).toHaveLength(1)
    expect(hub.activeChatStreamClientCountForTests()).toBe(1)
  })

  it("write failure removes only the failing UI client", () => {
    const failingWrites: string[] = []
    hub.registerChatStreamClient({
      requestedSessionKey: "agent:main:a",
      activeSessionKey: "agent:main:a",
      res: { write: (chunk: string) => { failingWrites.push(chunk); throw new Error("closed") } },
    })
    const ok = makeClient("agent:main:a")
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:a", message: { role: "assistant", text: "ok" } } } as any)
    expect(ok.writes.join("\n")).toContain("ok")
    expect(hub.activeChatStreamClientCountForTests()).toBe(1)
  })
})
