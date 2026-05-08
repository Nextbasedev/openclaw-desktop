import { afterEach, describe, expect, it } from "vitest"
import { clearActiveRunReconcileLockForTests, tryAcquireActiveRunReconcileLock } from "../activeRunReconcileLock"

const sessionKey = "agent:main:lock-test"

afterEach(() => clearActiveRunReconcileLockForTests(sessionKey))

describe("tryAcquireActiveRunReconcileLock", () => {
  it("allows the first reconcile for a session", () => {
    expect(tryAcquireActiveRunReconcileLock(sessionKey, 1000, 10_000)).toBe(true)
  })

  it("blocks duplicate reconciles during the ttl", () => {
    expect(tryAcquireActiveRunReconcileLock(sessionKey, 1000, 10_000)).toBe(true)
    expect(tryAcquireActiveRunReconcileLock(sessionKey, 2000, 10_000)).toBe(false)
  })

  it("allows another reconcile after the ttl", () => {
    expect(tryAcquireActiveRunReconcileLock(sessionKey, 1000, 10_000)).toBe(true)
    expect(tryAcquireActiveRunReconcileLock(sessionKey, 12_000, 10_000)).toBe(true)
  })
})
