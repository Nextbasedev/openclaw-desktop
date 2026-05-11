import { describe, expect, it } from "vitest"
import { dedupeChatMessages } from "../chatMessageDedupe"

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

  it("dedupes optimistic user message against history copy with attachment marker", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "history-user",
        role: "user",
        text: "some time when i am leave current session and back\n\n[Attached image: image.png]",
        createdAt: "2026-05-11T18:32:00.000Z",
      },
      {
        messageId: "optimistic-user",
        role: "user",
        text: "some time when i am leave current session and back",
        createdAt: "2026-05-11T18:32:02.000Z",
        isOptimistic: true,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].messageId).toBe("history-user")
  })

  it("merges duplicate assistant partial text without repeating the first word", () => {
    const messages = dedupeChatMessages([
      { messageId: "partial", role: "assistant", text: "NO_REPLY\n\nMerged" },
      { messageId: "final", role: "assistant", text: "Merged `fix/new-bugs` into `main` and pushed." },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Merged `fix/new-bugs` into `main` and pushed.")
  })

  it("merges duplicate assistant tool sections by tool id", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "tools-a",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "read-1", tool: "read", status: "success" }],
      },
      {
        messageId: "tools-b",
        role: "assistant",
        text: "Done",
        toolCalls: [{ id: "read-1", tool: "read", status: "success", duration: "0.5s" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Done")
    expect(messages[0].toolCalls).toHaveLength(1)
    expect(messages[0].toolCalls?.[0].duration).toBe("0.5s")
  })
})
