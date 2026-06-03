import { beforeEach, describe, expect, it } from "vitest";
import { applyBootstrap } from "../applyBootstrap";
import { applyOlderMessages, type OlderMessage } from "../applyOlder";
import { historyRows, orderedRows } from "../selectors";
import { SESSION, resetCursor } from "./fixtures";

beforeEach(() => resetCursor());

function older(seq: number, text: string): OlderMessage {
  return { data: { role: "user", text }, openclawSeq: seq, messageId: `m-${seq}`, role: "user" };
}

function bootstrapWith(seq: number) {
  return applyBootstrap({
    ok: true, sessionKey: SESSION, sessionId: null, runStatus: "idle", statusLabel: null, activeRun: null,
    hasOlder: true, knownTotalMessages: 50, oldestLoadedSeq: seq, messageCount: 1, cursor: 5, tools: [], toolCalls: [],
    messages: [{ role: "user", text: "newest", messageId: `m-${seq}`, __openclaw: { id: `m-${seq}`, seq } }],
  });
}

describe("applyOlderMessages", () => {
  it("prepends older messages and updates pagination", () => {
    const s0 = bootstrapWith(10);
    const s1 = applyOlderMessages(s0, [older(7, "a"), older(8, "b"), older(9, "c")]);
    const rows = orderedRows(s1);
    expect(rows.map((r) => r.seq)).toEqual([7, 8, 9, 10]); // sorted, prepended
    expect(s1.pagination.oldestLoadedSeq).toBe(7);
    expect(s1.pagination.loadingOlder).toBe(false);
    expect(historyRows(s1)).toHaveLength(4);
  });

  it("is idempotent — already-loaded messages are skipped", () => {
    const s0 = bootstrapWith(10);
    const page = [older(8, "b"), older(9, "c")];
    const s1 = applyOlderMessages(s0, page);
    const s2 = applyOlderMessages(s1, page);
    expect(orderedRows(s2).map((r) => r.seq)).toEqual([8, 9, 10]);
  });

  it("clears hasOlder when all known messages are loaded", () => {
    const s0 = applyBootstrap({
      ok: true, sessionKey: SESSION, sessionId: null, runStatus: "idle", statusLabel: null, activeRun: null,
      hasOlder: true, knownTotalMessages: 3, oldestLoadedSeq: 3, messageCount: 1, cursor: 1, tools: [], toolCalls: [],
      messages: [{ role: "user", text: "c", messageId: "m-3", __openclaw: { id: "m-3", seq: 3 } }],
    });
    const s1 = applyOlderMessages(s0, [older(1, "a"), older(2, "b")]);
    expect(s1.pagination.hasOlder).toBe(false);
  });
});
