import { describe, expect, test } from "vitest"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "../applyPatches"
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

  test("marks V2 send patches as optimistic so later gateway user echoes dedupe", () => {
    const optimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "third", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client:key", seq: 0 } } },
        createdAtMs: 1,
      },
    }).messages
    const gatewayEcho = applyChatPatch({ cursor: 1, messages: optimistic }, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "third", __openclaw: { id: "oc_3", seq: 3 } } },
        createdAtMs: 2,
      },
    }).messages
    expect(gatewayEcho).toHaveLength(1)
    expect(gatewayEcho[0]).toMatchObject({ role: "user", text: "third" })
  })

  test("atomically confirms optimistic client message with Gateway echo", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "byy", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client:key" } } },
        createdAtMs: 1,
      },
    })
    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: { optimisticId: "client:key", message: { role: "user", text: "byy", __openclaw: { id: "oc_4", seq: 4 } } },
        createdAtMs: 2,
      },
    })
    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({ messageId: "oc_4", role: "user", text: "byy" })
  })

  test("extracts V2 status patches for cross-tab thinking", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: { cursor: 1, type: "chat.status", sessionKey: "s1", payload: { status: "thinking", statusLabel: "Thinking" }, createdAtMs: 1 },
    })).toEqual({ status: "thinking", label: "Thinking" })
  })

  test("extracts terminal status from session.upsert patches", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: { cursor: 1, type: "session.upsert", sessionKey: "s1", payload: { status: "done" }, createdAtMs: 1 },
    })).toEqual({ status: "done", label: null })
  })

  test("treats optimistic user patches as active run signals", () => {
    expect(patchImpliesActiveRun({
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { optimistic: true, message: { role: "user", text: "hi" } }, createdAtMs: 1 },
    })).toBe(true)
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
