import { describe, expect, it } from "vitest"
import { parseMiddlewarePairingInput } from "./middlewarePairingInput"

describe("parseMiddlewarePairingInput", () => {
  it("extracts URL and pairing code from setup output", () => {
    expect(parseMiddlewarePairingInput(`Middleware URL: https://server.test\nPairing code: ABC-123\nVerified: passed`)).toEqual({
      url: "https://server.test",
      pairingCode: "ABC-123",
    })
  })

  it("extracts URL and pairing code from env-style output", () => {
    expect(parseMiddlewarePairingInput("MIDDLEWARE_TEST_URL=http://100.79.1.2:8787 MIDDLEWARE_PAIRING_CODE=PAIR1234")).toEqual({
      url: "http://100.79.1.2:8787",
      pairingCode: "PAIR1234",
    })
  })

  it("extracts pairing code from URL query params", () => {
    expect(parseMiddlewarePairingInput("https://server.test?pairing_code=ABCD-12")).toEqual({
      url: "https://server.test?pairing_code=ABCD-12",
      pairingCode: "ABCD-12",
    })
  })

  it("treats a standalone short code as a pairing code", () => {
    expect(parseMiddlewarePairingInput("abc 123")).toEqual({ pairingCode: "ABC123" })
  })
})
