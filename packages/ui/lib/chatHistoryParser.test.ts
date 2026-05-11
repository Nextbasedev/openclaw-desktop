import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  cleanUserMessageText,
  isTransientSlashCommandHistory,
  parseChatHistory,
  stripGatewayPrefixes,
} from "./chatHistoryParser"

function clean(text: string): string {
  return stripGatewayPrefixes(
    text.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim(),
  )
}

describe("stripGatewayPrefixes", () => {
  const gatewayCases: Array<[string, string, string]> = [
    [
      "system line with seconds",
      "System: [2026-04-30 10:21:06 UTC] Model switched to codex/gpt-5.5.",
      "",
    ],
    [
      "system line without seconds",
      "System: [2026-04-30 10:21 UTC] Model switched to codex/gpt-5.5.",
      "",
    ],
    [
      "untrusted system line",
      "System (untrusted): [2026-04-30 07:29:08 UTC] Exec completed (code 0)",
      "",
    ],
    [
      "multiple system lines before user text",
      "System: [2026-04-30 10:21:06 UTC] Model switched\nSystem: [2026-04-30 10:21:07 UTC] Ready\nWhat is the weather?",
      "What is the weather?",
    ],
    [
      "weekday timestamp prefix",
      "[Thu 2026-04-30 10:21:06 UTC] create a cron job",
      "create a cron job",
    ],
    [
      "weekday timestamp prefix without seconds",
      "[Mon 2026-04-28 08:00 UTC] deploy the service",
      "deploy the service",
    ],
    [
      "bare timestamp prefix",
      "[2026-04-30 10:21 UTC] hello world",
      "hello world",
    ],
    [
      "sender metadata preamble with utc timestamp",
      'Sender (untrusted metadata):\n```json\n{\n  "label": "OpenClaw Desktop Middleware (gateway-client)",\n  "id": "gateway-client",\n  "name": "OpenClaw Desktop Middleware",\n  "username": "OpenClaw Desktop Middleware"\n}\n```\n\n[Fri 2026-05-08 10:31 UTC] Hello',
      "Hello",
    ],
    [
      "sender metadata preamble with gmt offset timestamp",
      'Sender (untrusted metadata):\n```json\n{\n  "label": "openclaw-tui",\n  "id": "openclaw-tui"\n}\n```\n\n[Thu 2026-05-07 15:58 GMT+5:30] hwy',
      "hwy",
    ],
    [
      "cron header with exact reply",
      "[cron:1ac04ab4-f813-4057-b8c3-b562e38d0c59 hey-jarvis-10s] Reply with exactly: Hey jarvis",
      "Hey jarvis",
    ],
    [
      "cron header without exact reply",
      "[cron:abc123 my-job] Do some task",
      "Do some task",
    ],
    [
      "cron message with current time and tool instruction",
      "[cron:abc daily] Reply with exactly: Hey jarvis\nCurrent time: Thursday, April 30th, 2026 - 10:26 AM (UTC) / 2026-04-30 10:26 UTC\n\nUse the message tool if you need to notify the user directly with an explicit target. If you do not send directly, your final plain-text reply will be delivered automatically.",
      "Hey jarvis",
    ],
    [
      "current time line before user text",
      "Current time: Friday, May 1st, 2026 - 08:00 AM (UTC) / 2026-05-01 08:00 UTC\n\nPlease check the logs",
      "Please check the logs",
    ],
    [
      "message tool instruction after user text",
      "Hey jarvis\nUse the message tool if you need to notify the user directly with an explicit target. If you do not send directly, your final plain-text reply will be delivered automatically.",
      "Hey jarvis",
    ],
    [
      "async result instruction",
      "An async command you ran earlier has completed. The result is shown in the system messages above.\nHandle the result internally.\nDo not relay it to the user unless explicitly requested.",
      "",
    ],
    [
      "system plus async result",
      "System (untrusted): [2026-04-30 07:29:08 UTC] Exec completed\n\nAn async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.",
      "",
    ],
    [
      "bootstrap warning",
      "Hello world\n\n[Bootstrap truncation warning] The history was truncated.",
      "Hello world",
    ],
    [
      "combined system timestamp and bootstrap",
      "System: [2026-04-30 10:00:00 UTC] Context loaded\n[2026-04-30 10:00 UTC] What is 2+2?\n\n[Bootstrap truncation warning] cut",
      "What is 2+2?",
    ],
    [
      "media attachment instructions",
      "[media attached: /root/.openclaw/media/inbound/image_2026-04-30_14-20-00---dcb1de83-56c4-45cb-9e5e-2e4390e18213.png (image/png) | /root/.openclaw/media/inbound/image_2026-04-30_14-20-00---dcb1de83-56c4-45cb-9e5e-2e4390e18213.png]\nTo send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Absolute and ~ paths only work when they stay inside your allowed file-read boundary; host file:// URLs are blocked. Keep caption in the text body.\n\n\nyou have ngix setup>\nwhich is forwarding the traffics?\nyou have to route to the default port\nlet me know if you have everything properly setup?\nif yes then I am sure it's cloudflared ssl issue\n\ncheck this",
      "you have ngix setup>\nwhich is forwarding the traffics?\nyou have to route to the default port\nlet me know if you have everything properly setup?\nif yes then I am sure it's cloudflared ssl issue\n\ncheck this",
    ],
    [
      "media attachment header without helper instruction",
      "[media attached: /root/.openclaw/media/inbound/image.png (image/png) | /root/.openclaw/media/inbound/image.png]\n\nlook at this image",
      "look at this image",
    ],
    [
      "multiple media attachment headers",
      "[media attached: /root/.openclaw/media/inbound/a.png (image/png) | /root/.openclaw/media/inbound/a.png]\n[media attached: /root/.openclaw/media/inbound/b.png (image/png) | /root/.openclaw/media/inbound/b.png]\n\ncompare these",
      "compare these",
    ],
  ]

  for (const [label, input, expected] of gatewayCases) {
    it(`removes ${label}`, () => {
      assert.equal(clean(input), expected)
    })
  }

  const normalMessages = [
    "Hello, how are you?",
    "Here is some code:\n```js\nconsole.log('hello')\n```",
    "[important] Please review this PR",
    "The System was rebooted yesterday",
    "The meeting is at 3pm UTC tomorrow",
    "I set up a cron job to run hourly",
    "First line\nSecond line\nThird line",
    "Please fix bug [BUG-123] in the auth module",
    "2026 is going to be a great year",
    "What is the current time in Tokyo?",
    "An async function is failing in production",
    "Use the message tool to send a notification",
    "# Heading\n\n- item 1\n- item 2\n\nSome paragraph text.",
  ]

  for (const message of normalMessages) {
    it(`keeps normal text unchanged: ${message.split("\n")[0]}`, () => {
      assert.equal(clean(message), message)
    })
  }
})

describe("cleanUserMessageText", () => {
  it("combines bootstrap and gateway cleanup for all history renderers", () => {
    assert.equal(
      cleanUserMessageText(
        "[media attached: /root/.openclaw/media/inbound/image.png (image/png) | /root/.openclaw/media/inbound/image.png]\n\ncheck this\n\n[Bootstrap truncation warning] truncated",
      ),
      "check this",
    )
  })

  it("removes sender metadata wrappers saved in gateway history", () => {
    assert.equal(
      cleanUserMessageText(
        'Sender (untrusted metadata):\n```json\n{\n  "label": "OpenClaw Desktop Middleware (gateway-client)",\n  "id": "gateway-client",\n  "name": "OpenClaw Desktop Middleware",\n  "username": "OpenClaw Desktop Middleware"\n}\n```\n\n[Fri 2026-05-08 10:31 UTC] Hello',
      ),
      "Hello",
    )
  })

  it("keeps plain user text that only mentions sender metadata words", () => {
    const text =
      'Sender (untrusted metadata): please show this text literally without parsing'
    assert.equal(cleanUserMessageText(text), text)
  })

  it("keeps malformed sender metadata blocks unchanged", () => {
    const text =
      'Sender (untrusted metadata):\n```json\nnot-json\n```\n\nHello'
    assert.equal(cleanUserMessageText(text), text)
  })
})

describe("isTransientSlashCommandHistory", () => {
  it("treats isolated gateway-injected command output as transient", () => {
    assert.equal(
      isTransientSlashCommandHistory([
        {
          role: "assistant",
          provider: "openclaw",
          model: "gateway-injected",
          content: [{ type: "text", text: "status output" }],
        },
      ]),
      true,
    )
  })

  it("treats gateway-injected command output without slash user bubble as transient", () => {
    assert.equal(
      isTransientSlashCommandHistory([
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          provider: "openclaw",
          model: "gateway-injected",
          content: [{ type: "text", text: "status output" }],
        },
      ]),
      true,
    )
  })

  it("allows stable slash command user bubble followed by command output", () => {
    assert.equal(
      isTransientSlashCommandHistory([
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "text", text: "/status" }] },
        {
          role: "assistant",
          provider: "openclaw",
          model: "gateway-injected",
          content: [{ type: "text", text: "status output" }],
        },
      ]),
      false,
    )
  })
})

describe("parseChatHistory", () => {
  it("renders assistant provider errors even when the assistant content is empty", () => {
    const parsed = parseChatHistory([
      { role: "user", content: [{ type: "text", text: "hii" }] },
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "You have hit your ChatGPT usage limit (free plan). Try again in ~5534 min.",
        provider: "openai-codex",
        model: "gpt-5.5",
      },
    ])

    assert.equal(parsed.messages.length, 2)
    assert.equal(parsed.messages[1]?.role, "assistant")
    assert.equal(
      parsed.messages[1]?.text,
      "Error: You have hit your ChatGPT usage limit (free plan). Try again in ~5534 min.",
    )
    assert.equal(parsed.messages[1]?.stopReason, "error")
  })

  it("keeps gateway-injected agent failure replies visible", () => {
    const parsed = parseChatHistory([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        provider: "openclaw",
        model: "gateway-injected",
        content: [
          {
            type: "text",
            text: "Agent failed before reply: Malformed agent session key.",
          },
        ],
      },
    ])

    assert.equal(parsed.messages.length, 2)
    assert.equal(
      parsed.messages[1]?.text,
      "Agent failed before reply: Malformed agent session key.",
    )
  })

  it("does not create visible messages for gateway-only user entries", () => {
    const parsed = parseChatHistory([
      {
        role: "user",
        text: "System: [2026-04-30 10:21:06 UTC] Model switched to codex/gpt-5.5.",
      },
      {
        role: "user",
        text: "An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.",
      },
      {
        role: "user",
        text: "[media attached: /root/.openclaw/media/inbound/image.png (image/png) | /root/.openclaw/media/inbound/image.png]\nTo send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg. Keep caption in the text body.",
      },
    ])

    assert.deepEqual(parsed.messages, [])
  })

  it("keeps the actual user request after mixed gateway prefixes", () => {
    const parsed = parseChatHistory([
      {
        role: "user",
        text: 'System: [2026-04-30 10:21:06 UTC] Model switched\n\n[Thu 2026-04-30 10:21 UTC] create a cron job for 10 seconds and say "Hey jarvis"',
      },
    ])

    assert.equal(parsed.messages.length, 1)
    assert.equal(
      parsed.messages[0]?.text,
      'create a cron job for 10 seconds and say "Hey jarvis"',
    )
  })

  it("keeps the typed text below a media attachment preamble", () => {
    const parsed = parseChatHistory([
      {
        role: "user",
        text: "[media attached: /root/.openclaw/media/inbound/image_2026-04-30_14-20-00---dcb1de83-56c4-45cb-9e5e-2e4390e18213.png (image/png) | /root/.openclaw/media/inbound/image_2026-04-30_14-20-00---dcb1de83-56c4-45cb-9e5e-2e4390e18213.png]\nTo send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Absolute and ~ paths only work when they stay inside your allowed file-read boundary; host file:// URLs are blocked. Keep caption in the text body.\n\n\nyou have ngix setup>\nwhich is forwarding the traffics?",
      },
    ])

    assert.equal(parsed.messages.length, 1)
    assert.equal(
      parsed.messages[0]?.text,
      "you have ngix setup>\nwhich is forwarding the traffics?",
    )
  })

  it("restores persisted tool durations from tool result tookMs", () => {
    const parsed = parseChatHistory([
      {
        id: "a1",
        role: "assistant",
        timestamp: 1000,
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "web_fetch",
            arguments: { url: "https://example.com" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "web_fetch",
        timestamp: 5000,
        details: { tookMs: 1234 },
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      },
    ])

    assert.equal(parsed.messages[0]?.toolCalls?.[0]?.duration, "1.2s")
  })

  it("keeps tool calls running until their result is present", () => {
    const parsed = parseChatHistory([
      {
        id: "a1",
        role: "assistant",
        timestamp: 1000,
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "exec",
            arguments: { command: "sleep 1" },
          },
        ],
      },
    ])

    assert.equal(parsed.messages[0]?.toolCalls?.[0]?.status, "running")
    assert.equal(parsed.messages[0]?.toolCalls?.[0]?.resultText, undefined)
  })

  it("matches tool results by toolCallId when restoring output", () => {
    const parsed = parseChatHistory([
      {
        id: "a1",
        role: "assistant",
        timestamp: 1000,
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "first",
            arguments: {},
          },
          {
            type: "toolCall",
            id: "tc2",
            name: "second",
            arguments: {},
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc2",
        toolName: "second",
        timestamp: 2500,
        content: [{ type: "text", text: "second output" }],
      },
    ])

    const calls = parsed.messages[0]?.toolCalls ?? []
    assert.equal(calls.find((call) => call.id === "tc1")?.status, "running")
    assert.equal(calls.find((call) => call.id === "tc2")?.status, "success")
    assert.equal(calls.find((call) => call.id === "tc2")?.resultText, "second output")
  })

  it("falls back to assistant and tool result timestamps for history tool durations", () => {
    const parsed = parseChatHistory([
      {
        id: "a1",
        role: "assistant",
        timestamp: 1000,
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "exec",
            arguments: { command: "echo hi" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "exec",
        timestamp: 3650,
        content: [{ type: "text", text: "hi" }],
      },
    ])

    assert.equal(parsed.messages[0]?.toolCalls?.[0]?.duration, "2.6s")
  })

  it("restores reply previews from markdown quotes with blank quoted lines", () => {
    const assistantText =
      "First assistant line.\n\nSecond assistant paragraph with enough text to represent a stored reply preview."
    const userText = "Continue from that reply with a fresh question."
    const parsed = parseChatHistory([
      {
        id: "assistant-1",
        role: "assistant",
        text: assistantText,
      },
      {
        id: "user-1",
        role: "user",
        text: `> First assistant line.\n>\n> Second assistant paragraph with enough text to represent a stored reply preview.\n\n${userText}`,
      },
    ])

    assert.equal(parsed.messages.length, 2)
    assert.equal(parsed.messages[1]?.text, userText)
    assert.deepEqual(parsed.messages[1]?.replyTo, {
      messageId: "assistant-1",
      role: "assistant",
      text: assistantText,
    })
  })
})
