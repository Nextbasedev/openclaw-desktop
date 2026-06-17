import { describe, it, expect } from "vitest"

import {
  decideBootstrapRecovery,
  RECOVERY_DEBOUNCE_MS,
  RECOVERY_GRACE_AFTER_BOOTSTRAP_MS,
} from "../bootstrapRecoveryGuard"

const NOW = 1_700_000_000_000

const base = {
  isLoading: false,
  streamStatus: "idle" as const,
  hasUserMessage: true,
  lastBootstrapCompletedAt: 0,
  lastRecoveryAt: 0,
  now: NOW,
}

describe("decideBootstrapRecovery", () => {
  it("applies when nothing blocks it (long-lived session, fresh recovery)", () => {
    expect(decideBootstrapRecovery(base)).toEqual({ apply: true, reason: "apply" })
  })

  it("skips while an active run (thinking/streaming) is rendering optimistic user bubble", () => {
    expect(
      decideBootstrapRecovery({ ...base, streamStatus: "thinking", hasUserMessage: true }),
    ).toEqual({ apply: false, reason: "skipped-active-run" })
  })

  it("does not treat active streamStatus alone as a skip — requires a user message too", () => {
    // After unmount/remount the registry may have left an active status with
    // no rendered user message yet. We should still apply (cold-render path).
    expect(
      decideBootstrapRecovery({ ...base, streamStatus: "thinking", hasUserMessage: false }),
    ).toEqual({ apply: true, reason: "apply" })
  })

  it("skips while an earlier resetToLiveTail is in-flight (state.loading still true)", () => {
    expect(decideBootstrapRecovery({ ...base, isLoading: true })).toEqual({
      apply: false,
      reason: "skipped-loading",
    })
  })

  it("skips when cold bootstrap just resolved (kills the single skeleton blink)", () => {
    // This is the exact case Krish reported: messages just rendered after the
    // initial fetch, then the SSE hello frame dispatched
    // openclaw:chat-bootstrap-recovery; without this guard, resetToLiveTail
    // would fire, blank the messages, render skeleton again, then refetch.
    const result = decideBootstrapRecovery({
      ...base,
      lastBootstrapCompletedAt: NOW - 500,
    })
    expect(result.apply).toBe(false)
    expect(result.reason).toBe("skipped-recent-bootstrap")
    expect(result.elapsedMs).toBe(500)
  })

  it("applies once the grace window after bootstrap elapses", () => {
    expect(
      decideBootstrapRecovery({
        ...base,
        lastBootstrapCompletedAt: NOW - (RECOVERY_GRACE_AFTER_BOOTSTRAP_MS + 1),
      }),
    ).toEqual({ apply: true, reason: "apply" })
  })

  it("skips when previous accepted recovery is within debounce window", () => {
    const result = decideBootstrapRecovery({
      ...base,
      lastRecoveryAt: NOW - 1000,
    })
    expect(result.apply).toBe(false)
    expect(result.reason).toBe("debounced")
    expect(result.elapsedMs).toBe(1000)
  })

  it("applies after debounce window has elapsed", () => {
    expect(
      decideBootstrapRecovery({
        ...base,
        lastRecoveryAt: NOW - (RECOVERY_DEBOUNCE_MS + 1),
      }),
    ).toEqual({ apply: true, reason: "apply" })
  })

  it("prefers active-run skip over recent-bootstrap or debounce when both apply", () => {
    expect(
      decideBootstrapRecovery({
        ...base,
        streamStatus: "thinking",
        hasUserMessage: true,
        lastBootstrapCompletedAt: NOW - 100,
        lastRecoveryAt: NOW - 100,
      }),
    ).toEqual({ apply: false, reason: "skipped-active-run" })
  })

  it("prefers loading skip over recent-bootstrap or debounce when both apply", () => {
    expect(
      decideBootstrapRecovery({
        ...base,
        isLoading: true,
        lastBootstrapCompletedAt: NOW - 100,
        lastRecoveryAt: NOW - 100,
      }),
    ).toEqual({ apply: false, reason: "skipped-loading" })
  })

  it("prefers recent-bootstrap skip over debounce when both apply", () => {
    // The single-blink fix takes precedence over the loop-breaker debounce in
    // diagnostics so we can distinguish "fresh fetch already covered this"
    // from "many recoveries in a row".
    expect(
      decideBootstrapRecovery({
        ...base,
        lastBootstrapCompletedAt: NOW - 200,
        lastRecoveryAt: NOW - 200,
      })?.reason,
    ).toBe("skipped-recent-bootstrap")
  })

  it("honors test overrides for grace and debounce windows", () => {
    expect(
      decideBootstrapRecovery({
        ...base,
        lastBootstrapCompletedAt: NOW - 200,
        graceAfterBootstrapMs: 100,
      }),
    ).toEqual({ apply: true, reason: "apply" })

    expect(
      decideBootstrapRecovery({
        ...base,
        lastRecoveryAt: NOW - 200,
        debounceMs: 100,
      }),
    ).toEqual({ apply: true, reason: "apply" })
  })

  it("ignores negative deltas (clock skew safety)", () => {
    // If now is somehow earlier than the recorded timestamp (system clock
    // adjustment), we should treat the comparison as 'apply' rather than
    // permanently skipping.
    expect(
      decideBootstrapRecovery({
        ...base,
        lastBootstrapCompletedAt: NOW + 5000,
        lastRecoveryAt: NOW + 5000,
      }),
    ).toEqual({ apply: true, reason: "apply" })
  })
})
