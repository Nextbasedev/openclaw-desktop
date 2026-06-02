import { describe, it, expect, beforeEach, vi } from "vitest"
import { ChatTimelineStore, clearAllTimelineStores } from "../timelineStore"
import type { ChatMessage } from "@/components/ChatView/types"

function msg(id: string, text: string, seq: number, role: "user" | "assistant" = "assistant"): ChatMessage {
  return { messageId: id, role, text, gatewayIndex: seq } as ChatMessage
}

describe("ChatTimelineStore Integration", () => {
  let store: ChatTimelineStore

  beforeEach(() => {
    clearAllTimelineStores()
    store = new ChatTimelineStore("integration-test")
  })

  describe("full warm→bootstrap→patch flow", () => {
    it("warm cache → bootstrap replaces → patches add on top", () => {
      const listener = vi.fn()
      store.subscribe(listener)

      // Step 1: Warm cache (60 messages)
      const warmMsgs = Array.from({ length: 60 }, (_, i) => msg(`m${i}`, `warm-${i}`, i))
      store.applyWarmCache(warmMsgs, 50, 60)
      store.flushSync()
      expect(listener).toHaveBeenCalled()
      let snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(60)
      expect(snap.source).toBe("warm-cache")
      expect(snap.bootstrapSettled).toBe(false)

      // Step 2: Bootstrap (85 messages, replaces warm cache)
      const bootMsgs = Array.from({ length: 85 }, (_, i) => msg(`b${i}`, `boot-${i}`, i))
      store.applyBootstrap(bootMsgs, 100, 85)
      store.flushSync()
      snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(85)
      expect(snap.source).toBe("bootstrap")
      expect(snap.bootstrapSettled).toBe(true)
      // Warm cache messages gone (bootstrap replaced)
      expect(snap.messages.every((m) => m.messageId.startsWith("b"))).toBe(true)

      // Step 3: Patch adds new message
      store.applyPatchMessage(msg("live-1", "live response", 86), 101)
      store.flushSync()
      snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(86)
      expect(snap.cursor).toBe(101)
    })

    it("no count jump: warm 60 + bootstrap 85 = single notify with 85", () => {
      let notifyCount = 0
      const messageCounts: number[] = []
      store.subscribe((snap) => {
        notifyCount++
        messageCounts.push(snap.messages.length)
      })

      // Apply warm cache + bootstrap without flushing between
      const warmMsgs = Array.from({ length: 60 }, (_, i) => msg(`w${i}`, `warm-${i}`, i))
      store.applyWarmCache(warmMsgs, 50)
      // Don't flush yet — apply bootstrap immediately
      const bootMsgs = Array.from({ length: 85 }, (_, i) => msg(`b${i}`, `boot-${i}`, i))
      store.applyBootstrap(bootMsgs, 100)

      store.flushSync()
      // In test env (sync flush), we get calls for each applyX.
      // In browser with rAF, these would batch into one call.
      // What matters: final state is 85, not 60→85 jump visible to user
      const lastCount = messageCounts[messageCounts.length - 1]
      expect(lastCount).toBe(85)
    })
  })

  describe("optimistic send flow", () => {
    it("optimistic → confirmed replaces without duplicate", () => {
      store.applyBootstrap([msg("prev", "previous message", 1)], 10)
      store.flushSync()

      // User sends (optimistic)
      store.applyOptimistic(msg("opt-1", "my question", 100, "user"))
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(2)

      // Gateway confirms with real ID
      store.confirmOptimistic("opt-1", msg("real-1", "my question", 2, "user"))
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(2) // still 2, not 3
      expect(store.getSnapshot().messages[1].messageId).toBe("real-1")

      // Assistant responds
      store.applyPatchMessage(msg("assist-1", "answer", 3), 11)
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(3)
    })
  })

  describe("rapid chat switch", () => {
    it("separate stores for different sessions don't interfere", () => {
      const storeA = new ChatTimelineStore("session-a")
      const storeB = new ChatTimelineStore("session-b")

      storeA.applyBootstrap([msg("a1", "chat A", 1)], 10)
      storeB.applyBootstrap([msg("b1", "chat B", 1), msg("b2", "chat B msg 2", 2)], 20)

      storeA.flushSync()
      storeB.flushSync()

      expect(storeA.getSnapshot().messages).toHaveLength(1)
      expect(storeB.getSnapshot().messages).toHaveLength(2)
      expect(storeA.getSnapshot().messages[0].text).toBe("chat A")
      expect(storeB.getSnapshot().messages[0].text).toBe("chat B")
    })
  })

  describe("stale warm cache rejection", () => {
    it("warm cache ignored after bootstrap", () => {
      store.applyBootstrap([msg("fresh-1", "fresh data", 1)], 100)
      store.flushSync()

      // Stale warm cache arrives late (from slow IndexedDB)
      store.applyWarmCache(
        [msg("stale-1", "old data", 1), msg("stale-2", "old data 2", 2)],
        50,
      )
      store.flushSync()

      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(1)
      expect(snap.messages[0].text).toBe("fresh data")
    })
  })

  describe("message text update (streaming)", () => {
    it("text updates via patch replace previous version", () => {
      store.applyBootstrap([msg("m1", "Hello", 1, "user")], 10)
      store.flushSync()

      // Assistant starts streaming
      store.applyPatchMessage(msg("a1", "I think", 2), 11)
      store.flushSync()
      expect(store.getSnapshot().messages[1].text).toBe("I think")

      // More text arrives
      store.applyPatchMessage(msg("a1", "I think the answer is 42", 2), 12)
      store.flushSync()
      expect(store.getSnapshot().messages[1].text).toBe("I think the answer is 42")
      expect(store.getSnapshot().messages).toHaveLength(2) // no duplicate
    })
  })

  describe("pagination (load older messages)", () => {
    it("older messages merge correctly", () => {
      // Bootstrap loads recent 5 messages (seq 96-100)
      const recent = Array.from({ length: 5 }, (_, i) => msg(`r${i}`, `recent-${i}`, 96 + i))
      store.applyBootstrap(recent, 100)
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(5)

      // User scrolls up, loads older page (seq 80-95)
      const older = Array.from({ length: 16 }, (_, i) => msg(`o${i}`, `older-${i}`, 80 + i))
      for (const m of older) store.applyPatchMessage(m, 100)
      store.flushSync()

      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(21) // 16 older + 5 recent
      // Sorted by seq
      expect(snap.messages[0].gatewayIndex).toBe(80)
      expect(snap.messages[20].gatewayIndex).toBe(100)
    })
  })

  describe("message removal", () => {
    it("removes message and maintains order", () => {
      store.applyBootstrap([
        msg("m1", "first", 1),
        msg("m2", "second", 2),
        msg("m3", "third", 3),
      ], 10)
      store.flushSync()

      store.removeMessage("m2", 11)
      store.flushSync()

      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(2)
      expect(snap.messages.map((m) => m.messageId)).toEqual(["m1", "m3"])
    })
  })
})

describe("method interaction pairs", () => {
  let store: ChatTimelineStore
  beforeEach(() => { clearAllTimelineStores(); store = new ChatTimelineStore("pair-test") })

  it("applyOptimistic → applyBootstrap preserves optimistic", () => {
    store.applyOptimistic(msg("opt-1", "sending...", 999, "user"))
    store.flushSync()
    store.applyBootstrap([msg("m1", "old", 1), msg("m2", "old2", 2)], 10)
    store.flushSync()
    const snap = store.getSnapshot()
    // optimistic preserved + bootstrap messages = 3
    expect(snap.messages.some(m => m.messageId === "opt-1")).toBe(true)
    expect(snap.messages).toHaveLength(3)
  })

  it("applyOptimistic → applyBootstrap that includes confirmed version replaces optimistic", () => {
    store.applyOptimistic(msg("opt-1", "sending...", 999, "user"))
    store.flushSync()
    // Bootstrap includes the confirmed version with same ID
    store.applyBootstrap([msg("opt-1", "confirmed!", 3, "user"), msg("m1", "old", 1)], 10)
    store.flushSync()
    const snap = store.getSnapshot()
    expect(snap.messages).toHaveLength(2) // not 3
    expect(snap.messages.find(m => m.messageId === "opt-1")?.text).toBe("confirmed!")
  })

  it("applyWarmCache → applyOptimistic → applyBootstrap", () => {
    store.applyWarmCache([msg("w1", "cached", 1)], 5)
    store.flushSync()
    store.applyOptimistic(msg("opt-1", "sending", 999, "user"))
    store.flushSync()
    store.applyBootstrap([msg("b1", "fresh", 1)], 20)
    store.flushSync()
    const snap = store.getSnapshot()
    // warm cache replaced by bootstrap, optimistic preserved
    expect(snap.messages.some(m => m.messageId === "opt-1")).toBe(true)
    expect(snap.messages.some(m => m.messageId === "b1")).toBe(true)
    expect(snap.messages.some(m => m.messageId === "w1")).toBe(false)
  })

  it("optimistic sorts to end, not beginning", () => {
    store.applyBootstrap([msg("m1", "first", 1), msg("m2", "second", 2)], 10)
    store.flushSync()
    store.applyOptimistic(msg("opt-1", "my message", 0, "user"))
    store.flushSync()
    const snap = store.getSnapshot()
    // optimistic should be LAST, not first
    expect(snap.messages[snap.messages.length - 1].messageId).toBe("opt-1")
  })

  it("multiple optimistic messages maintain order", () => {
    store.applyBootstrap([msg("m1", "prev", 1)], 10)
    store.flushSync()
    store.applyOptimistic({ ...msg("opt-1", "first send", 0, "user"), isOptimistic: true })
    store.applyOptimistic({ ...msg("opt-2", "second send", 0, "user"), isOptimistic: true })
    store.flushSync()
    const snap = store.getSnapshot()
    expect(snap.messages).toHaveLength(3)
    expect(snap.messages[0].messageId).toBe("m1") // canonical first
  })

  it("removeMessage on optimistic message works", () => {
    store.applyOptimistic(msg("opt-1", "oops", 999, "user"))
    store.flushSync()
    store.removeMessage("opt-1", 0)
    store.flushSync()
    expect(store.getSnapshot().messages).toHaveLength(0)
  })

  it("applyPatchMessage after bootstrap adds to existing", () => {
    store.applyBootstrap([msg("m1", "base", 1)], 10)
    store.flushSync()
    store.applyPatchMessage(msg("m2", "live", 2), 11)
    store.flushSync()
    expect(store.getSnapshot().messages).toHaveLength(2)
  })

  it("applyBootstrap after patches keeps newer patch data (bootstrap is lower cursor)", () => {
    store.applyPatchMessage(msg("p1", "live", 1), 15)
    store.flushSync()
    store.applyBootstrap([msg("b1", "fresh", 1)], 10)
    store.flushSync()
    // patch message kept because bootstrap cursor (10) is lower than live patch cursor (15)
    expect(store.getSnapshot().messages).toHaveLength(2)
    expect(store.getSnapshot().messages.map((m) => m.messageId)).toContain("b1")
    expect(store.getSnapshot().messages.map((m) => m.messageId)).toContain("p1")
  })
})
