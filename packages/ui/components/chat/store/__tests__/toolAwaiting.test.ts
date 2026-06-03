import { beforeEach, describe, expect, it } from "vitest";
import { RUN, SESSION, TOOL_ID, patch, resetCursor, toolStarted } from "./fixtures";
import { replay } from "./helpers";

beforeEach(() => resetCursor());

const toolCall = (over: Record<string, unknown>) => ({
  toolCallId: TOOL_ID, id: TOOL_ID, sessionKey: SESSION, runId: RUN, messageId: null,
  name: "session_status", phase: "result" as const, status: "success" as const, ...over,
});

/** status=success while the live result is still a stripped placeholder. */
const awaitingPatch = () =>
  patch("chat.tool.update", {
    runId: RUN, toolCallId: TOOL_ID, phase: "result",
    toolCall: toolCall({ resultMeta: { awaitingResult: true, source: "gateway_stripped_live_result" }, awaitingResult: true, updatedAtMs: 11 }),
  });

/** Real result backfilled in. */
const realResultPatch = () =>
  patch("chat.tool.result", {
    runId: RUN, toolCallId: TOOL_ID, phase: "result",
    toolCall: toolCall({ resultMeta: { text: "OCPlatform running on gpt-5.5" }, updatedAtMs: 22 }),
  });

describe("tool awaitingResult flag", () => {
  it("is true while the result is an awaiting placeholder", () => {
    const s = replay([toolStarted("session_status"), awaitingPatch()]);
    expect(s.tools.get(TOOL_ID)?.awaitingResult).toBe(true);
  });

  it("clears once the real result lands (no stale 'waiting for result')", () => {
    const s = replay([toolStarted("session_status"), awaitingPatch(), realResultPatch()]);
    const tool = s.tools.get(TOOL_ID);
    expect(tool?.awaitingResult).toBe(false);
    expect(tool?.status).toBe("success");
    expect(tool?.resultMeta).toEqual({ text: "OCPlatform running on gpt-5.5" });
  });
});
