import { describe, expect, test } from "vitest"
import { chatSendIdempotencyKey } from "../idempotency"

describe("chatSendIdempotencyKey", () => {
  test("is stable for same session and optimistic message", () => {
    expect(chatSendIdempotencyKey("s1", "m1")).toBe(chatSendIdempotencyKey("s1", "m1"))
  })

  test("changes by optimistic message", () => {
    expect(chatSendIdempotencyKey("s1", "m1")).not.toBe(chatSendIdempotencyKey("s1", "m2"))
  })
})
