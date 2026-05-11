import { describe, expect, it } from "vitest"
import { inferRestoredChatStatus, statusAfterSendAck, statusFromBackendSession } from "../chatStatus"

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

describe("statusAfterSendAck", () => {
  it("keeps thinking after send ack when no assistant has arrived yet", () => {
    expect(statusAfterSendAck([{ messageId: "u1", role: "user", text: "Do work" }], "thinking")).toBeNull()
  })

  it("allows terminal completed status after assistant exists", () => {
    expect(statusAfterSendAck([{ messageId: "a1", role: "assistant", text: "Done" }], "thinking")).toBe("done")
  })
})

describe("statusFromBackendSession", () => {
  it("keeps backend running when no assistant answer exists", () => {
    expect(statusFromBackendSession("running", [])).toBe("thinking")
    expect(statusFromBackendSession("queued", [])).toBe("thinking")
  })

  it("does not trust stale backend running once an assistant answered after the latest user", () => {
    expect(
      statusFromBackendSession("running", [
        { messageId: "u1", role: "user", text: "who is supreme" },
        { messageId: "a1", role: "assistant", text: "You, Dixit 😄" },
      ]),
    ).toBe("done")
  })

  it("does not mark done when the latest user has no assistant answer yet", () => {
    expect(
      statusFromBackendSession("running", [
        { messageId: "u1", role: "user", text: "first" },
        { messageId: "a1", role: "assistant", text: "old answer" },
        { messageId: "u2", role: "user", text: "new question" },
      ]),
    ).toBe("thinking")
  })

  it("keeps running when the only post-user assistant block still has a running tool", () => {
    expect(
      statusFromBackendSession("running", [
        { messageId: "u1", role: "user", text: "run tool" },
        {
          messageId: "a1",
          role: "assistant",
          text: "",
          toolCalls: [{ id: "t1", tool: "exec", status: "running" }],
        },
      ]),
    ).toBe("thinking")
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
