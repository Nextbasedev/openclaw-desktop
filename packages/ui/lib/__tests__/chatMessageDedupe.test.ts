import { describe, expect, it } from "vitest"
import { dedupeChatMessages } from "../chatMessageDedupe"

describe("dedupeChatMessages", () => {
  it("merges optimistic file upload row with Gateway attached-file user echo", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "client-file-1",
        role: "user",
        text: "read this file",
        createdAt: "2026-06-16T04:50:59.757Z",
        isOptimistic: true,
        sendStatus: "sending",
        attachments: [{ name: "hyy.md", mimeType: "text/markdown", content: "# Private file body" }],
      },
      {
        messageId: "gateway-user-echo",
        role: "user",
        text: 'read this file\n\n<attached-file name="hyy.md" mime="text/markdown">\n# Private file body\n</attached-file>',
        createdAt: "2026-06-16T04:50:59.767Z",
        gatewayIndex: 3,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      messageId: "gateway-user-echo",
      role: "user",
      text: "read this file",
      attachments: [{ name: "hyy.md", mimeType: "text/markdown", content: "# Private file body" }],
      isOptimistic: false,
    })
  })

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

  it("keeps the longer assistant text when stream catches up to the same cached partial", () => {
    const messages = dedupeChatMessages([
      { messageId: "assistant-1", role: "assistant", text: "Final", gatewayIndex: 2 },
      {
        messageId: "assistant-1",
        role: "assistant",
        text: "Final answer with more detail",
        gatewayIndex: 2,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Final answer with more detail")
  })

  it("collapses exact repeated text inside a single assistant websocket row", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "live-duplicate",
        role: "assistant",
        text: "Hello Krish 👋Hello Krish 👋",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Hello Krish 👋")
  })

  it("collapses exact repeated assistant text before merging live and final rows", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "live",
        role: "assistant",
        text: "Hello Krish 👋Hello Krish 👋",
        gatewayIndex: 2,
      },
      {
        messageId: "final",
        role: "assistant",
        text: "Hello Krish 👋",
        gatewayIndex: 2,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Hello Krish 👋")
  })

  it("keeps distinct assistant fork replies even when the later answer extends the same prefix", () => {
    const messages = dedupeChatMessages([
      { messageId: "fork-a1", role: "assistant", text: "I fixed the fork replay issue." },
      { messageId: "fork-a2", role: "assistant", text: "I fixed the fork replay issue and pushed the update." },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["fork-a1", "fork-a2"])
  })

  it("does not dedupe different assistant answers", () => {
    const messages = dedupeChatMessages([
      { messageId: "a", role: "assistant", text: "First answer" },
      { messageId: "b", role: "assistant", text: "Second answer" },
    ])

    expect(messages).toHaveLength(2)
  })

  it("does not reorder consecutive user and assistant bursts without stronger turn identity", () => {
    const messages = dedupeChatMessages([
      { messageId: "u1", role: "user", text: "hii", gatewayIndex: 1 },
      { messageId: "a1", role: "assistant", text: "Hi, I'm here.", gatewayIndex: 2 },
      { messageId: "u2", role: "user", text: "how are you", gatewayIndex: 3 },
      { messageId: "u3", role: "user", text: "hii", gatewayIndex: 4 },
      { messageId: "a2", role: "assistant", text: "I'm good — how are you?", gatewayIndex: 5 },
      { messageId: "a3", role: "assistant", text: "What are we working on?", gatewayIndex: 6 },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "u1",
      "a1",
      "u2",
      "u3",
      "a2",
      "a3",
    ])
  })

  it("dedupes canonical user before optimistic echo with bounded clock skew", () => {
    const messages = dedupeChatMessages([
      { messageId: "gateway-user", role: "user", text: "hii", gatewayIndex: 10, createdAt: "2026-05-29T20:08:20.000Z" },
      { messageId: "client-user", role: "user", text: "hii", gatewayIndex: 10, isOptimistic: true, createdAt: "2026-05-29T20:08:35.000Z" },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].messageId).toBe("gateway-user")
  })

  it("keeps assistant replies with overlapping tools separate when gateway indexes differ", () => {
    const messages = dedupeChatMessages([
      { messageId: "a1", role: "assistant", text: "First reply", gatewayIndex: 10, toolCalls: [{ id: "tool-1", tool: "exec", status: "success" }] },
      { messageId: "a2", role: "assistant", text: "Second reply", gatewayIndex: 12, toolCalls: [{ id: "tool-1", tool: "exec", status: "success" }] },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["a1", "a2"])
    expect(messages.map((message) => message.text)).toEqual(["First reply", "Second reply"])
  })

  it("collapses replayed tool-only assistant rows with the same tool id even when gateway indexes drift", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "tool-live",
        role: "assistant",
        text: "",
        gatewayIndex: 289,
        toolCalls: [{ id: "tool-1", tool: "edit", status: "running" }],
      },
      {
        messageId: "tool-backfill",
        role: "assistant",
        text: "",
        gatewayIndex: 290,
        toolCalls: [{ id: "tool-1", tool: "edit", status: "success", duration: "0.5s", resultText: "ok" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", status: "success", duration: "0.5s", resultText: "ok" }),
    ])
  })

  it("does not let later stale running replay overwrite terminal tool-only state across drifted gateway indexes", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "tool-terminal",
        role: "assistant",
        text: "",
        gatewayIndex: 289,
        toolCalls: [{ id: "tool-1", tool: "edit", status: "success", duration: "0.5s", resultText: "ok" }],
      },
      {
        messageId: "tool-stale",
        role: "assistant",
        text: "",
        gatewayIndex: 290,
        toolCalls: [{ id: "tool-1", tool: "edit", status: "running" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "success", duration: "0.5s", resultText: "ok" })
  })

  it("collapses stale live assistant echo after canonical final answer even when persisted seq drifted", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "canonical-final",
        role: "assistant",
        text: "WEBWRIGHT_RAPID_B_7_1780075022",
        gatewayIndex: 2,
        model: "gpt-5.5",
      },
      {
        messageId: "confirmed-user",
        role: "user",
        text: "WEBWRIGHT_RAPID_B_7_1780075022 second rapid chat while first may run. Reply marker only.",
        gatewayIndex: 1,
      },
      {
        messageId: "live:run:desktop-v2:agent:main:desktop:mpr6pk0y-ipzg9g:run-id:assistant",
        role: "assistant",
        text: "WEBWRIGHT_RAPID_B_7_1780075022",
        gatewayIndex: 5,
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "confirmed-user",
      "canonical-final",
    ])
  })

  it("collapses live uuid assistant echo after canonical final answer", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "confirmed-user",
        role: "user",
        text: "hi",
        gatewayIndex: 70,
      },
      {
        messageId: "canonical-final",
        role: "assistant",
        text: "hello",
        gatewayIndex: 71,
      },
      {
        messageId: "live:a17f2ddd-e496-4517-aef8-f8904e2f73a7:assistant",
        role: "assistant",
        text: "hello",
        gatewayIndex: 77,
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "confirmed-user",
      "canonical-final",
    ])
  })

  it("merges optimistic user echo when gateway timestamp is slightly earlier than browser send", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "optimistic-1",
        role: "user",
        text: "check this",
        createdAt: "2026-05-29T16:25:30.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
      {
        messageId: "gateway-1",
        role: "user",
        text: "check this",
        createdAt: "2026-05-29T16:25:10.000Z",
        gatewayIndex: 4,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      messageId: "gateway-1",
      role: "user",
      text: "check this",
      gatewayIndex: 4,
      isOptimistic: false,
      sendStatus: undefined,
    })
  })

  it("keeps newly sent timestamped messages below restored untimed history", () => {
    const messages = dedupeChatMessages([
      { messageId: "u-old", role: "user", text: "previous question" },
      { messageId: "a-old", role: "assistant", text: "previous answer" },
      {
        messageId: "u-new",
        role: "user",
        text: "new question",
        createdAt: "2026-05-14T17:50:22.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["u-old", "a-old", "u-new"])
  })

  it("keeps repeated assistant errors for separate user turns", () => {
    const messages = dedupeChatMessages([
      { messageId: "u1", role: "user", text: "hello", gatewayIndex: 1 },
      {
        messageId: "a1",
        role: "assistant",
        text: 'Error: 402 {"code":"deactivated_workspace"}',
        stopReason: "error",
        gatewayIndex: 2,
      },
      { messageId: "u2", role: "user", text: "heyy", gatewayIndex: 3 },
      {
        messageId: "a2",
        role: "assistant",
        text: 'Error: 402 {"code":"deactivated_workspace"}',
        stopReason: "error",
        gatewayIndex: 4,
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ])
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

  it("keeps a new optimistic repeat visible when an older canonical user has the same text", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "gateway-user-old",
        role: "user",
        text: "same msg",
        createdAt: "2026-05-26T09:00:00.000Z",
        gatewayIndex: 10,
      },
      {
        messageId: "optimistic-new-repeat",
        role: "user",
        text: "same msg",
        createdAt: "2026-05-26T09:00:10.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "gateway-user-old",
      "optimistic-new-repeat",
    ])
  })

  it("keeps two distinct optimistic repeats visible", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "optimistic-repeat-1",
        role: "user",
        text: "repeat now",
        createdAt: "2026-05-26T09:00:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
      {
        messageId: "optimistic-repeat-2",
        role: "user",
        text: "repeat now",
        createdAt: "2026-05-26T09:00:01.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual([
      "optimistic-repeat-1",
      "optimistic-repeat-2",
    ])
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

  it("merges same-run user duplicates even when backend sequences differ", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "client-user",
        role: "user",
        text: "heyyy",
        createdAt: "2026-05-30T05:55:12.000Z",
        gatewayIndex: 90,
        runId: "run-1",
      },
      {
        messageId: "gateway-user",
        role: "user",
        text: "heyyy",
        createdAt: "2026-05-30T05:55:18.000Z",
        gatewayIndex: 88,
        runId: "run-1",
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].messageId).toBe("client-user")
  })

  it("keeps repeated canonical user messages separate when backend sequences differ", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "user-hii-1",
        role: "user",
        text: "hii",
        createdAt: "2026-05-26T03:40:00.000Z",
        gatewayIndex: 10,
      },
      {
        messageId: "user-hii-2",
        role: "user",
        text: "hii",
        createdAt: "2026-05-26T03:40:15.000Z",
        gatewayIndex: 12,
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["user-hii-1", "user-hii-2"])
  })

  it("keeps repeated canonical user messages separate when real ids differ even without sequence", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "gateway-user-1",
        role: "user",
        text: "same again",
        createdAt: "2026-05-26T03:40:00.000Z",
      },
      {
        messageId: "gateway-user-2",
        role: "user",
        text: "same again",
        createdAt: "2026-05-26T03:40:10.000Z",
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["gateway-user-1", "gateway-user-2"])
  })

  it("orders late replayed user patches by backend sequence instead of timestamp", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "assistant-seq-2",
        role: "assistant",
        text: "answer",
        createdAt: "2026-05-26T03:40:00.000Z",
        gatewayIndex: 2,
      },
      {
        messageId: "late-user-seq-1",
        role: "user",
        text: "question",
        createdAt: "2026-05-26T03:41:00.000Z",
        gatewayIndex: 1,
      },
    ])

    expect(messages.map((message) => message.messageId)).toEqual(["late-user-seq-1", "assistant-seq-2"])
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

it("merges optimistic image attachment previews with canonical media attachment URLs", () => {
  const messages = dedupeChatMessages([
    {
      messageId: "optimistic-user",
      role: "user",
      text: "canyou describe image\n\n[Attached image: ChatGPT Image May 13, 2026, 10_35_12 PM.png]",
      createdAt: "2026-06-04T10:00:00.000Z",
      isOptimistic: true,
      attachments: [
        {
          name: "ChatGPT Image May 13, 2026, 10_35_12 PM.png",
          mimeType: "image/png",
          content: "iVBORw0KGgo=",
        },
      ],
    },
    {
      messageId: "history-user",
      role: "user",
      text: "canyou describe image\n[media attached: media://inbound/ChatGPT_Image_May_13_2026_10_35_12_PM---e613cc28-cbae-40d4-a96d-f9b3e8d11a2b.png]",
      createdAt: "2026-06-04T10:00:02.000Z",
      attachments: [
        {
          name: "ChatGPT_Image_May_13_2026_10_35_12_PM---e613cc28-cbae-40d4-a96d-f9b3e8d11a2b.png",
          mimeType: "image/png",
          url: "https://middleware.example.com/api/chat/media/inbound/ChatGPT_Image_May_13_2026_10_35_12_PM---e613cc28-cbae-40d4-a96d-f9b3e8d11a2b.png?token=secret",
        },
      ],
    },
  ])

  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({
    messageId: "history-user",
    text: "canyou describe image\n[media attached: media://inbound/ChatGPT_Image_May_13_2026_10_35_12_PM---e613cc28-cbae-40d4-a96d-f9b3e8d11a2b.png]",
    isOptimistic: false,
  })
  expect(messages[0].attachments).toEqual([
    {
      name: "ChatGPT Image May 13, 2026, 10_35_12 PM.png",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
      url: "https://middleware.example.com/api/chat/media/inbound/ChatGPT_Image_May_13_2026_10_35_12_PM---e613cc28-cbae-40d4-a96d-f9b3e8d11a2b.png?token=secret",
    },
  ])
})

it("collapses optimistic image user echo when canonical gateway index differs", () => {
  const messages = dedupeChatMessages([
    {
      messageId: "openclaw:2",
      role: "user",
      text: "what is in this image\n[media attached: media://inbound/image---canonical.png]",
      gatewayIndex: 2,
      createdAt: "2026-06-04T10:36:00.000Z",
      attachments: [
        {
          name: "image---canonical.png",
          mimeType: "image/png",
          url: "https://middleware.example.com/api/chat/media/inbound/image---canonical.png?token=secret",
        },
      ],
    },
    {
      messageId: "3f2eaa2f-optimistic",
      role: "user",
      text: "what is in this image\n\n[Attached image: image.png]",
      gatewayIndex: 1,
      createdAt: "2026-06-04T10:36:05.000Z",
      isOptimistic: true,
      sendStatus: "sending",
      attachments: [
        {
          name: "image.png",
          mimeType: "image/png",
          content: "iVBORw0KGgo=",
        },
      ],
    },
  ])

  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({
    messageId: "openclaw:2",
    role: "user",
    gatewayIndex: 2,
    sendStatus: undefined,
  })
  expect(messages[0].isOptimistic).not.toBe(true)
  expect(messages[0].attachments).toEqual([
    {
      name: "image.png",
      mimeType: "image/png",
      content: "iVBORw0KGgo=",
      url: "https://middleware.example.com/api/chat/media/inbound/image---canonical.png?token=secret",
    },
  ])
})

it("merges same-run assistant duplicates even when backend sequences differ", () => {
  const messages = dedupeChatMessages([
      {
        messageId: "assistant-live",
        role: "assistant",
        text: "Hi Dixit 👋 Good morning.",
        createdAt: "2026-05-30T05:55:18.000Z",
        gatewayIndex: 91,
        runId: "run-1",
      },
      {
        messageId: "assistant-backfill",
        role: "assistant",
        text: "Hi Dixit 👋 Good morning.",
        createdAt: "2026-05-30T05:55:20.000Z",
        gatewayIndex: 89,
        runId: "run-1",
      },
    ])

  expect(messages).toHaveLength(1)
  expect(messages[0].text).toBe("Hi Dixit 👋 Good morning.")
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

it("does not let stale running tool history overwrite a completed tool", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "tools-live",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "tool-1", tool: "session_status", status: "success", duration: "0.5s" }],
      },
      {
        messageId: "tools-history",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "tool-1", tool: "session_status", status: "running" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "success", duration: "0.5s" })
})

it("does not let a same-message backfill overwrite completed tool status", () => {
    const messages = dedupeChatMessages([
      {
        messageId: "assistant-tools",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "tool-1", tool: "session_status", status: "success", duration: "0.5s" }],
      },
      {
        messageId: "assistant-tools",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "tool-1", tool: "session_status", status: "running" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "success", duration: "0.5s" })
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
