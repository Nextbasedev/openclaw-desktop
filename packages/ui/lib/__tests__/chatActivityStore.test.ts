import { afterEach, describe, expect, it } from "vitest"
import {
  cacheChatActivity,
  clearChatActivityStoreForTests,
  getAllCachedChatActivity,
  getCachedChatActivity,
  markOptimisticChatActivity,
  subscribeChatActivity,
} from "../chatActivityStore"

afterEach(() => clearChatActivityStoreForTests())

describe("chatActivityStore", () => {
  it("caches live thinking state for instant tab restore", () => {
    cacheChatActivity("agent:main:a", {
      status: "thinking",
      statusLabel: "Thinking",
      pendingTools: [],
      spawnedSubagents: [],
    })

    expect(getCachedChatActivity("agent:main:a")).toMatchObject({
      status: "thinking",
      statusLabel: "Thinking",
    })
  })

  it("caches running tool calls even when status is idle", () => {
    cacheChatActivity("agent:main:a", {
      status: "idle",
      statusLabel: null,
      pendingTools: [{ id: "tc1", tool: "read", status: "running" }],
      spawnedSubagents: [],
    })

    expect(getCachedChatActivity("agent:main:a")?.pendingTools).toHaveLength(1)
  })

  it("marks optimistic thinking before send/stream confirmation", () => {
    markOptimisticChatActivity("agent:main:a")
    expect(getCachedChatActivity("agent:main:a")).toMatchObject({
      status: "thinking",
      statusLabel: "Thinking",
    })
  })

  it("exposes all cached activity for sidebar running indicators", () => {
    cacheChatActivity("agent:main:a", {
      status: "running",
      statusLabel: "Running",
      pendingTools: [],
      spawnedSubagents: [],
    })

    expect(getAllCachedChatActivity().has("agent:main:a")).toBe(true)
  })

  it("notifies subscribers when activity changes", () => {
    const events: Array<string | null> = []
    const unsubscribe = subscribeChatActivity((sessionKey, snapshot) => {
      events.push(snapshot ? sessionKey : null)
    })

    cacheChatActivity("agent:main:a", {
      status: "thinking",
      statusLabel: null,
      pendingTools: [],
      spawnedSubagents: [],
    })
    cacheChatActivity("agent:main:a", {
      status: "done",
      statusLabel: null,
      pendingTools: [],
      spawnedSubagents: [],
    })
    unsubscribe()

    expect(events).toEqual(["agent:main:a", null])
  })

  it("clears terminal completed activity instead of replaying stale running UI", () => {
    cacheChatActivity("agent:main:a", {
      status: "thinking",
      statusLabel: null,
      pendingTools: [],
      spawnedSubagents: [],
    })
    cacheChatActivity("agent:main:a", {
      status: "done",
      statusLabel: null,
      pendingTools: [],
      spawnedSubagents: [],
    })

    expect(getCachedChatActivity("agent:main:a")).toBeNull()
  })
})
