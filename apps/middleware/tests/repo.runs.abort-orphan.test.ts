import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-abort-orphan-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

// Regression: after a user aborts, every reply that follows renders fully but
// the UI stays stuck on "Writing...". Root cause: the abort only terminalized
// ONE run, so an abort<->send race left a second run permanently 'pending'. That
// orphan (the OLDEST pending run) then hijacked the terminal `chat.run.done` of
// every FUTURE run via findOldestPendingRun — so later runs never settled.
describe("RunRepository.abortPendingRuns — no orphaned pending run after abort", () => {
  test("terminalizes ALL pending runs on abort, so findOldestPendingRun is clean for the next run", () => {
    const db = openDatabase({ databasePath: testDbPath("sweep") });
    const runs = new RunRepository(db);
    const sessionKey = "s1";

    // run1 is streaming; a racing send created run2 before the abort landed.
    runs.upsertRun({ runId: "run1", sessionKey, status: "streaming", startedAtMs: 1000 });
    runs.upsertRun({ runId: "run2", sessionKey, status: "thinking", startedAtMs: 2000 });

    // Abort targets the LATEST pending run (run2) — the pre-fix behaviour that
    // left run1 pending forever.
    const target = runs.findLatestPendingRun(sessionKey);
    expect(target?.runId).toBe("run2");
    runs.updateRunStatus(target!.runId, "aborted", { statusLabel: null });

    // Fix: sweep the rest. run1 must be terminalized too.
    const alsoAborted = runs.abortPendingRuns(sessionKey, target!.runId);
    expect(alsoAborted).toEqual(["run1"]);

    // No pending run remains to poison future correlation.
    expect(runs.findOldestPendingRun(sessionKey)).toBeNull();
    expect(runs.getRun("run1")?.status).toBe("aborted");
    expect(runs.getRun("run2")?.status).toBe("aborted");

    // A brand-new run now correlates to itself, not to a stale orphan.
    runs.upsertRun({ runId: "run3", sessionKey, status: "thinking", startedAtMs: 3000 });
    expect(runs.findOldestPendingRun(sessionKey)?.runId).toBe("run3");
  });

  test("does not touch runs in other sessions and never re-opens a terminal run", () => {
    const db = openDatabase({ databasePath: testDbPath("scope") });
    const runs = new RunRepository(db);

    runs.upsertRun({ runId: "a1", sessionKey: "sA", status: "streaming", startedAtMs: 1000 });
    runs.upsertRun({ runId: "b1", sessionKey: "sB", status: "streaming", startedAtMs: 1000 });
    runs.upsertRun({ runId: "a-done", sessionKey: "sA", status: "done", startedAtMs: 500 });

    const aborted = runs.abortPendingRuns("sA");
    expect(aborted).toEqual(["a1"]);
    // Other session untouched.
    expect(runs.getRun("b1")?.status).toBe("streaming");
    // Already-terminal run is left as-is.
    expect(runs.getRun("a-done")?.status).toBe("done");
  });
});
