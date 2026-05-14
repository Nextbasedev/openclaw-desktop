import { describe, expect, it } from "vitest"
import { isAssistantErrorMessage } from "../../components/ChatView/utils"
import type { ChatMessage } from "../../components/ChatView/types"

function assistant(
  text: string,
  stopReason?: ChatMessage["stopReason"]
): ChatMessage {
  return {
    messageId: "m1",
    role: "assistant",
    text,
    stopReason,
  }
}

describe("isAssistantErrorMessage", () => {
  it("detects provider errors from stopReason", () => {
    expect(isAssistantErrorMessage(assistant("Error: rate limit", "error"))).toBe(
      true
    )
  })

  it("detects gateway and websocket error text", () => {
    expect(
      isAssistantErrorMessage(
        assistant('Error: 402 {"code":"deactivated_workspace"}')
      )
    ).toBe(true)
    expect(
      isAssistantErrorMessage(assistant("WebSocket error: disconnected"))
    ).toBe(true)
  })

  it("does not mark normal assistant replies as errors", () => {
    expect(isAssistantErrorMessage(assistant("Here is how to fix an error."))).toBe(
      false
    )
  })
})
