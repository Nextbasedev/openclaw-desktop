import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "../applyPatch";
import { applyBootstrap } from "../applyBootstrap";
import { historyRows, liveRows, orderedRows } from "../selectors";
import { CANONICAL_USER_ID, RUN, SESSION, resetCursor, userCreated } from "./fixtures";

beforeEach(() => resetCursor());

describe("applyBootstrap", () => {
  it("rebuilds state from a snapshot and keeps active run in the live tail", () => {
    const s = applyBootstrap({
      ok: true,
      sessionKey: SESSION,
      sessionId: "sess-1",
      runStatus: "streaming",
      statusLabel: "Streaming",
      activeRun: { runId: RUN, status: "streaming", statusLabel: "Streaming", startedAtMs: 1 },
      hasOlder: true,
      knownTotalMessages: 42,
      oldestLoadedSeq: 10,
      messageCount: 2,
      cursor: 100,
      tools: [],
      toolCalls: [],
      messages: [
        { role: "user", text: "hi", messageId: CANONICAL_USER_ID, __openclaw: { id: CANONICAL_USER_ID, seq: 10 } },
        { role: "assistant", text: "streaming...", __openclaw: { id: `live:${RUN}:assistant`, seq: 11, runId: RUN } },
      ],
    });
    expect(s.cursor).toBe(100);
    expect(s.status).toBe("streaming");
    expect(s.pagination.hasOlder).toBe(true);
    expect(s.pagination.knownTotalMessages).toBe(42);
    expect(s.pagination.oldestLoadedSeq).toBe(10);
    expect(orderedRows(s)).toHaveLength(2);
    expect(liveRows(s).map((r) => r.runId)).toContain(RUN);
    expect(historyRows(s).some((r) => r.kind === "user")).toBe(true);
  });

  it("applies live patches after bootstrap with correct cursor guard", () => {
    const s = applyBootstrap({
      ok: true, sessionKey: SESSION, sessionId: null, runStatus: "idle", statusLabel: null, activeRun: null,
      hasOlder: false, knownTotalMessages: 0, oldestLoadedSeq: null, messageCount: 0, cursor: 5,
      tools: [], toolCalls: [], messages: [],
    });
    resetCursor();
    const stale = applyPatch(s, { ...userCreated("x"), cursor: 5 });
    expect(stale.ignored).toBe(true);
    const next = applyPatch(s, { ...userCreated("y"), cursor: 6 });
    expect(next.ignored).toBe(false);
    expect(next.state.cursor).toBe(6);
  });
});
