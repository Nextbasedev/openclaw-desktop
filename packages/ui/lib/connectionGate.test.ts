import { describe, expect, test } from "vitest"
import { appHasLiveConnection } from "./connectionGate"

describe("app connection gate", () => {
  test("does not unlock the app from saved configuration alone", () => {
    expect(appHasLiveConnection({ hasConnection: false })).toBe(false)
    expect(appHasLiveConnection(undefined)).toBe(false)
    expect(appHasLiveConnection(null)).toBe(false)
  })

  test("only unlocks the app for a real connected status", () => {
    expect(appHasLiveConnection({ hasConnection: true })).toBe(true)
  })
})
