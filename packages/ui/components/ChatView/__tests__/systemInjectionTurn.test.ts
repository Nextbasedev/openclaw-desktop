import { describe, expect, test } from "vitest"
import { parseChatHistory, isSystemInjectedUserMessage } from "../../../lib/chatHistoryParser"
import { orderChatMessages } from "../orderChatMessages"
import fixture from "./fixtures/systemInjectionTurn.json"

// Real desktop session rows (agent:main:desktop:mqyrf16b…, seq 217-220):
//   217 user "check again"
//   218 assistant (full reply, stopReason stop)
//   219 user  "System (untrusted): [..] Exec failed ..."  <- gateway injection
//   220 assistant "Re-checking the host/process state now after cleanup."
// Before the fix the injection (219) acted as a user turn boundary and split the
// answer into two assistant cards. After the fix it is transparent and 218+220
// merge into ONE assistant response.
describe("system-injection turn (no fragmentation, no fake user bubble)", () => {
  const raw = fixture as any[]

  test("the System (untrusted) injection is classified as system, not user", () => {
    expect(isSystemInjectedUserMessage(raw[2])).toBe(true)
    expect(isSystemInjectedUserMessage(raw[0])).toBe(false) // real "check again"
  })

  test("the /new session-startup prompt is classified as system, not user", () => {
    const startup = {
      role: "user",
      text: "A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. If BOOTSTRAP.md exists in the provided Project Context, read it and follow its instructions first.",
    }
    expect(isSystemInjectedUserMessage(startup as any)).toBe(true)
    // A real user turn that merely mentions the words must NOT be hidden.
    expect(isSystemInjectedUserMessage({ role: "user", text: "can you start a new session?" } as any)).toBe(false)
  })

  test("the /new session-startup prompt never renders (no phantom user bubble)", () => {
    const rows = [
      { role: "user", text: "A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user." },
      { role: "assistant", text: "Hey Krish — what can I do for you?" },
    ]
    const parsed = parseChatHistory(rows as any[])
    const roles = parsed.messages.map((m) => m.role)
    expect(roles).toEqual(["assistant"]) // startup prompt dropped, greeting kept
    for (const m of parsed.messages) {
      expect(m.text ?? "").not.toContain("A new session was started")
      expect(m.text ?? "").not.toContain("Session Startup sequence")
    }
  })

  test("one user turn renders one user bubble + one merged assistant card", () => {
    const parsed = parseChatHistory(raw)
    const ordered = orderChatMessages(parsed.messages)
    const roles = ordered.map((m) => m.role)

    // exactly: [user, assistant] — no second assistant card, no system bubble
    expect(roles).toEqual(["user", "assistant"])

    const user = ordered[0]
    const assistant = ordered[1]
    expect(user.text).toBe("check again")
    // merged assistant card contains BOTH chunks
    expect(assistant.text).toContain("Re-checking the host/process state now after cleanup.")
    // the exec-failure system text must NOT leak into any rendered message
    for (const m of ordered) {
      expect(m.text ?? "").not.toContain("Exec failed")
      expect(m.text ?? "").not.toContain("System (untrusted)")
    }
  })
})
