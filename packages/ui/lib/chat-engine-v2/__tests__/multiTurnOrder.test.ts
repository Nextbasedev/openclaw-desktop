import { describe, expect, test } from "vitest"
import { orderChatMessages } from "../../../components/ChatView/orderChatMessages"
import { dedupeChatMessages } from "../../chatMessageDedupe"
import type { ChatMessage } from "../../../components/ChatView/types"

// Reproduces the screenshot: an OLD finalized answer (to the 09:52 "hyy") is
// rendering BELOW a much newer user "hyy" (10:26). Desired: strict conversation
// order — each answer sits directly under the user turn it belongs to.
describe("multi-turn ordering — new send must not push an old answer below it", () => {
  test("older answer stays under its own user turn even while a newer turn streams", () => {
    // Mid-session state the app actually holds: streamed answers are LIVE rows
    // keyed by runId with NO gateway seq (they only acquire a seq on reload,
    // which is why reload fixes ordering). The freshly-sent optimistic user was
    // spliced in at the live tail, landing at a LOWER array index than the
    // previous turn's still-unsequenced answer.
    const messages: ChatMessage[] = [
      { messageId: "a0", role: "assistant", text: "Hey Krish.", gatewayIndex: 1, createdAt: "2026-07-01T09:32:00Z" },
      { messageId: "u1", role: "user", text: "hyy", gatewayIndex: 2, createdAt: "2026-07-01T09:52:00Z" },
      // Newer turn's optimistic user, appended before the old live answer row.
      { messageId: "u2", role: "user", text: "hyy", isOptimistic: true, sendStatus: "sending", createdAt: "2026-07-01T10:26:00Z" },
      // Previous turn's answer — still a live/unsequenced row.
      { messageId: "live:run:idem1:assistant", role: "assistant", text: "Hey Krish — I'm here.", createdAt: "2026-07-01T09:52:03Z" },
      { messageId: "live:run:idem2:assistant", role: "assistant", text: "Hey Krish — here.", createdAt: "2026-07-01T10:26:02Z" },
    ]

    const rendered = orderChatMessages(dedupeChatMessages(messages)).map((m) => m.text)
    expect(rendered).toEqual([
      "Hey Krish.",
      "hyy",
      "Hey Krish — I'm here.",
      "hyy",
      "Hey Krish — here.",
    ])
  })
})

// Reproduces the "Hey Krish." screenshot: a live reply whose model createdAt
// PREDATES the user's client send time was sorting ABOVE the user turn, which
// also stranded the status on "Writing…". Once the reply's run id is stamped
// onto the user turn, the same-run guard pins the reply under the user turn
// regardless of the inverted timestamps.
describe("live reply must stay under its user turn even when model time predates send time", () => {
  test("same-run reply with earlier createdAt still sorts below the user", () => {
    const messages: ChatMessage[] = [
      // user sent at 02:15:03, streaming reply stamped at model time 02:15:01.
      { messageId: "u-hello", role: "user", text: "hello", runId: "run-x", createdAt: "2026-07-01T02:15:03Z" },
      { messageId: "live:run-x:assistant", role: "assistant", text: "Hey Krish.", runId: "run-x", createdAt: "2026-07-01T02:15:01Z" },
    ]
    const rendered = orderChatMessages(dedupeChatMessages(messages)).map((m) => m.text)
    expect(rendered).toEqual(["hello", "Hey Krish."])
  })

  test("without the run-id link, pure time order would invert them (guards the fix)", () => {
    const messages: ChatMessage[] = [
      { messageId: "u-hello", role: "user", text: "hello", createdAt: "2026-07-01T02:15:03Z" },
      { messageId: "a-hey", role: "assistant", text: "Hey Krish.", runId: "run-x", createdAt: "2026-07-01T02:15:01Z" },
    ]
    // Documents the pre-fix behaviour the reducer now prevents by tagging the
    // user turn with the run id (see applyPatches.tagTriggeringUserWithRunId).
    const rendered = orderChatMessages(dedupeChatMessages(messages)).map((m) => m.text)
    expect(rendered).toEqual(["Hey Krish.", "hello"])
  })
})
