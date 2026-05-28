import { describe, expect, it } from "vitest"
import { initialStreamingTextState } from "@/components/ChatView/useStreamingText"

describe("streaming text state", () => {
  it("renders immediate streaming text at the current full chunk with no synthetic reveal", () => {
    expect(initialStreamingTextState("streamed chunk", true, "immediate")).toEqual({
      displayText: "streamed chunk",
      isRevealing: false,
    })
  })

  it("keeps buffered mode available for deliberate character reveal animations", () => {
    expect(initialStreamingTextState("streamed chunk", true, "buffered")).toEqual({
      displayText: "",
      isRevealing: true,
    })
  })
})
