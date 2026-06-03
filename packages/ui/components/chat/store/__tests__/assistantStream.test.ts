import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "../applyPatch";
import { runKey } from "../state";
import { historyRows, liveRows } from "../selectors";
import {
  CANONICAL_ASSISTANT_ID, RUN, assistantDelta, assistantFinal, resetCursor,
  runDone, runStatus, userConfirmed, userCreated,
} from "./fixtures";
import { base } from "./helpers";

beforeEach(() => resetCursor());

describe("applyPatch — assistant streaming -> final (same run row)", () => {
  it("streams cumulative text into one row and finalizes under the same key", () => {
    let s = base();
    s = applyPatch(s, userCreated("q")).state;
    s = applyPatch(s, userConfirmed("q", 1)).state;
    s = applyPatch(s, runStatus("thinking", "Thinking")).state;
    s = applyPatch(s, assistantDelta("Hel")).state;
    s = applyPatch(s, assistantDelta("Hello")).state;
    s = applyPatch(s, assistantDelta("Hello world")).state;

    const liveRow = s.rows.get(runKey(RUN))!;
    expect(liveRow.text).toBe("Hello world"); // cumulative SET, not appended
    expect(liveRow.finalized).toBe(false);
    expect(liveRows(s).some((r) => r.key === runKey(RUN))).toBe(true);

    s = applyPatch(s, assistantFinal("Hello world", 2)).state;
    const finalRow = s.rows.get(runKey(RUN))!;
    expect(finalRow.key).toBe(runKey(RUN)); // SAME key across delta->final
    expect(finalRow.messageId).toBe(CANONICAL_ASSISTANT_ID);
    expect(finalRow.text).toBe("Hello world");
    expect(finalRow.model).toBe("test-model");

    s = applyPatch(s, runDone()).state;
    const doneRow = s.rows.get(runKey(RUN))!;
    expect(doneRow.finalized).toBe(true);
    expect(s.activeRun).toBeNull(); // single owner cleared on terminal
    expect(historyRows(s).some((r) => r.key === runKey(RUN))).toBe(true);
    expect(liveRows(s).some((r) => r.key === runKey(RUN))).toBe(false);
  });
});
