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

  it("forwards live tool partial output and final error markers", () => {
    const c = client()
    hub.handleGatewayEvent({ type: "event", event: "session.tool", payload: { sessionKey: "agent:main:a", runId: "r1", data: { phase: "update", name: "exec", toolCallId: "tc1", partialResult: { stdout: "live output" } } } } as any)
    hub.handleGatewayEvent({ type: "event", event: "session.tool", payload: { sessionKey: "agent:main:a", runId: "r1", data: { phase: "result", name: "exec", toolCallId: "tc1", isError: true, result: { message: "failed" } } } } as any)

    const output = c.writes.join("\n")
    expect(output).toContain("partialResult")
    expect(output).toContain("live output")
    expect(output).toContain("isError")
    expect(output).toContain("failed")
  })

  it("ignores unrelated subagent events except link bookkeeping placeholder", () => {
    const c = client("agent:main:parent")
    hub.handleGatewayEvent({ type: "event", event: "session.message", payload: { sessionKey: "agent:main:child:subagent:abc", message: { role: "assistant", text: "child" } } } as any)
    expect(c.writes.join("\n")).not.toContain("child")
  })
})
