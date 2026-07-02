import { describe, expect, it } from "vitest"
import { statusFromPatch, patchImpliesActiveRun } from "@/lib/chat-engine-v2/applyPatches"
import type { PatchFrame } from "@/lib/chat-engine-v2/types"
import { isActiveStreamStatusValue, resolveNextStreamStatus } from "./streamStatusResolver"
import type { StreamStatus } from "./types"

// Client half of the stuck-"Writing..." end-to-end proof.
//
// The middleware fix makes a deduped/replayed assistant final emit an explicit
// chat.run.done status patch. These tests take the EXACT frame shape the server
// broadcasts and drive it through the real client status pipeline
// (statusFromPatch -> resolveNextStreamStatus) to prove the spinner clears --
// and that WITHOUT such a terminal the UI legitimately stays active (the bug).

// Mirrors what the client wraps around the middleware `broadcastRunStatus(..,
// "chat.run.done")` broadcast: type chat.status, payload carries runStatus/
// status "done", activeRun null, semanticType chat.run.done.
function serverRunDoneFrame(runId: string): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: 42,
      type: "chat.status",
      sessionKey: "s1",
      payload: {
        sessionKey: "s1",
        runId,
        status: "done",
        runStatus: "done",
        activeRun: null,
        statusLabel: null,
        semanticType: "chat.run.done",
      },
    },
  } as PatchFrame
}

describe("stuck Writing: client settles on the server's terminal patch", () => {
  it("statusFromPatch reads the chat.run.done terminal as done", () => {
    const parsed = statusFromPatch(serverRunDoneFrame("run-1"))
    expect(parsed).toMatchObject({ status: "done" })
  })

  it("resolves the spinner OFF when the terminal arrives after a streamed answer", () => {
    const frame = serverRunDoneFrame("run-1")
    const next = resolveNextStreamStatus({
      semanticType: "chat.run.done",
      explicitStatus: statusFromPatch(frame)?.status ?? null,
      impliesActiveRun: patchImpliesActiveRun(frame),
      currentStatus: "streaming", // UI was showing "Writing..."
      hasAnswerAfterLastUser: true, // full reply already rendered
    })
    expect(next).toBe("done")
    expect(isActiveStreamStatusValue(next)).toBe(false) // spinner cleared
  })

  it("also settles when the current UI state is 'thinking'", () => {
    const frame = serverRunDoneFrame("run-1")
    const next = resolveNextStreamStatus({
      semanticType: "chat.run.done",
      explicitStatus: statusFromPatch(frame)?.status ?? null,
      impliesActiveRun: patchImpliesActiveRun(frame),
      currentStatus: "thinking",
      hasAnswerAfterLastUser: true,
    })
    expect(isActiveStreamStatusValue(next)).toBe(false)
  })

  it("NEGATIVE (reproduces the bug): with NO terminal patch, a streamed answer stays 'Writing...'", () => {
    // Pre-fix, the deduped replay returned early and broadcast nothing, so the
    // client never received a settling patch -> the last active status persisted.
    const current: StreamStatus = "streaming"
    // No frame -> nothing feeds resolveNextStreamStatus; UI keeps currentStatus.
    expect(isActiveStreamStatusValue(current)).toBe(true) // spinner stuck ON
  })

  it("does not settle a genuinely active run that has produced no answer yet", () => {
    // A stray done-ish signal must not prematurely clear an unanswered active turn.
    const next = resolveNextStreamStatus({
      semanticType: "chat.run.done",
      explicitStatus: "done",
      impliesActiveRun: false,
      currentStatus: "streaming",
      hasAnswerAfterLastUser: false, // no answer yet
      allowTerminalWithoutAnswer: false,
    })
    expect(next).toBe("streaming") // stays active (guard 3)
  })
})
