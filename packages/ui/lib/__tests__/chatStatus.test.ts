import { describe, expect, it } from "vitest"
import { inferRestoredChatStatus, statusFromBackendSession } from "../chatStatus"

describe("inferRestoredChatStatus", () => {
  it("restores completed cached conversations as done, not thinking", () => {
    expect(
      inferRestoredChatStatus(
        [{ messageId: "a1", role: "assistant", text: "Completed answer" }],
        null,
      ),
    ).toBe("done")
  })

  it("does not restore stale cached thinking without backend confirmation", () => {
    expect(
      inferRestoredChatStatus(
        [{ messageId: "a1", role: "assistant", text: "Completed answer" }],
        "thinking",
      ),
    ).toBe("done")
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

describe("statusFromBackendSession", () => {
  it("uses backend running state as the source of truth", () => {
    expect(statusFromBackendSession("running", [])).toBe("thinking")
    expect(statusFromBackendSession("queued", [])).toBe("thinking")
  })

  it("uses backend idle state to clear stale thinking", () => {
    expect(
      statusFromBackendSession("idle", [
        { messageId: "a1", role: "assistant", text: "Done" },
      ]),
    ).toBe("done")
  })

  it("uses backend idle state as idle when no assistant answer exists", () => {
    expect(
      statusFromBackendSession("idle", [
        { messageId: "u1", role: "user", text: "Do work" },
      ]),
    ).toBe("idle")
  })
})
