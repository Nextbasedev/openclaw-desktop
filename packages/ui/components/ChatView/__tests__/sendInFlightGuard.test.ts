import { describe, expect, it } from "vitest"
import { beginSendIfIdle, endSend } from "../sendInFlightGuard"

describe("send in-flight guard", () => {
  it("allows one active send and rejects duplicate sends until released", () => {
    const ref = { current: false }

    expect(beginSendIfIdle(ref)).toBe(true)
    expect(ref.current).toBe(true)
    expect(beginSendIfIdle(ref)).toBe(false)

    endSend(ref)
    expect(ref.current).toBe(false)
    expect(beginSendIfIdle(ref)).toBe(true)
  })
})
