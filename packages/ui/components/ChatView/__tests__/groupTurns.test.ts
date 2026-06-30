import { describe, expect, it } from "vitest"
import { groupTurns, isRealUserMessage, isTransparentSystemMessage } from "../groupTurns"
import type { ChatMessage } from "../types"

function msg(partial: Partial<ChatMessage> & { messageId: string; role: ChatMessage["role"] }): ChatMessage {
  return { text: "", ...partial }
}

describe("isRealUserMessage / isTransparentSystemMessage", () => {
  it("treats a normal user message as a real turn boundary", () => {
    const m = msg({ messageId: "u1", role: "user", text: "hello" })
    expect(isRealUserMessage(m)).toBe(true)
    expect(isTransparentSystemMessage(m)).toBe(false)
  })

  it("treats a System (untrusted): [date] injection as transparent, not a boundary", () => {
    const m = msg({
      messageId: "s1",
      role: "user",
      text: "System (untrusted): [2026-06-29 11:49:05 UTC] Exec failed (mild-fal, signal SIGTERM)",
    })
    expect(isRealUserMessage(m)).toBe(false)
    expect(isTransparentSystemMessage(m)).toBe(true)
  })

  it("does not mistake a normal message that merely mentions 'system' for an injection", () => {
    const m = msg({ messageId: "u2", role: "user", text: "the system is down, help" })
    expect(isTransparentSystemMessage(m)).toBe(false)
    expect(isRealUserMessage(m)).toBe(true)
  })
})

describe("groupTurns", () => {
  it("single text turn → one turn with one assistant, indices carried", () => {
    const turns = groupTurns([
      msg({ messageId: "u1", role: "user", text: "q" }),
      msg({ messageId: "a1", role: "assistant", text: "answer" }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].user?.message.messageId).toBe("u1")
    expect(turns[0].user?.index).toBe(0)
    expect(turns[0].assistants.map((a) => a.message.messageId)).toEqual(["a1"])
    expect(turns[0].assistants.map((a) => a.index)).toEqual([1])
    expect(turns[0].keyMessageId).toBe("u1")
  })

  it("text → tool → text within one turn stays one turn, order preserved", () => {
    const turns = groupTurns([
      msg({ messageId: "u1", role: "user", text: "q" }),
      msg({ messageId: "a1", role: "assistant", text: "I'll scan..." }),
      msg({ messageId: "a2", role: "assistant", text: "", toolCalls: [{ id: "t1", name: "exec", status: "running" } as never] }),
      msg({ messageId: "a3", role: "assistant", text: "Summary..." }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].assistants.map((a) => a.message.messageId)).toEqual(["a1", "a2", "a3"])
  })

  it("system injection between assistant fragments does NOT split the turn and is dropped", () => {
    const turns = groupTurns([
      msg({ messageId: "u1", role: "user", text: "check again" }),
      msg({ messageId: "a1", role: "assistant", text: "full reply" }),
      msg({ messageId: "s1", role: "user", text: "System (untrusted): [2026-06-29 11:49:05 UTC] Exec failed" }),
      msg({ messageId: "a2", role: "assistant", text: "Re-checking the host..." }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].user?.message.messageId).toBe("u1")
    expect(turns[0].assistants.map((a) => a.message.messageId)).toEqual(["a1", "a2"])
    // index of a2 is 3 in the source array even though s1 (index 2) was dropped
    expect(turns[0].assistants.map((a) => a.index)).toEqual([1, 3])
  })

  it("two real consecutive user sends → two turns (not merged)", () => {
    const turns = groupTurns([
      msg({ messageId: "u1", role: "user", text: "check again" }),
      msg({ messageId: "a1", role: "assistant", text: "ok" }),
      msg({ messageId: "u2", role: "user", text: "check again" }),
      msg({ messageId: "a2", role: "assistant", text: "ok again" }),
    ])
    expect(turns).toHaveLength(2)
    expect(turns[0].assistants.map((a) => a.message.messageId)).toEqual(["a1"])
    expect(turns[1].assistants.map((a) => a.message.messageId)).toEqual(["a2"])
  })

  it("leading assistant before any user → userless turn", () => {
    const turns = groupTurns([
      msg({ messageId: "a0", role: "assistant", text: "welcome" }),
      msg({ messageId: "u1", role: "user", text: "hi" }),
      msg({ messageId: "a1", role: "assistant", text: "hello" }),
    ])
    expect(turns).toHaveLength(2)
    expect(turns[0].user).toBeNull()
    expect(turns[0].assistants.map((a) => a.message.messageId)).toEqual(["a0"])
    expect(turns[0].keyMessageId).toBe("a0")
    expect(turns[1].user?.message.messageId).toBe("u1")
  })

  it("empty input → no turns", () => {
    expect(groupTurns([])).toEqual([])
  })

  it("user turn with no assistant yet (just sent) → one turn, empty assistants", () => {
    const turns = groupTurns([msg({ messageId: "u1", role: "user", text: "q" })])
    expect(turns).toHaveLength(1)
    expect(turns[0].assistants).toEqual([])
  })
})
