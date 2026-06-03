import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "../applyPatch";
import { runKey } from "../state";
import { toolsForRow } from "../selectors";
import { RUN, TOOL_ID, resetCursor, runStatus, toolResult, toolStarted } from "./fixtures";
import { base } from "./helpers";

beforeEach(() => resetCursor());

describe("applyPatch — tools attach to the run row", () => {
  it("links tool calls to the assistant run row in order", () => {
    let s = base();
    s = applyPatch(s, runStatus("thinking", "Thinking")).state;
    s = applyPatch(s, toolStarted("bash")).state;
    s = applyPatch(s, toolResult("bash", "ok")).state;

    const row = s.rows.get(runKey(RUN))!;
    expect(row.toolCallIds).toEqual([TOOL_ID]); // no duplicate across started+result
    const tools = toolsForRow(s, row);
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe("success");
    expect(tools[0].output).toBe("ok");
  });
});

describe("applyPatch — run status single owner", () => {
  it("never leaves activeRun set after a terminal run", () => {
    let s = base();
    s = applyPatch(s, runStatus("thinking", "Thinking")).state;
    expect(s.activeRun?.status).toBe("thinking");
    s = applyPatch(s, runStatus("streaming", "Streaming", "chat.run.streaming")).state;
    expect(s.activeRun?.status).toBe("streaming");
    s = applyPatch(s, runStatus("error", null, "chat.run.error")).state;
    expect(s.activeRun).toBeNull();
    expect(s.status).toBe("error");
  });
});
