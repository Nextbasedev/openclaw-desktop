import { describe, expect, test, vi, beforeEach } from "vitest"
import {
  __resetForTests,
  drop,
  dropAll,
  generatingSessionKeys,
  get,
  getAll,
  isActiveRunStatus,
  isTerminalRunStatus,
  publish,
  releaseTerminal,
  subscribe,
  subscribeAll,
} from "../activeRunRegistry"
import type { ChatMessage } from "../../../components/ChatView/types"

function msg(id: string, role: ChatMessage["role"], text: string): ChatMessage {
  return { messageId: id, role, text, createdAt: new Date().toISOString() }
}

describe("activeRunRegistry", () => {
  beforeEach(() => __resetForTests())

  test("publish creates an entry with derived isGenerating", () => {
    const snap = publish("agent:main:a", {
      messages: [msg("u1", "user", "hi")],
      streamStatus: "thinking",
      statusLabel: "Thinking",
      streamCursor: 42,
    })
    expect(snap.isGenerating).toBe(true)
    expect(snap.streamStatus).toBe("thinking")
    expect(snap.statusLabel).toBe("Thinking")
    expect(snap.streamCursor).toBe(42)
    expect(get("agent:main:a")?.isGenerating).toBe(true)
  })

  test("publish without sending and with idle status reports not generating", () => {
    const snap = publish("agent:main:b", {
      messages: [],
      streamStatus: "idle",
    })
    expect(snap.isGenerating).toBe(false)
    expect(generatingSessionKeys().size).toBe(0)
  })

  test("publish merges partial updates into the existing snapshot", () => {
    publish("s", { messages: [msg("u1", "user", "hi")], streamStatus: "thinking" })
    publish("s", { streamStatus: "tool_running", statusLabel: "Running tool" })
    const snap = get("s")
    expect(snap?.messages).toHaveLength(1)
    expect(snap?.streamStatus).toBe("tool_running")
    expect(snap?.statusLabel).toBe("Running tool")
    expect(snap?.isGenerating).toBe(true)
  })

  test("publish preserves windowState across partial updates", () => {
    publish("s", {
      messages: [msg("a1", "assistant", "older window")],
      streamStatus: "streaming",
      windowState: {
        oldestLoadedSeq: 52,
        newestLoadedSeq: 103,
        hasOlder: true,
        hasNewer: false,
        isLoadingOlder: false,
        isLoadingNewer: false,
      },
    })
    publish("s", { streamStatus: "idle" })
    expect(get("s")?.windowState).toEqual({
      oldestLoadedSeq: 52,
      newestLoadedSeq: 103,
      hasOlder: true,
      hasNewer: false,
      isLoadingOlder: false,
      isLoadingNewer: false,
    })
  })

  test("sending=true forces generating even on idle status", () => {
    publish("s", { messages: [], streamStatus: "idle", sending: true })
    expect(get("s")?.isGenerating).toBe(true)
  })

  test("publishing terminal status keeps the snapshot (so remount can render the final frame)", () => {
    publish("s", { messages: [msg("a1", "assistant", "answer")], streamStatus: "streaming" })
    publish("s", { streamStatus: "idle" })
    const snap = get("s")
    expect(snap).not.toBeNull()
    expect(snap?.streamStatus).toBe("idle")
    expect(snap?.isGenerating).toBe(false)
  })

  test("releaseTerminal removes the entry and emits null", () => {
    const listener = vi.fn()
    publish("s", { messages: [], streamStatus: "thinking" })
    const unsubscribe = subscribe("s", listener)
    listener.mockClear()
    releaseTerminal("s", "test")
    expect(get("s")).toBeNull()
    expect(listener).toHaveBeenCalledWith(null)
    unsubscribe()
  })

  test("releaseTerminal is a no-op when no entry exists", () => {
    const listener = vi.fn()
    const unsubscribe = subscribe("s", listener)
    releaseTerminal("s", "test")
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test("drop removes entry without lifecycle semantics", () => {
    publish("s", { messages: [], streamStatus: "thinking" })
    drop("s")
    expect(get("s")).toBeNull()
  })

  test("dropAll clears every entry and emits per-session null", () => {
    publish("s1", { messages: [], streamStatus: "thinking" })
    publish("s2", { messages: [], streamStatus: "thinking" })
    const l1 = vi.fn()
    const l2 = vi.fn()
    subscribe("s1", l1)
    subscribe("s2", l2)
    l1.mockClear(); l2.mockClear()
    dropAll()
    expect(getAll().size).toBe(0)
    expect(l1).toHaveBeenCalledWith(null)
    expect(l2).toHaveBeenCalledWith(null)
  })

  test("single-session subscriber gets updates only for its session", () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    subscribe("a", listenerA)
    subscribe("b", listenerB)
    publish("a", { messages: [], streamStatus: "thinking" })
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(0)
    publish("b", { messages: [], streamStatus: "tool_running" })
    expect(listenerB).toHaveBeenCalledTimes(1)
  })

  test("map subscriber receives every mutation with the full map", () => {
    const seen: number[] = []
    subscribeAll((snapshot) => seen.push(snapshot.size))
    publish("a", { messages: [], streamStatus: "thinking" })
    publish("b", { messages: [], streamStatus: "thinking" })
    publish("a", { streamStatus: "tool_running" })
    drop("a")
    expect(seen).toEqual([1, 2, 2, 1])
  })

  test("generatingSessionKeys reflects all currently active sessions", () => {
    publish("a", { messages: [], streamStatus: "thinking" })
    publish("b", { messages: [], streamStatus: "idle" })
    publish("c", { messages: [], streamStatus: "tool_running" })
    publish("d", { messages: [], streamStatus: "idle", sending: true })
    const keys = generatingSessionKeys()
    expect(keys.has("a")).toBe(true)
    expect(keys.has("b")).toBe(false)
    expect(keys.has("c")).toBe(true)
    expect(keys.has("d")).toBe(true)
  })

  test("isActiveRunStatus / isTerminalRunStatus helpers", () => {
    expect(isActiveRunStatus("thinking")).toBe(true)
    expect(isActiveRunStatus("streaming")).toBe(true)
    expect(isActiveRunStatus("idle")).toBe(false)
    expect(isTerminalRunStatus("idle")).toBe(true)
    expect(isTerminalRunStatus("error")).toBe(true)
    expect(isTerminalRunStatus("thinking")).toBe(false)
  })

  test("unsubscribe stops further notifications", () => {
    const listener = vi.fn()
    const unsub = subscribe("s", listener)
    publish("s", { messages: [], streamStatus: "thinking" })
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    publish("s", { streamStatus: "streaming" })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("getAll returns a defensive copy", () => {
    publish("s", { messages: [], streamStatus: "thinking" })
    const map = getAll()
    expect(map.size).toBe(1)
    // mutating the returned map does not affect the registry
    ;(map as Map<string, unknown>).clear()
    expect(get("s")).not.toBeNull()
  })
})
