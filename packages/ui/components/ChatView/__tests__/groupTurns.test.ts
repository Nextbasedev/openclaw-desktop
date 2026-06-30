import { describe, expect, it } from "vitest"
import {
  buildTurnView,
  groupTurns,
  isRealUserMessage,
  isTransparentSystemMessage,
  type TurnViewInput,
} from "../groupTurns"
import type { ChatMessage } from "../types"

function msg(partial: Partial<ChatMessage> & { messageId: string; role: ChatMessage["role"] }): ChatMessage {
  return { text: "", ...partial }
}

/** Minimal inline tool call for tests. */
function tc(id: string, status: "running" | "success" | "error" = "success") {
  return { id, name: "exec", status } as never
}

/** Group `messages` and build the render-view for the LAST turn. */
function lastTurnView(messages: ChatMessage[], opts: Partial<TurnViewInput> = {}) {
  const turns = groupTurns(messages)
  const turn = turns[turns.length - 1]
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user")
  return buildTurnView(turn, {
    isGenerating: false,
    isLastTurn: true,
    latestRenderedUserIndex: lastUserIndex,
    duplicateToolOnlyRows: new Set(),
    suppressedToolCallMessages: new Set(),
    groupedToolCalls: new Map(),
    terminalToolState: new Map(),
    ...opts,
  })
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

describe("buildTurnView (render decisions)", () => {
  // This is the exact shape of Krish's screenshot bug: ONE question produces
  // preamble text → a tool → summary text as THREE assistant messages.
  const fragmented = () => [
    msg({ messageId: "u1", role: "user", text: "scan the repo" }),
    msg({ messageId: "a1", role: "assistant", text: "I'll scan the repo…" }),
    msg({ messageId: "a2", role: "assistant", text: "", toolCalls: [tc("t1")] }),
    msg({ messageId: "a3", role: "assistant", text: "Here's the summary." }),
  ]

  it("P2 fix — fragmented turn renders ONE card: tools collected on top, text below", () => {
    const view = lastTurnView(fragmented())
    // tools surfaced as a single merged stack (rendered above text by the JSX)
    expect(view.toolCalls).toHaveLength(1)
    expect((view.toolCalls[0] as { id: string }).id).toBe("t1")
    // both text fragments survive, in order, and render BELOW the tools (Option B)
    expect(view.textRows.map((r) => r.message.messageId)).toEqual(["a1", "a3"])
    expect(view.hasAssistantContent).toBe(true)
  })

  it("P1 fix — NO action bar appears while the turn is still generating", () => {
    const view = lastTurnView(fragmented(), { isGenerating: true, isLastTurn: true })
    expect(view.actionBarMessageId).toBeNull()
    expect(view.turnComplete).toBe(false)
  })

  it("single action bar — exactly one, on the LAST text block, once complete", () => {
    const view = lastTurnView(fragmented(), { isGenerating: false })
    expect(view.actionBarMessageId).toBe("a3")
    // sanity: only the last text row matches → one bar, not one per fragment
    const barsShown = view.textRows.filter((r) => r.message.messageId === view.actionBarMessageId)
    expect(barsShown).toHaveLength(1)
  })

  it("a completed PAST turn (not the active one) always shows its single bar", () => {
    const view = lastTurnView(fragmented(), { isGenerating: true, isLastTurn: false })
    expect(view.turnComplete).toBe(true)
    expect(view.actionBarMessageId).toBe("a3")
  })

  it("system injection mid-answer does not split or add a bar (only final bar)", () => {
    const view = lastTurnView([
      msg({ messageId: "u1", role: "user", text: "check host" }),
      msg({ messageId: "a1", role: "assistant", text: "Checking…" }),
      msg({ messageId: "s1", role: "user", text: "System (untrusted): [2026-06-29 11:49:05 UTC] Exec failed" }),
      msg({ messageId: "a2", role: "assistant", text: "Done, host is up." }),
    ])
    expect(view.textRows.map((r) => r.message.messageId)).toEqual(["a1", "a2"])
    expect(view.actionBarMessageId).toBe("a2")
  })

  it("tool-only turn (no text) → tool stack open by default, no action bar", () => {
    const view = lastTurnView([
      msg({ messageId: "u1", role: "user", text: "run it" }),
      msg({ messageId: "a1", role: "assistant", text: "", toolCalls: [tc("t1")] }),
    ])
    expect(view.toolCalls).toHaveLength(1)
    expect(view.toolsDefaultOpen).toBe(true)
    expect(view.textRows).toHaveLength(0)
    expect(view.actionBarMessageId).toBeNull()
    expect(view.hasAssistantContent).toBe(true)
  })

  it("suppressed live tool-only row is dropped (no empty bubble)", () => {
    const messages = [
      msg({ messageId: "u1", role: "user", text: "go" }),
      msg({ messageId: "a1", role: "assistant", text: "", toolCalls: [tc("t1")] }),
      msg({ messageId: "a2", role: "assistant", text: "final" }),
    ]
    const view = lastTurnView(messages, {
      isGenerating: true,
      isLastTurn: true,
      suppressedToolCallMessages: new Set(["a1"]),
    })
    // a1 is suppressed (its tools surface elsewhere); it must not be a row
    expect(view.assistantRows.map((r) => r.message.messageId)).toEqual(["a2"])
  })

  it("duplicate tool-only row with no content is dropped", () => {
    const messages = [
      msg({ messageId: "u1", role: "user", text: "go" }),
      msg({ messageId: "a1", role: "assistant", text: "answer" }),
      msg({ messageId: "a2", role: "assistant", text: "", toolCalls: [tc("t1")] }),
    ]
    const view = lastTurnView(messages, { duplicateToolOnlyRows: new Set(["a2"]) })
    expect(view.assistantRows.map((r) => r.message.messageId)).toEqual(["a1"])
  })

  it("empty turn (user just sent, no assistant) → no card content", () => {
    const view = lastTurnView([msg({ messageId: "u1", role: "user", text: "q" })])
    expect(view.hasAssistantContent).toBe(false)
    expect(view.actionBarMessageId).toBeNull()
  })
})
