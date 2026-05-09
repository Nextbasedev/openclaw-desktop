import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"
import { dedupeChatMessages } from "../../chatMessageDedupe"

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

  test("uses stable OpenClaw ids so replayed patches do not duplicate history", () => {
    const state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "assistant", text: "hel", __openclaw: { id: "oc_2", seq: 2 } } },
        createdAtMs: 1,
      },
    })
    const next = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "assistant", text: "hello", __openclaw: { id: "oc_2", seq: 2 } } },
        createdAtMs: 2,
      },
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ messageId: "oc_2", role: "assistant", text: "hello" })
  })

  test("merges bootstrap history and patch messages with the same OpenClaw id", () => {
    const bootstrap = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "first", __openclaw: { id: "oc_1", seq: 1 } } },
        createdAtMs: 1,
      },
    }).messages
    const replay = applyChatPatch({ cursor: 1, messages: bootstrap }, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "first", __openclaw: { id: "oc_1", seq: 1 } } },
        createdAtMs: 2,
      },
    }).messages
    expect(dedupeChatMessages([...bootstrap, ...replay])).toHaveLength(1)
  })
})
