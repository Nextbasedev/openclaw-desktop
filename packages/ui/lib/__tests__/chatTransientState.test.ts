import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import { stripTransientChatMessagesState } from "../chatTransientState"

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

  it("strips animateText across a batch while preserving non-transient fields", () => {
    const restored = stripTransientChatMessagesState([
      assistant({ messageId: "a", animateText: true, stopReason: "stop" }),
      assistant({ messageId: "b", animateText: true, runId: "run-2" }),
    ])

    expect(restored.every((m) => m.animateText === undefined)).toBe(true)
    expect(restored[1].runId).toBe("run-2")
  })
})
