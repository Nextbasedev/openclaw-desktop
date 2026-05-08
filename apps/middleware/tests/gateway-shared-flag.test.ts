import { afterEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

async function loadGatewayModule() {
  return import("../src/services/gateway.js")
}

describe("shared gateway feature flag", () => {
  it.each(["1", "true", "TRUE", "yes", "on"])("enables shared gateway for %s", async (value) => {
    process.env.MIDDLEWARE_SHARED_GATEWAY = value
    const { isSharedGatewayEnabled } = await loadGatewayModule()
    expect(isSharedGatewayEnabled()).toBe(true)
  })

  it.each([undefined, "", "0", "false", "no", "off", "random"])("disables shared gateway for %s", async (value) => {
    if (value === undefined) delete process.env.MIDDLEWARE_SHARED_GATEWAY
    else process.env.MIDDLEWARE_SHARED_GATEWAY = value
    const { isSharedGatewayEnabled } = await loadGatewayModule()
    expect(isSharedGatewayEnabled()).toBe(false)
  })

  it("shared handle close is a no-op release and does not close underlying client", async () => {
    const { createSharedGatewayHandleForTests } = await loadGatewayModule()
    const closeUnderlying = vi.fn()
    const request = vi.fn()
    const on = vi.fn(() => vi.fn())

    const handle = createSharedGatewayHandleForTests({ request, on, closeUnderlying })
    handle.close()
    handle.release?.()

    expect(closeUnderlying).not.toHaveBeenCalled()
  })
})
