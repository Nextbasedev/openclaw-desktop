import { afterEach, describe, expect, it, vi } from "vitest"
import { clearDedupeForTests, dedupeRequest, invalidateDedupe } from "../requestDedupe"

afterEach(() => {
  clearDedupeForTests()
  vi.useRealTimers()
})

describe("dedupeRequest", () => {
  it("dedupes concurrent requests with the same key", async () => {
    const fn = vi.fn(async () => "ok")
    const first = dedupeRequest("same", fn)
    const second = dedupeRequest("same", fn)
    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("does not dedupe different keys", async () => {
    const fn = vi.fn(async (value: string) => value)
    await Promise.all([
      dedupeRequest("a", () => fn("a")),
      dedupeRequest("b", () => fn("b")),
    ])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("returns cached value within ttl for cacheable reads", async () => {
    const fn = vi.fn(async () => ({ value: Math.random() }))
    const first = await dedupeRequest("ttl", fn, { ttlMs: 1000 })
    const second = await dedupeRequest("ttl", fn, { ttlMs: 1000 })
    expect(second).toBe(first)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("drops cache entry after ttl", async () => {
    vi.useFakeTimers()
    let value = 0
    const fn = vi.fn(async () => ++value)
    await expect(dedupeRequest("ttl", fn, { ttlMs: 1000 })).resolves.toBe(1)
    vi.advanceTimersByTime(1001)
    await expect(dedupeRequest("ttl", fn, { ttlMs: 1000 })).resolves.toBe(2)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does not cache rejected promise", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok")
    await expect(dedupeRequest("reject", fn, { ttlMs: 1000 })).rejects.toThrow("boom")
    await expect(dedupeRequest("reject", fn, { ttlMs: 1000 })).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("supports explicit invalidation by prefix", async () => {
    const fn = vi.fn(async () => "ok")
    await dedupeRequest("voice-settings", fn, { ttlMs: 1000 })
    invalidateDedupe("voice")
    await dedupeRequest("voice-settings", fn, { ttlMs: 1000 })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
