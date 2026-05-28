import { describe, expect, test } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import {
  isKnownEmptyBootstrap,
  normalizeStatusLabelForStatus,
  selectInitialChatSnapshot,
  streamStatusFromCanonicalRun,
} from "../initialSnapshot"
import type { SessionState } from "../../chat-engine-v2/store"

function message(id: string, text = id): ChatMessage {
  return { messageId: id, role: "user", text }
}

function state(overrides: Partial<SessionState>): SessionState {
  return {
    cursor: 1,
    messages: [],
    historyCoverage: "full",
    messageCount: 0,
    status: "idle",
    statusLabel: null,
    pendingTools: [],
    spawnedSubagents: [],
    lastPatchAtMs: 0,
    activityStartedAtMs: 0,
    deferredDoneUntilAssistant: false,
    ...overrides,
  }
}

describe("initial chat runtime snapshot", () => {
  test("prefers explicit initial messages and starts in thinking state", () => {
    const snapshot = selectInitialChatSnapshot({
      initialMessages: [message("u1")],
      globalSession: state({ messages: [message("global")] }),
      cachedBootstrap: { messages: [message("cached")], history: { messages: [] } },
      syncWarmCache: { entry: { messages: [message("warm")] } },
    })

    expect(snapshot.messages?.map((m) => m.messageId)).toEqual(["u1"])
    expect(snapshot.status).toBe("thinking")
    expect(snapshot.loading).toBe(false)
    expect(snapshot.historyLoadVersion).toBe(1)
  })

  test("uses global session before cached bootstrap or sync warm cache", () => {
    const snapshot = selectInitialChatSnapshot({
      globalSession: state({
        messages: [message("global")],
        status: "streaming",
        statusLabel: "Writing",
      }),
      cachedBootstrap: {
        messages: [message("cached")],
        history: { messages: [] },
        runStatus: "done",
        statusLabel: "ignored",
      },
      syncWarmCache: { entry: { messages: [message("warm")], runStatus: "queued" } },
    })

    expect(snapshot.messages?.map((m) => m.messageId)).toEqual(["global"])
    expect(snapshot.status).toBe("streaming")
    expect(snapshot.statusLabel).toBe("Writing")
  })

  test("treats authoritative empty bootstrap as loaded without skeleton", () => {
    const snapshot = selectInitialChatSnapshot({
      cachedBootstrap: {
        source: "middleware-projection",
        projectionVersion: 2,
        messages: [],
        messageCount: 0,
        historyCoverage: "full",
        fullMessagesIncluded: true,
        history: { messages: [] },
      },
    })

    expect(snapshot.messages).toBeUndefined()
    expect(snapshot.knownEmpty).toBe(true)
    expect(snapshot.loading).toBe(false)
    expect(snapshot.historyLoadVersion).toBe(1)
  })

  test("does not treat partial empty bootstrap as authoritative", () => {
    expect(isKnownEmptyBootstrap({
      messages: [],
      messageCount: 0,
      historyCoverage: "windowed",
      history: { messages: [] },
    })).toBe(false)
  })

  test("normalizes status labels only for active or error states", () => {
    expect(normalizeStatusLabelForStatus("streaming", "Writing")).toBe("Writing")
    expect(normalizeStatusLabelForStatus("done", "Done")).toBeNull()
    expect(normalizeStatusLabelForStatus("error", "Failed")).toBe("Failed")
  })

  test("maps canonical run statuses into UI stream statuses", () => {
    expect(streamStatusFromCanonicalRun("aborted")).toBe("error")
    expect(streamStatusFromCanonicalRun("tool_running")).toBe("tool_running")
    expect(streamStatusFromCanonicalRun("unknown")).toBe("idle")
  })
})
