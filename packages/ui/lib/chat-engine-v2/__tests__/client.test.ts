import { beforeEach, describe, expect, it, vi } from "vitest"

describe("middleware-v2 client", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL
  })

  it("defaults to the legacy middleware port", async () => {
    const { getMiddlewareV2Url } = await import("../client")
    expect(getMiddlewareV2Url()).toBe("http://127.0.0.1:8787")
  })

  it("rewrites loopback v2 URL to the browser host on port 8787", async () => {
    vi.stubGlobal("window", { location: { hostname: "192.0.2.10" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) })
    process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL = "http://127.0.0.1:8787"
    const { getMiddlewareV2Url } = await import("../client")
    expect(getMiddlewareV2Url()).toBe("http://192.0.2.10:8787")
  })
  it("does not rewrite loopback URLs inside the Tauri localhost origin", async () => {
    vi.stubGlobal("window", { location: { hostname: "tauri.localhost" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) })
    process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL = "http://127.0.0.1:8787"
    const { getMiddlewareV2Url } = await import("../client")
    expect(getMiddlewareV2Url()).toBe("http://127.0.0.1:8787")
  })

  it("uses the active Connect page middleware URL before the v2 override", async () => {
    const data = new Map<string, string>([
      ["openclaw.middleware.url", "https://remote.example.com/"],
      ["openclaw.middleware.token", "remote-token"],
      ["openclaw.middleware.v2.url", "http://127.0.0.1:8787"],
    ])
    vi.stubGlobal("window", { location: { hostname: "tauri.localhost" }, console, addEventListener: vi.fn() })
    vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => data.get(key) ?? null) })
    const { getMiddlewareV2Url } = await import("../client")
    expect(getMiddlewareV2Url()).toBe("https://remote.example.com")
  })
})
