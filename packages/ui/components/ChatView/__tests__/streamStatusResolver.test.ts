import { describe, expect, test } from "vitest"
import { resolveNextStreamStatus } from "../streamStatusResolver"

const base = {
  semanticType: null as string | null,
  explicitStatus: null,
  impliesActiveRun: false,
  currentStatus: "thinking" as const,
  hasAnswerAfterLastUser: false,
}

describe("resolveNextStreamStatus", () => {
  test("settles to idle when the assistant final lands but the done signal was lost", () => {
    // Reproduces the reported bug: a completed answer keeps showing "Writing…"
    // because chat.run.done never arrived. The final message + an answer present
    // must settle the run.
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.assistant.final",
        currentStatus: "streaming",
        hasAnswerAfterLastUser: true,
      }),
    ).toBe("idle")
  })

  test("does NOT resurrect Writing… from a late patch once the turn is answered", () => {
    // A late background/tool/duplicate message patch implies an active run, but
    // the turn already has an answer — it must not flip back to thinking.
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.message.upsert",
        impliesActiveRun: true,
        currentStatus: "idle",
        hasAnswerAfterLastUser: true,
      }),
    ).toBe("idle")
  })

  test("a genuine new send (optimistic user, no answer yet) DOES activate", () => {
    // New turn: fresh optimistic user row makes hasAnswerAfterLastUser=false, so
    // real sends still show thinking. No over-broadening.
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.user.created",
        impliesActiveRun: true,
        currentStatus: "idle",
        hasAnswerAfterLastUser: false,
      }),
    ).toBe("thinking")
  })

  test("still shows active tool/stream state before the first answer arrives", () => {
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.assistant.delta",
        explicitStatus: "streaming",
        currentStatus: "thinking",
        hasAnswerAfterLastUser: false,
      }),
    ).toBe("streaming")
  })

  test("respects an explicit terminal status once answered", () => {
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.run.done",
        explicitStatus: "done",
        currentStatus: "streaming",
        hasAnswerAfterLastUser: true,
      }),
    ).toBe("done")
  })

  test("suppresses a premature terminal status while the turn is still unanswered", () => {
    // Existing guard preserved: don't flash 'done' before the answer lands.
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.run.done",
        explicitStatus: "done",
        currentStatus: "thinking",
        hasAnswerAfterLastUser: false,
      }),
    ).toBe("thinking")
  })

  test("allows terminal slash command acks without an assistant answer", () => {
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.run.done",
        explicitStatus: "done",
        currentStatus: "thinking",
        hasAnswerAfterLastUser: false,
        allowTerminalWithoutAnswer: true,
      }),
    ).toBe("done")
  })

  test("does not settle on final if the patch itself is still active", () => {
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.assistant.final",
        explicitStatus: "tool_running",
        currentStatus: "streaming",
        hasAnswerAfterLastUser: true,
      }),
    ).toBe("tool_running")
  })

  test("keeps current status when a patch carries nothing actionable", () => {
    expect(
      resolveNextStreamStatus({
        ...base,
        semanticType: "chat.message.upsert",
        currentStatus: "streaming",
        hasAnswerAfterLastUser: false,
      }),
    ).toBe("streaming")
  })
})
