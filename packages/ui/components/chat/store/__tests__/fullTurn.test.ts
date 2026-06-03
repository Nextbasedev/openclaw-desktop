import { beforeEach, describe, expect, it } from "vitest";
import { applyPatches } from "../applyPatch";
import { TOOL_ID, assistantDelta, assistantFinal, patch, reasoningDelta, resetCursor, runDone, runStatus, toolResult, toolStarted, userConfirmed, userCreated } from "./fixtures";
import { historyRows, liveRows, orderedRows } from "../selectors";
import { replay } from "./helpers";
import type { ChatPatch } from "../../sync/types.contract";

beforeEach(() => resetCursor());

const fullTurn = (): ChatPatch[] => [
  userCreated("what's 2+2?"),
  runStatus("thinking", "Thinking"),
  userConfirmed("what's 2+2?", 1),
  reasoningDelta("Let me compute"),
  toolStarted("calc"),
  toolResult("calc", "4"),
  assistantDelta("The answer"),
  assistantDelta("The answer is 4"),
  assistantFinal("The answer is 4", 2),
  runDone(),
];

describe("applyPatch — full turn transcript", () => {
  it("produces a clean 2-row transcript in order", () => {
    const s = replay(fullTurn());
    const rows = orderedRows(s);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("user");
    expect(rows[0].text).toBe("what's 2+2?");
    expect(rows[1].kind).toBe("assistant");
    expect(rows[1].text).toBe("The answer is 4");
    expect(rows[1].reasoning).toBe("Let me compute");
    expect(rows[1].toolCallIds).toEqual([TOOL_ID]);
    expect(rows[0].seq).toBeLessThan(rows[1].seq);
    expect(s.activeRun).toBeNull();
    expect(historyRows(s)).toHaveLength(2);
    expect(liveRows(s)).toHaveLength(0);
  });

  it("is idempotent: replaying the same patches yields the same transcript", () => {
    const patches = fullTurn();
    const once = replay(patches);
    const twice = applyPatches(once, patches).state;
    expect(orderedRows(twice)).toHaveLength(2);
    expect(twice.cursor).toBe(once.cursor);
    expect(orderedRows(twice).map((r) => [r.key, r.text])).toEqual(
      orderedRows(once).map((r) => [r.key, r.text]),
    );
  });

  it("duplicate user text does NOT collapse rows (the v4 bug)", () => {
    resetCursor();
    const s = replay([
      userCreated("ping"),
      userConfirmed("ping", 1),
      runStatus("thinking", "Thinking"),
      assistantFinal("pong", 2),
      runDone(),
      patch("chat.user.created", {
        runId: "run-2", clientMessageId: "client:idem-2", idempotencyKey: "idem-2", messageId: "client:idem-2",
        optimistic: true,
        message: { role: "user", text: "ping", isOptimistic: true, __openclaw: { id: "client:idem-2", clientMessageId: "client:idem-2", runId: "run-2" } },
      }, "chat.message.upsert"),
    ]);
    const users = orderedRows(s).filter((r) => r.kind === "user");
    expect(users).toHaveLength(2); // identical text, two distinct rows
  });
});
