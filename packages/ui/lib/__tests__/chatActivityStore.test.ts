import { afterEach, describe, expect, it } from "vitest"
import {
  cacheChatActivity,
  clearChatActivityStoreForTests,
  getCachedChatActivity,
  markOptimisticChatActivity,
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
