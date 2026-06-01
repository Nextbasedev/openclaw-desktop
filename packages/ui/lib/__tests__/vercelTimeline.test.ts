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
  it("uses message identity for user rows instead of content identity", () => {
    const before = buildStableVercelTimeline([
      msg({ messageId: "client:1", role: "user", text: "please help" }),
    ])
    const after = buildStableVercelTimeline([
      msg({ messageId: "gateway:9", role: "user", text: "please help", gatewayIndex: 42 }),
    ])

    expect(before[0].uiId).toBe("message:client:1")
    expect(after[0].uiId).toBe("message:gateway:9")
    expect(after[0].messageId).toBe("gateway:9")
  })

  it("keeps assistant response stable when live backend id becomes final id", () => {
    const before = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "question" }),
      msg({ messageId: "live:assistant", role: "assistant", text: "part", animateText: true, runId: "run-1" }),
    ])
    const after = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "question" }),
      msg({ messageId: "final:assistant", role: "assistant", text: "part done", animateText: true, runId: "run-1" }),
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

    expect(withHistory.slice(-2).map((message) => message.uiId)).toEqual([
      "message:u2-final",
      "message:a2-final:assistant:turn",
    ])
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

    expect(withHistory.slice(-2).map((message) => message.uiId)).toEqual([
      "message:u20-final",
      "message:a21-final:assistant:turn",
    ])
    expect(new Set(withHistory.map((message) => message.uiId)).size).toBe(withHistory.length)
  })

  it("does not remount earlier duplicate text rows when a newer duplicate is appended", () => {
    const before = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "same" }),
      msg({ messageId: "a1", role: "assistant", text: "answer 1" }),
    ])
    const after = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "same" }),
      msg({ messageId: "a1", role: "assistant", text: "answer 1" }),
      msg({ messageId: "u2", role: "user", text: "same" }),
      msg({ messageId: "a2", role: "assistant", text: "answer 2" }),
    ])

    expect(after.slice(0, 2).map((message) => message.uiId)).toEqual(before.map((message) => message.uiId))
  })

  it("keeps unique stable rows across 45 repeated heavy tool-call turns", () => {
    const messages: ChatMessage[] = []
    for (let turn = 1; turn <= 45; turn += 1) {
      messages.push(msg({
        messageId: `user-${turn}`,
        role: "user",
        text: "repeat heavy prompt",
        gatewayIndex: turn * 2 - 1,
      }))
      messages.push(msg({
        messageId: `assistant-${turn}`,
        role: "assistant",
        text: `answer ${turn}`,
        gatewayIndex: turn * 2,
        toolCalls: Array.from({ length: 3 }, (_, index) => ({
          id: `tool-${turn}-${index}`,
          tool: "exec",
          status: "success" as const,
          input: { command: `echo ${turn}-${index}` },
          resultText: `ok ${turn}-${index}`,
        })),
      }))
    }

    const before = buildStableVercelTimeline(messages)
    const afterReload = buildStableVercelTimeline(messages.map((message) => ({ ...message })))

    expect(before).toHaveLength(90)
    expect(new Set(before.map((message) => message.uiId)).size).toBe(90)
    expect(afterReload.map((message) => message.uiId)).toEqual(before.map((message) => message.uiId))
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

  it("does not merge separate text-bearing assistant answers when a user separator is missing", () => {
    const timeline = buildStableVercelTimeline([
      msg({ messageId: "u1", role: "user", text: "hii", gatewayIndex: 1 }),
      msg({ messageId: "u2", role: "user", text: "do some tool call", gatewayIndex: 6 }),
      msg({ messageId: "a1", role: "assistant", text: "Hi Dixit — what should we work on?", gatewayIndex: 5 }),
      msg({
        messageId: "a2",
        role: "assistant",
        text: "Done — I called session_status.",
        gatewayIndex: 9,
        toolCalls: [{ id: "status", tool: "session_status", status: "success" }],
      }),
    ])

    expect(timeline).toHaveLength(4)
    expect(timeline.map((message) => message.text)).toEqual([
      "hii",
      "do some tool call",
      "Hi Dixit — what should we work on?",
      "Done — I called session_status.",
    ])
    expect(timeline[2].toolCalls).toBeUndefined()
    expect(timeline[3].toolCalls?.[0]?.tool).toBe("session_status")
  })
})
