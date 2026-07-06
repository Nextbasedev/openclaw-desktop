import { describe, expect, it, vi } from "vitest"
import {
  parseToastOpenPayload,
  parseToastReplyPayload,
  sendToastReplyMessage,
} from "./desktopToastActions"

describe("desktop toast actions", () => {
  it("parses valid open and reply payloads", () => {
    expect(parseToastOpenPayload({ sessionKey: "agent:main:abc" })).toEqual({
      sessionKey: "agent:main:abc",
    })
    expect(parseToastReplyPayload({ sessionKey: "agent:main:abc", text: "  continue  " })).toEqual({
      sessionKey: "agent:main:abc",
      text: "continue",
    })
  })

  it("rejects missing session or empty reply text", () => {
    expect(parseToastOpenPayload({ sessionKey: "" })).toBeNull()
    expect(parseToastReplyPayload({ sessionKey: "agent:main:abc", text: "   " })).toBeNull()
    expect(parseToastReplyPayload({ text: "hello" })).toBeNull()
  })

  it("sends toast replies to the payload session", async () => {
    const sendChat = vi.fn(async () => ({ ok: true }))

    await expect(sendToastReplyMessage(
      { sessionKey: "agent:main:target", text: "next message" },
      { sendChat, createMessageId: () => "toast-msg-1" },
    )).resolves.toEqual({ sessionKey: "agent:main:target", text: "next message" })

    expect(sendChat).toHaveBeenCalledWith({
      sessionKey: "agent:main:target",
      text: "next message",
      idempotencyKey: "desktop-v2:agent:main:target:toast-msg-1",
      clientMessageId: "toast-msg-1",
    })
  })
})
