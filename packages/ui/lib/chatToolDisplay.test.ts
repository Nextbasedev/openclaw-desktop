import { describe, expect, it } from "vitest"
import { toolCallsForResponseStack } from "./chatToolDisplay"
import type { ChatMessage, InlineToolCall } from "../components/ChatView/types"

const tool = (id: string, status: InlineToolCall["status"] = "running"): InlineToolCall => ({
  id,
  tool: "web_fetch",
  status,
})

describe("toolCallsForResponseStack", () => {
  it("renders one current response stack on the latest assistant message", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "fetch things" },
      { messageId: "a-tool-1", role: "assistant", text: "", toolCalls: [tool("t1")] },
      { messageId: "a-tool-2", role: "assistant", text: "", toolCalls: [tool("t2")] },
    ]

    expect(toolCallsForResponseStack({ messages, index: 1, liveTools: [], isGenerating: true })).toEqual([])
    expect(toolCallsForResponseStack({ messages, index: 2, liveTools: [tool("t1", "success"), tool("t2")], isGenerating: true })).toMatchObject([
      { id: "t1", status: "success" },
      { id: "t2", status: "running" },
    ])
  })

  it("shows live tools on the user row until an assistant row exists", () => {
    const messages: ChatMessage[] = [{ messageId: "u1", role: "user", text: "fetch" }]

    expect(toolCallsForResponseStack({ messages, index: 0, liveTools: [tool("t1")], isGenerating: true })).toMatchObject([
      { id: "t1", status: "running" },
    ])
  })

  it("does not let running history overwrite successful live websocket result", () => {
    const messages: ChatMessage[] = [
      { messageId: "u1", role: "user", text: "fetch" },
      { messageId: "a-tool", role: "assistant", text: "", toolCalls: [tool("t1", "running")] },
    ]

    expect(toolCallsForResponseStack({ messages, index: 1, liveTools: [{ ...tool("t1", "success"), resultText: "ok" }], isGenerating: true })).toMatchObject([
      { id: "t1", status: "success", resultText: "ok" },
    ])
  })
})
