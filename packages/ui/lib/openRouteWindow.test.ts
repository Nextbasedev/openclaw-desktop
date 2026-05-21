import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { routeWindowUrl } from "./openRouteWindow"

function mockWindow(overrides: Partial<Window> = {}) {
  vi.stubGlobal("window", {
    location: { protocol: "file:", href: "file:///app/index.html" },
    __TAURI_INTERNALS__: {},
    ...overrides,
  })
}

describe("openRouteWindow", () => {
  beforeEach(() => {
    mockWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("places window params before the hash route", () => {
    expect(routeWindowUrl("/chat-1", "window-test")).toBe(
      "/?openclawWindowId=window-test#/chat-1",
    )
  })

  it("adds native chrome only when requested", () => {
    expect(routeWindowUrl("/chat-1", "window-test", false)).toBe(
      "/?openclawWindowId=window-test#/chat-1",
    )
    expect(routeWindowUrl("/chat-1", "window-test", true)).toBe(
      "/?openclawNativeChrome=true&openclawWindowId=window-test#/chat-1",
    )
  })
})
