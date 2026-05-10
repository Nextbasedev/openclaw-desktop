import { describe, expect, it } from "vitest"
import { dedupeChatMessages, mergeAssistantTextIfSameTurn } from "../chatMessageDedupe"

describe("mergeAssistantTextIfSameTurn", () => {
  it("merges only identical or prefix/superset assistant text", () => {
    expect(mergeAssistantTextIfSameTurn("hello", "hello world")).toBe("hello world")
    expect(mergeAssistantTextIfSameTurn("hello world", "hello")).toBe("hello world")
    expect(mergeAssistantTextIfSameTurn("first response", "second response")).toBeNull()
  })
})

describe("dedupeChatMessages", () => {
  it("merges duplicate assistant messages from cache and stream", () => {
    const messages = dedupeChatMessages([
      { messageId: "cached", role: "assistant", text: "Final answer", createdAt: "2026-05-08T10:00:00.000Z" },
      { messageId: "stream", role: "assistant", text: "Final answer", createdAt: "2026-05-08T10:00:01.000Z" },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: "assistant", text: "Final answer" })
  })

  it("keeps the longer assistant text when stream catches up to cached partial", () => {
    const messages = dedupeChatMessages([
      { messageId: "cached", role: "assistant", text: "Final" },
      { messageId: "stream", role: "assistant", text: "Final answer with more detail" },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Final answer with more detail")
  })

  it("does not dedupe different assistant answers", () => {
    const messages = dedupeChatMessages([
      { messageId: "a", role: "assistant", text: "First answer" },
      { messageId: "b", role: "assistant", text: "Second answer" },
    ])

    expect(messages).toHaveLength(2)
  })
})
