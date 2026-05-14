import { describe, expect, it } from "vitest"
import { dedupeChatMessages } from "../chatMessageDedupe"

describe("dedupeChatMessages", () => {
  it("merges duplicate assistant messages from cache and stream", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "cached",
        role: "assistant",
        text: "Final answer",
        createdAt: "2026-05-08T10:00:00.000Z",
      },
      {
        messageId: "stream",
        role: "assistant",
        text: "Final answer",
        createdAt: "2026-05-08T10:00:01.000Z",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      text: "Final answer",
    })
  })

  it("keeps the longer assistant text when stream catches up to cached partial", () => {
    const messages = dedupeChatMessages([
      { messageId: "cached", role: "assistant", text: "Final" },
      {
        messageId: "stream",
        role: "assistant",
        text: "Final answer with more detail",
      },
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

  it("does not collapse numbered assistant messages with prefix-like text", () => {
    const messages = dedupeChatMessages([
      { messageId: "a8", role: "assistant", text: "Stress Chat 13 assistant 8" },
      { messageId: "a80", role: "assistant", text: "Stress Chat 13 assistant 80" },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["a8", "a80"])
  })

  it("preserves attachments when duplicate message ids are merged", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "same",
        role: "user",
        text: "check this",
        attachments: [{ name: "screenshot.png", mimeType: "image/png" }],
      },
      {
        messageId: "same",
        role: "user",
        text: "check this",
        createdAt: "2026-05-08T10:00:03.000Z",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].attachments).toEqual([
      { name: "screenshot.png", mimeType: "image/png" },
    ])
  })

  it("reconciles optimistic user messages with nearby canonical history", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "canonical",
        role: "user",
        text: "hello",
        createdAt: "2026-05-08T10:00:03.000Z",
      },
      {
        messageId: "optimistic",
        role: "user",
        text: "hello",
        createdAt: "2026-05-08T10:00:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].messageId).toBe("canonical")
  })

  it("reconciles optimistic image user messages with canonical attachment placeholder history", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "optimistic",
        role: "user",
        text: "can you check this",
        createdAt: "2026-05-08T10:00:00.000Z",
        isOptimistic: true,
        attachments: [{ name: "image.png", mimeType: "image/png" }],
      },
      {
        messageId: "canonical",
        role: "user",
        text: "can you check this\n\n[Attached image: image.png]",
        createdAt: "2026-05-08T10:00:03.000Z",
      },
    ])

    expect(messages).toHaveLength(1)
  })

  it("replaces optimistic user with later canonical echo when ids differ", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "optimistic",
        role: "user",
        text: "not fully awak",
        createdAt: "2026-05-08T10:00:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
      {
        messageId: "gateway-user",
        role: "user",
        text: "not fully awak",
        createdAt: "2026-05-08T10:00:01.000Z",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      messageId: "gateway-user",
      role: "user",
      text: "not fully awak",
      isOptimistic: false,
      sendStatus: undefined,
      sendError: null,
    })
  })

  it("does not reconcile optimistic user messages far from canonical history", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "canonical",
        role: "user",
        text: "hello",
        createdAt: "2026-05-08T10:10:00.000Z",
      },
      {
        messageId: "optimistic",
        role: "user",
        text: "hello",
        createdAt: "2026-05-08T10:00:00.000Z",
        isOptimistic: true,
        sendStatus: "failed",
      },
    ])

    expect(messages).toHaveLength(2)
  })

  it("merges user duplicates that share the same backend sequence", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "optimistic-confirmed",
        role: "user",
        text: "hii",
        createdAt: "2026-05-11T17:49:00.000Z",
        gatewayIndex: 3,
      },
      {
        messageId: "gateway-canonical",
        role: "user",
        text: "Sender (untrusted metadata):\n```json\n{\n  \"id\": \"gateway-client\"\n}\n```\n\n[Mon 2026-05-11 17:49 UTC] hii",
        createdAt: "2026-05-11T17:49:06.000Z",
        gatewayIndex: 3,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].messageId).toBe("optimistic-confirmed")
  })
})

it("collapses repeated contiguous history blocks", () => {
  const block = [
    { messageId: "u1", role: "user" as const, text: "first" },
    { messageId: "a1", role: "assistant" as const, text: "answer" },
    { messageId: "u2", role: "user" as const, text: "last" },
  ]

  const messages = dedupeChatMessages([
    ...block,
    ...block.map((message) => ({
      ...message,
      messageId: `${message.messageId}-duplicate`,
    })),
  ])

  expect(messages.map((message) => message.text)).toEqual([
    "first",
    "answer",
    "last",
  ])
})

it("collapses repeated user-only history blocks after assistant dedupe", () => {
  const messages = dedupeChatMessages([
    { messageId: "u1", role: "user", text: "first" },
    { messageId: "a1", role: "assistant", text: "same assistant" },
    { messageId: "u2", role: "user", text: "second" },
    { messageId: "a2", role: "assistant", text: "same assistant" },
    { messageId: "u1-duplicate", role: "user", text: "first" },
    { messageId: "a1-duplicate", role: "assistant", text: "same assistant" },
    { messageId: "u2-duplicate", role: "user", text: "second" },
    { messageId: "a2-duplicate", role: "assistant", text: "same assistant" },
  ])

  expect(
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.text)
  ).toEqual(["first", "second"])
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

it("keeps refetched history in backend gateway sequence order", () => {
  const messages = dedupeChatMessages([
    { messageId: "live-user-2", role: "user", text: "second", gatewayIndex: 3 },
    { messageId: "history-user-1", role: "user", text: "first", gatewayIndex: 1 },
    { messageId: "history-assistant-1", role: "assistant", text: "first answer", gatewayIndex: 2 },
    { messageId: "history-assistant-2", role: "assistant", text: "second answer", gatewayIndex: 4 },
  ])

  expect(messages.map((message) => message.messageId)).toEqual([
    "history-user-1",
    "history-assistant-1",
    "live-user-2",
    "history-assistant-2",
  ])
})
