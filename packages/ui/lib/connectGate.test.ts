import { describe, expect, test } from "vitest"
import { shouldForceConnectGate } from "./connectGate"

describe("shouldForceConnectGate", () => {
  test("does not force connect when middleware is available", () => {
    expect(shouldForceConnectGate({
      initialConnect: false,
      activeTab: "chat",
      routePath: "/",
    })).toBe(false)
  })

  test("forces connect when disconnected but still on chat/dashboard", () => {
    expect(shouldForceConnectGate({
      initialConnect: true,
      activeTab: "chat",
      routePath: "/",
    })).toBe(true)
  })

  test("does not force again when already on connect page", () => {
    expect(shouldForceConnectGate({
      initialConnect: true,
      activeTab: "connect",
      routePath: "/connect",
    })).toBe(false)
  })
})
