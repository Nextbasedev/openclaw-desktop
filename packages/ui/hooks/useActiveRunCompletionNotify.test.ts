import { describe, expect, it, vi } from "vitest"
import { createRunCompletionObserver, lastAssistantText } from "./useActiveRunCompletionNotify"
import type { ActiveRunSnapshot } from "@/lib/chat-engine-v2/activeRunRegistry"

function snapshot(overrides: Partial<ActiveRunSnapshot>): ActiveRunSnapshot {
  return {
    sessionKey: "s1",
    messages: [],
    streamStatus: "idle",
    statusLabel: null,
    streamCursor: null,
    sending: false,
    updatedAt: 1,
    isGenerating: false,
    ...overrides,
  }
}

describe("active run completion notifications", () => {
  it("extracts the latest assistant text", () => {
    expect(lastAssistantText([
      { messageId: "u1", role: "user", text: "hi" },
      { messageId: "a1", role: "assistant", text: "first" },
      { messageId: "a2", role: "assistant", text: "  second  " },
    ])).toBe("second")
  })

  it("suppresses completion when another session completes while the app is focused", () => {
    const notify = vi.fn(async () => undefined)
    const observer = createRunCompletionObserver({
      notify,
      getContext: () => ({ isVisible: false, isBackgrounded: false, title: null }),
    })

    observer(new Map([["s1", snapshot({ streamStatus: "streaming", isGenerating: true })]]))
    observer(new Map([["s1", snapshot({
      streamStatus: "idle",
      isGenerating: false,
      messages: [{ messageId: "a1", role: "assistant", text: "done" }],
    })]]))

    expect(notify).not.toHaveBeenCalled()
  })

  it("suppresses completion when that exact session is visible and focused", () => {
    const notify = vi.fn(async () => undefined)
    const observer = createRunCompletionObserver({
      notify,
      getContext: () => ({ isVisible: true, isBackgrounded: false, title: "Current" }),
    })

    observer(new Map([["s1", snapshot({ streamStatus: "thinking", isGenerating: true })]]))
    observer(new Map([["s1", snapshot({ streamStatus: "idle", isGenerating: false })]]))

    expect(notify).not.toHaveBeenCalled()
  })

  it("notifies completed sessions when the app is backgrounded", () => {
    const notify = vi.fn(async () => undefined)
    const observer = createRunCompletionObserver({
      notify,
      getContext: () => ({ isVisible: true, isBackgrounded: true, title: "Current" }),
    })

    observer(new Map([["s1", snapshot({ streamStatus: "running", isGenerating: true })]]))
    observer(new Map([["s1", snapshot({ streamStatus: "idle", isGenerating: false })]]))

    expect(notify).toHaveBeenCalledWith("Current", "s1", undefined)
  })

  it("notifies switched-away sessions when the app is backgrounded", () => {
    const notify = vi.fn(async () => undefined)
    const observer = createRunCompletionObserver({
      notify,
      getContext: () => ({ isVisible: false, isBackgrounded: true, title: null }),
    })

    observer(new Map([["s1", snapshot({ streamStatus: "streaming", isGenerating: true })]]))
    observer(new Map([["s1", snapshot({
      streamStatus: "idle",
      isGenerating: false,
      messages: [{ messageId: "a1", role: "assistant", text: "done" }],
    })]]))

    expect(notify).toHaveBeenCalledWith("Response Ready", "s1", "done")
  })

  it("dedupes replayed completion transitions for the same response", () => {
    const notify = vi.fn(async () => undefined)
    const observer = createRunCompletionObserver({
      notify,
      getContext: () => ({ isVisible: false, isBackgrounded: true, title: null }),
    })
    const done = snapshot({
      streamStatus: "idle",
      isGenerating: false,
      messages: [{ messageId: "a1", role: "assistant", text: "done" }],
    })

    observer(new Map([["s1", snapshot({ streamStatus: "streaming", isGenerating: true })]]))
    observer(new Map([["s1", done]]))
    observer(new Map([["s1", snapshot({ streamStatus: "streaming", isGenerating: true })]]))
    observer(new Map([["s1", done]]))

    expect(notify).toHaveBeenCalledTimes(1)
  })
})
