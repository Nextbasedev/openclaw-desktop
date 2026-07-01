import { describe, expect, test } from "vitest"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { orderChatMessages } from "../../components/ChatView/orderChatMessages"
import type { ChatMessage } from "../../components/ChatView/types"

function buildChat(n: number): ChatMessage[] {
  const out: ChatMessage[] = []
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? "user" : "assistant"
    out.push({
      messageId: `m-${i}`,
      role,
      text: role === "user" ? `question ${i}` : `Answer ${i}. ${"lorem ipsum dolor sit amet ".repeat(20)}`,
      gatewayIndex: i + 1,
      createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      toolCalls: role === "assistant" && i % 4 === 1
        ? [{ id: `t-${i}`, tool: "exec", status: "success", input: "ls -la", resultText: "x".repeat(200) } as never]
        : undefined,
    })
  }
  return out
}

// Guard against reintroducing an O(N^2) dedupe/order that re-runs on every
// streaming token and janks long chats. Before the fix this was ~1000 ms/delta
// at 600 messages; after it is ~10-15 ms. The 250 ms bound has a huge margin so
// it is not flaky on slow CI, but any quadratic reintroduction blows past it.
describe("streaming render cost stays roughly linear on long chats", () => {
  test("dedupe+order for a 600-message chat is well under budget per streaming delta", () => {
    const chat = buildChat(600)
    const DELTAS = 40
    const t0 = performance.now()
    for (let d = 0; d < DELTAS; d++) {
      const streaming = chat.map((m, i) =>
        i === chat.length - 1 ? { ...m, text: m.text + "x".repeat(d) } : m,
      )
      orderChatMessages(dedupeChatMessages(streaming))
    }
    const msPerDelta = (performance.now() - t0) / DELTAS
    // eslint-disable-next-line no-console
    console.log(`[perf] dedupe+order @600 msgs: ${msPerDelta.toFixed(2)} ms/delta`)
    expect(msPerDelta).toBeLessThan(250)
  })
})
