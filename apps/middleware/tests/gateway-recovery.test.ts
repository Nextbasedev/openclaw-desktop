import { afterEach, describe, expect, it, vi } from "vitest"

const gatewayState = vi.hoisted(() => ({ requests: [] as Array<{ method: string; params: any }> }))

vi.mock("../src/services/gateway.js", () => ({
  withGatewayReadRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  connectGateway: vi.fn(async () => ({
    request: vi.fn(async (method: string, params: any) => {
      gatewayState.requests.push({ method, params })
      return { ok: true, payload: {} }
    }),
    close: vi.fn(),
    on: vi.fn(() => vi.fn()),
  })),
}))

const recovery = await import("../src/services/gateway-recovery.js")

afterEach(() => {
  recovery.resetGatewayRecoveryForTests()
  gatewayState.requests.length = 0
})

describe("gateway recovery", () => {
  it("does not emit UI reconnect status before two minutes", () => {
    const emit = vi.fn()
    recovery.configureGatewayRecovery({ emit })
    recovery.markGatewayDisconnected("event", 0)
    recovery.maybeEmitRecoveryStatus(119_000)
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits live updates delayed after event stream is down for two minutes", () => {
    const emit = vi.fn()
    recovery.configureGatewayRecovery({ emit })
    recovery.markGatewayDisconnected("event", 0)
    recovery.maybeEmitRecoveryStatus(120_000)
    expect(emit).toHaveBeenCalledWith("chat.status", expect.objectContaining({ label: expect.stringContaining("Live updates delayed") }))
  })

  it("emits retry/troubleshooting status after five minutes", () => {
    const emit = vi.fn()
    recovery.configureGatewayRecovery({ emit })
    recovery.markGatewayDisconnected("rpc", 0)
    recovery.maybeEmitRecoveryStatus(300_000)
    expect(emit).toHaveBeenCalledWith("chat.status", expect.objectContaining({ state: "connection_action" }))
  })

  it("on event reconnect refreshes sessions list and open chat histories", async () => {
    recovery.configureGatewayRecovery({ getOpenSessionKeys: () => ["agent:main:a", "agent:main:b"] })
    await recovery.markGatewayReconnected("event")
    expect(gatewayState.requests.map((r) => r.method)).toEqual(["sessions.list", "chat.history", "chat.history"])
    expect(gatewayState.requests[1].params.sessionKey).toBe("agent:main:a")
  })
})
