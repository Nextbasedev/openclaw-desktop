import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import { buildStableVercelTimeline } from "@/components/ChatView/vercel-ui/timeline"

const msg = (overrides: Partial<ChatMessage>): ChatMessage => ({
  messageId: "m1",
  role: "assistant",
  text: "hello",
  createdAt: "2026-05-27T06:00:00.000Z",
  ...overrides,
})

describe("buildStableVercelTimeline", () => {
  it("keeps a user row stable when optimistic id becomes canonical", () => {
    const before = buildStableVercelTimeline([
      msg({ messageId: "client:1", role: "user", text: "please help" }),
    ])
    const after = buildStableVercelTimeline([
      msg({ messageId: "gateway:9", role: "user", text: "please help", gatewayIndex: 42 }),
    ])

    expect(after[0].uiId).toBe(before[0].uiId)
    expect(after[0].messageId).toBe("gateway:9")
  })

  it("keeps assistant response stable when live backend id becomes final id", () => {
    const before = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "question" }),
      msg({ messageId: "live:assistant", role: "assistant", text: "part", animateText: true }),
    ])
    const after = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "question" }),
      msg({ messageId: "final:assistant", role: "assistant", text: "part done", animateText: true }),
    ])

    expect(after[0].uiId).toBe(before[0].uiId)
    expect(after[1].uiId).toBe(before[1].uiId)
    expect(after[1].messageId).toBe("final:assistant")
  })

  it("does not change existing visible row ids when older history is prepended", () => {
    const current = buildStableVercelTimeline([
      msg({ messageId: "u2", role: "user", text: "newer question" }),
      msg({ messageId: "a2", role: "assistant", text: "newer answer" }),
    ])
    const withHistory = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "older question" }),
      msg({ messageId: "a1", role: "assistant", text: "older answer" }),
      msg({ messageId: "u2-final", role: "user", text: "newer question" }),
      msg({ messageId: "a2-final", role: "assistant", text: "newer answer plus" }),
    ])

    expect(withHistory.slice(-2).map((message) => message.uiId)).toEqual(
      current.map((message) => message.uiId)
    )
  })

  it("keeps duplicate user rows stable when older duplicate text is prepended", () => {
    const current = buildStableVercelTimeline([
      msg({ messageId: "u20", role: "user", text: "same question", gatewayIndex: 20 }),
      msg({ messageId: "a21", role: "assistant", text: "newer answer", gatewayIndex: 21 }),
    ])
    const withHistory = buildStableVercelTimeline([
      msg({ messageId: "u10", role: "user", text: "same question", gatewayIndex: 10 }),
      msg({ messageId: "a11", role: "assistant", text: "older answer", gatewayIndex: 11 }),
      msg({ messageId: "u20-final", role: "user", text: "same question", gatewayIndex: 20 }),
      msg({ messageId: "a21-final", role: "assistant", text: "newer answer plus", gatewayIndex: 21 }),
    ])

    expect(withHistory.slice(-2).map((message) => message.uiId)).toEqual(
      current.map((message) => message.uiId)
    )
    expect(new Set(withHistory.map((message) => message.uiId)).size).toBe(withHistory.length)
  })

  it("coalesces assistant tool and text chunks into one assistant row", () => {
    const timeline = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "run command" }),
      msg({
        messageId: "tool-shell",
        role: "assistant",
        text: "",
        toolCalls: [{ id: "t1", tool: "exec", status: "running" }],
      }),
      msg({ messageId: "a1", role: "assistant", text: "done" }),
    ])

    expect(timeline).toHaveLength(2)
    expect(timeline[1].toolCalls?.[0]?.id).toBe("t1")
    expect(timeline[1].text).toBe("done")
  })
})
