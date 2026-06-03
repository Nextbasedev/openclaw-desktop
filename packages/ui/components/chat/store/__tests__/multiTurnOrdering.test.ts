import { beforeEach, describe, expect, it } from "vitest";
import { assistantDelta, assistantFinal, patch, resetCursor, runDone, runStatus, userConfirmed, userCreated } from "./fixtures";
import { orderedRows } from "../selectors";
import { replay } from "./helpers";

beforeEach(() => resetCursor());

/** Turn 2's optimistic user echo on a fresh run (different ids from fixtures). */
const turn2UserCreated = (text: string) =>
  patch(
    "chat.user.created",
    {
      runId: "run-2",
      clientMessageId: "client:idem-2",
      idempotencyKey: "idem-2",
      messageId: "client:idem-2",
      optimistic: true,
      message: {
        role: "user",
        text,
        isOptimistic: true,
        __openclaw: { id: "client:idem-2", clientMessageId: "client:idem-2", idempotencyKey: "idem-2", runId: "run-2" },
      },
    },
    "chat.message.upsert",
  );

describe("applyPatch — multi-turn ordering (server seq high-water mark)", () => {
  it("keeps a second-turn optimistic user message BELOW the first-turn assistant reply", () => {
    // Turn 1 finalizes with LARGE server seqs (openclawSeq is a global monotonic counter,
    // not 1/2). Turn 2's optimistic row must still sort after it.
    const s = replay([
      userCreated("hii"),
      runStatus("thinking", "Thinking"),
      userConfirmed("hii", 5001),
      assistantDelta("Hey Dixit"),
      assistantFinal("Hey Dixit, how can I help?", 5002),
      runDone(),
      // Turn 2 starts: optimistic echo only (not yet confirmed) — the screenshot state.
      turn2UserCreated("do some tool call"),
    ]);

    const texts = orderedRows(s).map((r) => r.text);
    expect(texts).toEqual(["hii", "Hey Dixit, how can I help?", "do some tool call"]);
  });

  it("advances maxSeq to the largest server seq seen", () => {
    const s = replay([
      userCreated("hii"),
      userConfirmed("hii", 5001),
      assistantFinal("hello", 5002),
      runDone(),
    ]);
    expect(s.maxSeq).toBeGreaterThanOrEqual(5002);
  });
});
