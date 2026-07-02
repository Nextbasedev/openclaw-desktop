import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  clearGlobalChatEngineForTests,
  getGlobalChatSession,
  ingestGlobalChatPatchForTests,
} from "../store"
import type { PatchFrame } from "../types"

function statusFrame(cursor: number, phase: "start" | "end", extra: Record<string, unknown> = {}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor,
      type: "chat.compaction.status",
      sessionKey: "s1",
      createdAtMs: cursor,
      payload: {
        sessionKey: "s1",
        semanticType: "chat.compaction.status",
        runId: "run-1",
        phase,
        active: phase === "start",
        ...extra,
      },
    },
  }
}

function markerFrame(cursor: number, payload: Record<string, unknown>, createdAtMs = cursor): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor,
      type: "chat.compaction.marker",
      sessionKey: "s1",
      createdAtMs,
      payload: { sessionKey: "s1", semanticType: "chat.compaction.marker", ...payload },
    },
  }
}

describe("compaction store handling", () => {
  beforeEach(() => clearGlobalChatEngineForTests())
  afterEach(() => clearGlobalChatEngineForTests())

  test("start sets activeRunId, end clears it", () => {
    ingestGlobalChatPatchForTests(statusFrame(1, "start"))
    expect(getGlobalChatSession("s1")?.compaction.activeRunId).toBe("run-1")

    ingestGlobalChatPatchForTests(statusFrame(2, "end", { active: false, completed: true }))
    expect(getGlobalChatSession("s1")?.compaction.activeRunId).toBeNull()
  })

  test("marker is stored with the OCPlatform summary and deduped by compactionId", () => {
    ingestGlobalChatPatchForTests(markerFrame(1, {
      compactionId: "cmp-1",
      runId: "run-1",
      summary: "## Goal\nX",
      tokensBefore: 200000,
      firstKeptEntryId: "keep-1",
    }))
    // Replay of the same compaction must not create a second marker.
    ingestGlobalChatPatchForTests(markerFrame(2, { compactionId: "cmp-1", summary: "## Goal\nX", runId: "run-1" }))

    const markers = getGlobalChatSession("s1")?.compaction.markers ?? []
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ id: "cmp-1", summary: "## Goal\nX", tokensBefore: 200000, firstKeptEntryId: "keep-1" })
  })

  test("markers are ordered by createdAtMs", () => {
    // Patches arrive in ascending cursor order (the stream is monotonic), but
    // the sort key is createdAtMs; assert the sort holds when they differ.
    ingestGlobalChatPatchForTests(markerFrame(10, { compactionId: "b", summary: "second" }, 500))
    ingestGlobalChatPatchForTests(markerFrame(50, { compactionId: "a", summary: "first" }, 100))
    const markers = getGlobalChatSession("s1")?.compaction.markers ?? []
    expect(markers.map((m) => m.id)).toEqual(["a", "b"])
  })

  test("a completed marker for the active run clears a lingering active flag", () => {
    ingestGlobalChatPatchForTests(statusFrame(1, "start"))
    expect(getGlobalChatSession("s1")?.compaction.activeRunId).toBe("run-1")
    // End status missed (reconnect); the marker itself resolves the run.
    ingestGlobalChatPatchForTests(markerFrame(3, { compactionId: "cmp-1", runId: "run-1", summary: "done" }))
    expect(getGlobalChatSession("s1")?.compaction.activeRunId).toBeNull()
    expect(getGlobalChatSession("s1")?.compaction.markers).toHaveLength(1)
  })
})
