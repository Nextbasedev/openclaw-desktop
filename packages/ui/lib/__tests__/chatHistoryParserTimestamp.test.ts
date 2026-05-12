import { describe, expect, it } from "vitest"
import { parseChatHistory } from "../chatHistoryParser"

describe("parseChatHistory timestamps", () => {
  it("uses ISO string timestamps from middleware history", () => {
    const parsed = parseChatHistory([
      { role: "user", text: "hello", timestamp: "2026-05-12T06:00:00.000Z" },
      { role: "assistant", text: "hi", timestamp: "2026-05-12T06:00:07.000Z" },
    ])

    expect(parsed.messages.at(-1)?.createdAt).toBe("2026-05-12T06:00:07.000Z")
  })
})
