import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import { stripTransientChatMessagesState } from "../chatTransientState"
import { ChatTimelineStore } from "../chat-engine-v2/timelineStore"

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: "assistant-1",
    role: "assistant",
    text: "A completed assistant response long enough that replay would be visible.",
    gatewayIndex: 1,
    ...overrides,
  } as ChatMessage
}

describe("transient chat message state", () => {
  it("strips cached animateText from a terminal remount so restored text renders fully", () => {
    const [restored] = stripTransientChatMessagesState([
      assistant({ animateText: true, stopReason: "end_turn" }),
    ])

    expect(restored.animateText).toBeUndefined()
    expect(restored.text).toBe("A completed assistant response long enough that replay would be visible.")
  })

  it("does not depend on completion cleanup having run before hydration", () => {
    const [restored] = stripTransientChatMessagesState([
      assistant({ messageId: "background-final", animateText: true, runId: "run-1" }),
    ])

    expect(restored.animateText).toBeUndefined()
    expect(restored.runId).toBe("run-1")
  })

  it("strips warm-cache messages before timeline snapshots can replay reveal", () => {
    const store = new ChatTimelineStore("warm-cache-remount")
    store.applyWarmCache([assistant({ animateText: true })], 10)
    store.flushSync()

    expect(store.getSnapshot().messages[0].animateText).toBeUndefined()
  })

  it("strips background-completed bootstrap messages opened later", () => {
    const store = new ChatTimelineStore("bootstrap-remount")
    store.applyBootstrap([assistant({ animateText: true, stopReason: "stop" })], 20)
    store.flushSync()

    expect(store.getSnapshot().messages[0].animateText).toBeUndefined()
  })

  it("preserves animateText for live patch deltas that arrive after mount", () => {
    const store = new ChatTimelineStore("live-stream")
    store.applyBootstrap([assistant({ messageId: "previous", text: "Previous", animateText: true })], 5)
    store.flushSync()

    store.applyPatchMessage(assistant({ messageId: "live", text: "Streaming now", animateText: true, runId: "run-live" }), 6)
    store.flushSync()

    const live = store.getSnapshot().messages.find((message) => message.messageId === "live")
    expect(live?.animateText).toBe(true)
  })
})
