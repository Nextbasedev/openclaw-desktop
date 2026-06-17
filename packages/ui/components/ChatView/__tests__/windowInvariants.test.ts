import { afterEach, describe, expect, test, vi } from "vitest"
import { INITIAL_WINDOW_STATE, MAX_LOADED, type WindowState } from "../messageWindow"
import {
  WindowInvariantViolationError,
  assertWindowInvariant,
  type WindowInvariantRow,
} from "../windowInvariants"

function makeRow(seq: number | null | undefined, messageId = `m${seq ?? "x"}`): WindowInvariantRow {
  return { messageId, gatewayIndex: seq }
}

function makeRows(seqs: ReadonlyArray<number | null | undefined>): WindowInvariantRow[] {
  return seqs.map((seq, i) => makeRow(seq, `m${i}`))
}

function makeWindowState(overrides: Partial<WindowState> = {}): WindowState {
  return { ...INITIAL_WINDOW_STATE, ...overrides }
}

describe("assertWindowInvariant", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("happy path: short ordered buffer with matching seq boundaries", () => {
    const messages = makeRows([10, 11, 12, 13])
    const windowState = makeWindowState({
      oldestLoadedSeq: 10,
      newestLoadedSeq: 13,
    })
    expect(() => assertWindowInvariant(windowState, messages)).not.toThrow()
  })

  test("happy path: empty messages with null boundaries", () => {
    expect(() => assertWindowInvariant(INITIAL_WINDOW_STATE, [])).not.toThrow()
  })

  test("happy path: all seqless rows are ignored by the ordering/boundary checks", () => {
    const messages = makeRows([undefined, undefined, null])
    const windowState = makeWindowState({ oldestLoadedSeq: null, newestLoadedSeq: null })
    expect(() => assertWindowInvariant(windowState, messages)).not.toThrow()
  })

  test("happy path: seqless rows interleaved between seqful ones do not break ASC check", () => {
    const messages: WindowInvariantRow[] = [
      makeRow(10),
      makeRow(undefined, "live:R1:tools"),
      makeRow(11),
      makeRow(12),
      makeRow(undefined, "live:R2:tools"),
    ]
    const windowState = makeWindowState({
      oldestLoadedSeq: 10,
      // last SEQFUL row is the one with gatewayIndex=12.
      newestLoadedSeq: 12,
    })
    expect(() => assertWindowInvariant(windowState, messages)).not.toThrow()
  })

  test("violation: messages.length exceeds MAX_LOADED throws in dev", () => {
    const messages = makeRows(Array.from({ length: MAX_LOADED + 1 }, (_, i) => i + 1))
    const windowState = makeWindowState({ oldestLoadedSeq: 1, newestLoadedSeq: MAX_LOADED + 1 })
    expect(() => assertWindowInvariant(windowState, messages, "test-length")).toThrow(
      WindowInvariantViolationError,
    )
  })

  test("violation: messages not sorted ASC by seq throws in dev", () => {
    const messages = makeRows([10, 12, 11])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 11 })
    expect(() => assertWindowInvariant(windowState, messages, "test-sort")).toThrow(
      /sorted strictly ASC/,
    )
  })

  test("violation: duplicate seqs are detected (ASC means strictly increasing)", () => {
    const messages = makeRows([10, 10, 11])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 11 })
    expect(() => assertWindowInvariant(windowState, messages)).toThrow(/sorted strictly ASC/)
  })

  test("violation: oldestLoadedSeq does not match first seqful row throws", () => {
    const messages = makeRows([10, 11, 12])
    const windowState = makeWindowState({ oldestLoadedSeq: 5, newestLoadedSeq: 12 })
    expect(() => assertWindowInvariant(windowState, messages)).toThrow(
      /oldestLoadedSeq matches first seqful row/,
    )
  })

  test("violation: newestLoadedSeq does not match last seqful row throws", () => {
    const messages = makeRows([10, 11, 12])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 99 })
    expect(() => assertWindowInvariant(windowState, messages)).toThrow(
      /newestLoadedSeq matches last seqful row/,
    )
  })

  test("violation: oldestLoadedSeq > newestLoadedSeq throws", () => {
    // Both seq boundaries set, no messages so the matching checks pass; only
    // rule 5 should fire.
    const windowState = makeWindowState({ oldestLoadedSeq: 50, newestLoadedSeq: 10 })
    expect(() => assertWindowInvariant(windowState, [])).toThrow(
      /oldestLoadedSeq <= newestLoadedSeq/,
    )
  })

  test("label is included in the thrown error message", () => {
    const messages = makeRows([10, 9])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 9 })
    expect(() => assertWindowInvariant(windowState, messages, "after-older-page")).toThrow(
      /\[after-older-page\]/,
    )
  })

  test("production mode warns instead of throwing (length violation)", () => {
    vi.stubEnv("NODE_ENV", "production")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const messages = makeRows(Array.from({ length: MAX_LOADED + 1 }, (_, i) => i + 1))
    const windowState = makeWindowState({ oldestLoadedSeq: 1, newestLoadedSeq: MAX_LOADED + 1 })
    expect(() =>
      assertWindowInvariant(windowState, messages, "prod-length"),
    ).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      "[chat-rebuild.window.invariant-violation]",
      expect.objectContaining({ rule: expect.stringContaining("MAX_LOADED") }),
    )
    warnSpy.mockRestore()
  })

  test("production mode warns instead of throwing (sort violation)", () => {
    vi.stubEnv("NODE_ENV", "production")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const messages = makeRows([10, 9])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 9 })
    expect(() => assertWindowInvariant(windowState, messages, "prod-sort")).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      "[chat-rebuild.window.invariant-violation]",
      expect.objectContaining({ rule: expect.stringContaining("ASC") }),
    )
    warnSpy.mockRestore()
  })

  test("non-production NODE_ENV (e.g. 'test', 'development') still throws", () => {
    vi.stubEnv("NODE_ENV", "test")
    const messages = makeRows([10, 9])
    const windowState = makeWindowState({ oldestLoadedSeq: 10, newestLoadedSeq: 9 })
    expect(() => assertWindowInvariant(windowState, messages)).toThrow(
      WindowInvariantViolationError,
    )
  })
})
