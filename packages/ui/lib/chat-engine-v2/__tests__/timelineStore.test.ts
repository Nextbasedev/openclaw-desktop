import { describe, it, expect, beforeEach, vi } from "vitest"
import { ChatTimelineStore, getTimelineStore, deleteTimelineStore, clearAllTimelineStores } from "../timelineStore"
import type { ChatMessage } from "@/components/ChatView/types"

function msg(id: string, text: string, seq: number, role: "user" | "assistant" = "assistant"): ChatMessage {
  return {
    messageId: id,
    role,
    text,
    gatewayIndex: seq,
  } as ChatMessage
}

describe("ChatTimelineStore", () => {
  let store: ChatTimelineStore

  beforeEach(() => {
    clearAllTimelineStores()
    store = new ChatTimelineStore("test-session")
  })

  describe("warm cache", () => {
    it("applies warm cache messages", () => {
      store.applyWarmCache([msg("m1", "hello", 1), msg("m2", "world", 2)], 10)
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(2)
      expect(snap.cursor).toBe(10)
      expect(snap.source).toBe("warm-cache")
      expect(snap.bootstrapSettled).toBe(false)
    })

    it("ignores warm cache after bootstrap settles", () => {
      store.applyBootstrap([msg("m1", "fresh", 1)], 20)
      store.flushSync()
      store.applyWarmCache([msg("m1", "stale", 1), msg("m2", "extra", 2)], 5)
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(1)
      expect(snap.messages[0].text).toBe("fresh")
    })

    it("ignores warm cache with lower cursor when data exists", () => {
      store.applyWarmCache([msg("m1", "first", 1)], 10)
      store.flushSync()
      store.applyWarmCache([msg("m1", "older", 1)], 5)
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.cursor).toBe(10)
    })
  })

  describe("bootstrap", () => {
    it("replaces warm cache entirely", () => {
      store.applyWarmCache([msg("m1", "cached", 1), msg("m2", "cached2", 2)], 5)
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(2)

      store.applyBootstrap([msg("m1", "fresh", 1), msg("m3", "new", 3)], 20)
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(2)
      expect(snap.messages.map((m) => m.messageId)).toEqual(["m1", "m3"])
      expect(snap.messages[0].text).toBe("fresh")
      expect(snap.source).toBe("bootstrap")
      expect(snap.bootstrapSettled).toBe(true)
    })

    it("sets correct message count", () => {
      store.applyBootstrap([msg("m1", "a", 1)], 10, 50)
      store.flushSync()
      expect(store.getSnapshot().messageCount).toBe(50)
    })
  })

  describe("patches", () => {
    it("adds new message via patch", () => {
      store.applyBootstrap([msg("m1", "hello", 1)], 10)
      store.flushSync()
      store.applyPatchMessage(msg("m2", "response", 2), 11)
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(2)
      expect(store.getSnapshot().cursor).toBe(11)
    })

    it("updates existing message via patch", () => {
      store.applyBootstrap([msg("m1", "draft", 1)], 10)
      store.flushSync()
      store.applyPatchMessage(msg("m1", "final", 1), 11)
      store.flushSync()
      expect(store.getSnapshot().messages[0].text).toBe("final")
    })

    it("removes message via patch", () => {
      store.applyBootstrap([msg("m1", "hello", 1), msg("m2", "world", 2)], 10)
      store.flushSync()
      store.removeMessage("m1", 11)
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(1)
      expect(store.getSnapshot().messages[0].messageId).toBe("m2")
    })
  })

  describe("optimistic messages", () => {
    it("adds optimistic message", () => {
      store.applyBootstrap([msg("m1", "prev", 1)], 10)
      store.flushSync()
      store.applyOptimistic(msg("opt-1", "sending...", 100, "user"))
      store.flushSync()
      expect(store.getSnapshot().messages).toHaveLength(2)
    })

    it("confirms optimistic with gateway echo", () => {
      store.applyOptimistic(msg("opt-1", "sending...", 100, "user"))
      store.flushSync()
      store.confirmOptimistic("opt-1", msg("real-1", "sent!", 2, "user"))
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(1)
      expect(snap.messages[0].messageId).toBe("real-1")
      expect(snap.messages[0].text).toBe("sent!")
    })

    it("replaces optimistic user when a canonical user patch arrives with the same text", () => {
      store.applyOptimistic({
        ...msg("optimistic-user", "hey", 0, "user"),
        createdAt: "2026-05-29T04:32:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      })
      store.flushSync()

      store.applyPatchMessage(msg("gateway-user", "hey", 1, "user"), 2)
      store.flushSync()

      const snap = store.getSnapshot()
      expect(snap.messages.map((message) => message.messageId)).toEqual(["gateway-user"])
      expect(snap.messages.some((message) => message.isOptimistic)).toBe(false)
    })

    it("drops optimistic user when bootstrap contains canonical echo with different id", () => {
      store.applyBootstrap([msg("prev", "previous", 1, "assistant")], 10)
      store.flushSync()
      store.applyOptimistic({
        ...msg("optimistic-user", "hii", 0, "user"),
        createdAt: "2026-05-26T03:40:00.000Z",
        isOptimistic: true,
        sendStatus: "sending",
      })
      store.flushSync()

      store.applyBootstrap([
        msg("prev", "previous", 1, "assistant"),
        {
          ...msg("gateway-user", "hii", 2, "user"),
          createdAt: "2026-05-26T03:40:02.000Z",
        },
      ], 20)
      store.flushSync()

      const snap = store.getSnapshot()
      expect(snap.messages.map((message) => message.messageId)).toEqual(["prev", "gateway-user"])
      expect(snap.messages.some((message) => message.isOptimistic)).toBe(false)
    })
  })

  describe("conflict resolution", () => {
    it("higher cursor wins for same message", () => {
      store.applyWarmCache([msg("m1", "old", 1)], 5)
      store.flushSync()
      store.applyPatchMessage(msg("m1", "new", 1), 15)
      store.flushSync()
      expect(store.getSnapshot().messages[0].text).toBe("new")
    })

    it("bootstrap with lower cursor than patches keeps patch messages", () => {
      // Patches arrived first (cursor 15)
      store.applyPatchMessage(msg("m2", "live", 2), 15)
      store.flushSync()
      // Bootstrap arrives with lower cursor (10) but is authoritative
      store.applyBootstrap([msg("m1", "boot", 1)], 10)
      store.flushSync()
      // Bootstrap clears and replaces — m2 from patch is gone
      // This is correct: bootstrap is authoritative for the message SET
      const snap = store.getSnapshot()
      expect(snap.messages).toHaveLength(1)
      expect(snap.messages[0].messageId).toBe("m1")
      // But cursor stays at max
      expect(snap.cursor).toBe(15)
    })

    it("no count jumps: warm cache 60 → bootstrap 85", () => {
      const warmMsgs = Array.from({ length: 60 }, (_, i) => msg(`w${i}`, `warm${i}`, i))
      store.applyWarmCache(warmMsgs, 50)
      store.flushSync()
      const snap1 = store.getSnapshot()
      expect(snap1.messages).toHaveLength(60)

      const bootMsgs = Array.from({ length: 85 }, (_, i) => msg(`b${i}`, `boot${i}`, i))
      store.applyBootstrap(bootMsgs, 100)
      store.flushSync()
      const snap2 = store.getSnapshot()
      // Bootstrap replaces entirely — single jump from warm to boot
      // The key: only ONE notify fires (batched), so React sees 60→85 in one render
      expect(snap2.messages).toHaveLength(85)
      expect(snap2.bootstrapSettled).toBe(true)
    })
  })

  describe("batching", () => {
    it("delivers all patches to listener (sync in test env, batched in browser)", () => {
      const listener = vi.fn()
      store.subscribe(listener)

      store.applyPatchMessage(msg("m1", "a", 1), 1)
      store.applyPatchMessage(msg("m2", "b", 2), 2)
      store.applyPatchMessage(msg("m3", "c", 3), 3)
      store.flushSync()
      // In test env (no rAF), each call notifies sync. In browser, batched.
      // What matters: final state has all 3 messages
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1]
      expect(lastCall[0].messages).toHaveLength(3)
    })
  })

  describe("message ordering", () => {
    it("sorts by gatewayIndex", () => {
      store.applyPatchMessage(msg("m3", "third", 3), 1)
      store.applyPatchMessage(msg("m1", "first", 1), 2)
      store.applyPatchMessage(msg("m2", "second", 2), 3)
      store.flushSync()
      const snap = store.getSnapshot()
      expect(snap.messages.map((m) => m.text)).toEqual(["first", "second", "third"])
    })
  })

  describe("subscribe", () => {
    it("notifies on changes", () => {
      const listener = vi.fn()
      store.subscribe(listener)
      store.applyWarmCache([msg("m1", "hello", 1)], 5)
      store.flushSync()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("unsubscribe stops notifications", () => {
      const listener = vi.fn()
      const unsub = store.subscribe(listener)
      unsub()
      store.applyWarmCache([msg("m1", "hello", 1)], 5)
      store.flushSync()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("registry", () => {
    it("returns same store for same session key", () => {
      const a = getTimelineStore("session-1")
      const b = getTimelineStore("session-1")
      expect(a).toBe(b)
    })

    it("returns different stores for different sessions", () => {
      const a = getTimelineStore("session-1")
      const b = getTimelineStore("session-2")
      expect(a).not.toBe(b)
    })

    it("deleteTimelineStore removes and destroys", () => {
      const store = getTimelineStore("session-1")
      store.applyWarmCache([msg("m1", "hello", 1)], 5)
      deleteTimelineStore("session-1")
      const newStore = getTimelineStore("session-1")
      expect(newStore).not.toBe(store)
      expect(newStore.size).toBe(0)
    })
  })

  describe("destroy", () => {
    it("clears all state", () => {
      store.applyBootstrap([msg("m1", "hello", 1)], 10)
      store.flushSync()
      const listener = vi.fn()
      store.subscribe(listener)
      store.destroy()
      expect(store.size).toBe(0)
      store.applyWarmCache([msg("m2", "after", 2)], 20)
      store.flushSync()
      // Listener was cleared by destroy
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
