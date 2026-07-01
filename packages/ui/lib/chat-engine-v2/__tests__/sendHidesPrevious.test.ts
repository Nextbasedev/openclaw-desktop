import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"
import { orderChatMessages } from "../../../components/ChatView/orderChatMessages"
import { dedupeChatMessages } from "../../chatMessageDedupe"
import type { ChatMessage } from "../../../components/ChatView/types"

type State = { cursor: number; messages: ChatMessage[] }

function rendered(state: State) {
  return orderChatMessages(dedupeChatMessages(state.messages)).map((m) => ({
    role: m.role,
    text: m.text,
    tools: (m.toolCalls ?? []).map((t) => t.id),
  }))
}

// Reproduces the reported bug: an existing turn has an assistant answer that
// carried a tool call. The user sends a new message; while the new run streams
// (BEFORE the new user's confirmation seq is established), the previous
// assistant answer disappears and/or ordering breaks.
describe("send should not hide the previous assistant response", () => {
  const history: ChatMessage[] = [
    { messageId: "a-greeting", role: "assistant", text: "Hey Krish — I'm here.", createdAt: "2026-06-30T18:20:00.000Z", gatewayIndex: 1 },
    { messageId: "u-tool", role: "user", text: "do some tool call and give me one paragraph content", createdAt: "2026-06-30T18:22:00.000Z", gatewayIndex: 2 },
    {
      messageId: "a-healthy",
      role: "assistant",
      text: "Current session is healthy and running as Empire.",
      createdAt: "2026-06-30T18:22:30.000Z",
      gatewayIndex: 3,
      runId: "run-prev",
      toolCalls: [{ id: "tool-prev", tool: "status", status: "success" }],
    },
  ]

  test("previous assistant survives a new send whose confirm seq lags the stream", () => {
    // 1. ChatView appends optimistic user for the new send.
    let state: State = {
      cursor: 10,
      messages: [
        ...history,
        {
          messageId: "opt-hyy",
          role: "user",
          text: "hyy",
          createdAt: "2026-07-01T09:32:00.000Z",
          isOptimistic: true,
          sendStatus: "sending",
          runId: "run-new",
        },
      ],
    }

    // 2. New assistant text streams in FIRST, tagged with the new run, before
    //    the user's confirmation carries a canonical seq.
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 11,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.assistant.final",
          runId: "run-new",
          runStatus: "streaming",
          activeRun: { status: "streaming" },
          message: { role: "assistant", text: "Hey Krish.", id: "a-new", __openclaw: { seq: 5, runId: "run-new" } },
        },
        createdAtMs: 1,
      },
    } as never)

    const afterStream = rendered(state)
    const healthyStillThere = afterStream.some((m) => m.text.includes("Current session is healthy"))
    const roles = afterStream.map((m) => m.role)

    // 3. User confirmation for "hyy" arrives.
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 12,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.confirmed",
          optimisticId: "opt-hyy",
          messageId: "u-hyy",
          messageSeq: 4,
          runId: "run-new",
          message: { role: "user", text: "hyy", id: "u-hyy", __openclaw: { seq: 4, runId: "run-new" } },
        },
        createdAtMs: 2,
      },
    } as never)

    const final = rendered(state)
    const finalTexts = final.map((m) => m.text)

    // The previous assistant answer must never disappear.
    expect(healthyStillThere).toBe(true)
    expect(finalTexts).toContain("Current session is healthy and running as Empire.")
    // Final order must be chronological: greeting, tool-user, healthy, hyy, new answer.
    expect(finalTexts).toEqual([
      "Hey Krish — I'm here.",
      "do some tool call and give me one paragraph content",
      "Current session is healthy and running as Empire.",
      "hyy",
      "Hey Krish.",
    ])
    void roles
  })
})
