import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"

describe("applyChatPatch", () => {
  test("ignores stale cursors", () => {
    const state = { cursor: 2, messages: [] }
    const next = applyChatPatch(state, {
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { message: { role: "user", text: "old", id: "m1" } }, createdAtMs: 1 },
    })
    expect(next).toBe(state)
  })

  test("appends chat.message.upsert payload", () => {
    const next = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { message: { role: "user", text: "hello", id: "m1" } }, createdAtMs: 1 },
    })
    expect(next.cursor).toBe(1)
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ messageId: "m1", role: "user", text: "hello" })
  })
})
