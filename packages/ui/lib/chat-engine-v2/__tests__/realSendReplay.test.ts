import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"
import { orderChatMessages } from "../../../components/ChatView/orderChatMessages"
import { dedupeChatMessages } from "../../chatMessageDedupe"
import type { ChatMessage } from "../../../components/ChatView/types"
import realSendFrames from "./fixtures/realSendFrames.json"

// End-to-end crossing test: the frames in realSendFrames.json were produced by
// the REAL middleware (apps/middleware/tests/send-scenario-prev-assistant.test.ts
// captures context.patchBus.broadcast output). Here we replay those exact frames
// through the REAL frontend reducer + dedupe + ordering to prove the timeline
// renders correctly — the previous assistant answer never disappears and the
// new user/answer never invert.
describe("replay real middleware frames through the frontend reducer", () => {
  test("previous assistant survives and order stays chronological", () => {
    // Prior history as ChatView would hold it, plus the optimistic user row
    // ChatView appends synchronously on send (before any frame arrives).
    let state = {
      cursor: 0,
      messages: [
        { messageId: "a-greeting", role: "assistant", text: "Hey Krish — I'm here.", gatewayIndex: 1 },
        { messageId: "u-tool", role: "user", text: "do some tool call and give me one paragraph content", gatewayIndex: 2 },
        { messageId: "a-healthy", role: "assistant", text: "Current session is healthy and running as Empire.", gatewayIndex: 3, runId: "run-prev" },
        { messageId: "opt-hyy", role: "user", text: "hyy", createdAt: new Date().toISOString(), isOptimistic: true, sendStatus: "sending" },
      ] as ChatMessage[],
    }

    const renders: string[][] = []
    for (const frame of realSendFrames as Array<{ cursor: number; type: string; sessionKey?: string; payload?: unknown }>) {
      state = applyChatPatch(state, { type: "patch", patch: frame } as never)
      renders.push(orderChatMessages(dedupeChatMessages(state.messages)).map((m) => m.text))
    }

    // After EVERY frame, the previous assistant answer must remain visible.
    for (const snapshot of renders) {
      expect(snapshot).toContain("Current session is healthy and running as Empire.")
    }

    // Final render is the full, correctly ordered timeline.
    const final = renders[renders.length - 1]
    expect(final).toEqual([
      "Hey Krish — I'm here.",
      "do some tool call and give me one paragraph content",
      "Current session is healthy and running as Empire.",
      "hyy",
      "Hey Krish.",
    ])

    // The just-sent user message must never sort above its own answer, and the
    // user "hyy" must never appear before the previous assistant answer.
    for (const snapshot of renders) {
      const hyy = snapshot.indexOf("hyy")
      const answer = snapshot.indexOf("Hey Krish.")
      if (hyy !== -1 && answer !== -1) expect(hyy).toBeLessThan(answer)
      const healthy = snapshot.indexOf("Current session is healthy and running as Empire.")
      if (hyy !== -1 && healthy !== -1) expect(healthy).toBeLessThan(hyy)
    }
  })
})
