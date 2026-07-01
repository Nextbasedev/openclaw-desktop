import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"
import { orderChatMessages } from "../../../components/ChatView/orderChatMessages"
import type { ChatMessage } from "../../../components/ChatView/types"

// Repro: optimistic user send, assistant streams in (with seq) BEFORE the user
// confirmation patch arrives, then user confirmation arrives WITHOUT a seq.
// Expected (correct): [user, assistant]. Bug: [assistant, user].
describe("message order inversion (user after assistant)", () => {
  test("user stays before assistant when assistant patch lands first and confirm has no seq", () => {
    // 1. optimistic user already in state (as ChatView appends it)
    let state: { cursor: number; messages: ChatMessage[] } = {
      cursor: 0,
      messages: [
        {
          messageId: "opt-1",
          role: "user",
          text: "hi there",
          createdAt: "2026-06-29T12:00:00.000Z",
          isOptimistic: true,
        },
      ],
    }

    // 2. assistant streams in first, carries a gateway seq
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          runStatus: "streaming",
          activeRun: { status: "streaming" },
          message: { role: "assistant", text: "answer", id: "a1", __openclaw: { seq: 2 } },
        },
        createdAtMs: 1,
      },
    } as any)

    // 3. user confirmation arrives WITHOUT a seq (no __openclaw.seq / messageSeq)
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.confirmed",
          optimisticId: "opt-1",
          messageId: "u1",
          message: { role: "user", text: "hi there", id: "u1" },
        },
        createdAtMs: 2,
      },
    } as any)

    const ordered = orderChatMessages(state.messages)
    const roles = ordered.map((m) => m.role)
    expect(roles).toEqual(["user", "assistant"])
  })
})
