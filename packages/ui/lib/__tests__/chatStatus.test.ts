import { describe, expect, it } from "vitest"
import { inferRestoredChatStatus } from "../chatStatus"

describe("inferRestoredChatStatus", () => {
  it("restores completed cached conversations as done, not thinking", () => {
    expect(
      inferRestoredChatStatus(
        [{ messageId: "a1", role: "assistant", text: "Completed answer" }],
        null,
      ),
    ).toBe("done")
  })

  it("keeps active cached status while a run is really active", () => {
    expect(
      inferRestoredChatStatus(
        [{ messageId: "u1", role: "user", text: "Do work" }],
        "thinking",
      ),
    ).toBe("thinking")
  })

  it("keeps terminal cached error status", () => {
    expect(
      inferRestoredChatStatus(
        [{ messageId: "u1", role: "user", text: "Do work" }],
        "error",
      ),
    ).toBe("error")
  })
})
