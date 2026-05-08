import { describe, expect, it, vi } from "vitest"
import { isGatewayTransientError, withGatewayReadRetry } from "../src/services/gateway.js"

describe("gateway read retry helpers", () => {
  it.each([
    "gateway websocket closed before open",
    "gateway websocket closed waiting for connect.challenge",
    "gateway websocket closed waiting for chat.history",
    "timeout waiting for connect.challenge",
    "gateway websocket open timeout",
    "WebSocket is not open",
    "socket closed during response wait",
  ])("classifies transient transport error: %s", (message) => {
    expect(isGatewayTransientError(new Error(message))).toBe(true)
  })

  it.each([
    "INVALID_REQUEST",
    "BAD_REQUEST",
    "Device not paired with gateway",
    "sessions.patch failed",
    "chat.history failed",
    "scope denied",
  ])("does not classify application error: %s", (message) => {
    expect(isGatewayTransientError(new Error(message))).toBe(false)
  })

  it("retries a read once after transient gateway close", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("gateway websocket closed waiting for chat.history"))
      .mockResolvedValueOnce({ ok: true })

    await expect(withGatewayReadRetry(fn)).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does not retry application errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("INVALID_REQUEST"))

    await expect(withGatewayReadRetry(fn)).rejects.toThrow("INVALID_REQUEST")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("surfaces the second failure after one retry", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("WebSocket is not open"))
      .mockRejectedValueOnce(new Error("still closed"))

    await expect(withGatewayReadRetry(fn)).rejects.toThrow("still closed")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
