import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/services/gateway.js", () => ({
  withGatewayReadRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  connectGateway: vi.fn(async () => ({ request: vi.fn(async () => ({ ok: true })), on: vi.fn(() => vi.fn()), close: vi.fn() })),
}))

const hub = await import("../src/services/chat-stream-hub.js")

function client(sessionKey = "agent:main:a") {
  const writes: string[] = []
  const cleanup = hub.registerChatStreamClient({ requestedSessionKey: sessionKey, activeSessionKey: sessionKey, res: { write: (chunk: string) => { writes.push(chunk); return true } } })
  return { writes, cleanup }
}

afterEach(() => hub.resetChatStreamHubForTests())

describe("chat stream hub event mapping", () => {
  it("emits chat.message and done status for assistant session.message", () => {
    const c = client()
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:a", message: { id: "m1", role: "assistant", text: "hello", content: [{ type: "text", text: "hello" }] } } } as any)
    const output = c.writes.join("\n")
    expect(output).toContain("chat.message")
    expect(output).toContain("hello")
    expect(output).toContain("chat.status")
    expect(output).toContain("done")
  })

  it("emits streaming and done states for live chat delta/final events", () => {
    const c = client()
    hub.handleGatewayEvent({ type: "event", event: "chat", payload: { sessionKey: "agent:main:a", runId: "r1", state: "delta", message: { content: [{ type: "text", text: "partial" }] } } } as any)
    hub.handleGatewayEvent({ type: "event", event: "chat", payload: { sessionKey: "agent:main:a", runId: "r1", state: "final", message: { content: [{ type: "text", text: "final answer" }] }, usage: { total: 12 }, stopReason: "stop" } } as any)
    const output = c.writes.join("\n")
    expect(output).toContain("chat.message")
    expect(output).toContain("partial")
    expect(output).toContain("final answer")
    expect(output).toContain("streaming")
    expect(output).toContain("done")
  })

  it("ignores user messages for visible assistant output", () => {
    const c = client()
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:a", message: { id: "u1", role: "user", text: "secret" } } } as any)
    expect(c.writes.join("\n")).not.toContain("secret")
  })

  it("emits chat.tool for session.tool events", () => {
    const c = client()
    hub.handleGatewayEvent({ type: "event", event: "session.tool", payload: { sessionKey: "agent:main:a", runId: "r1", data: { phase: "start", name: "read", toolCallId: "tc1", args: { path: "x" } } } } as any)
    const output = c.writes.join("\n")
    expect(output).toContain("chat.tool")
    expect(output).toContain("read")
    expect(output).toContain("tool_running")
  })

  it("ignores unrelated subagent events except link bookkeeping placeholder", () => {
    const c = client("agent:main:parent")
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:child:subagent:abc", message: { role: "assistant", text: "child" } } } as any)
    expect(c.writes.join("\n")).not.toContain("child")
  })
})
