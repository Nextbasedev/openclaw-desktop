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
