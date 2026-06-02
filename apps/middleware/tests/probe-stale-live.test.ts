import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-stale-live-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Stale Live Rows", () => {
  test("live assistant row is deleted when final assistant arrives", () => {
    const db = openDatabase({ databasePath: testDbPath("live-cleanup") });
    const msgRepo = new MessageRepository(db);

    msgRepo.upsertMessages([{
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "live:r1:assistant",
      role: "assistant",
      data: { id: "live:r1:assistant", role: "assistant", text: "partial...", __openclaw: { id: "live:r1:assistant", runId: "r1" } },
      updatedAtMs: 100,
    }]);

    expect(msgRepo.listMessages("s1")).toHaveLength(1);

    msgRepo.deleteMessageById("s1", "live:r1:assistant");

    expect(msgRepo.listMessages("s1")).toHaveLength(0);
    expect(msgRepo.findMessageById("s1", "live:r1:assistant")).toBeNull();

    db.close();
  });

  test("orphaned live rows do not survive session bootstrap", () => {
    const db = openDatabase({ databasePath: testDbPath("orphan-live") });
    const msgRepo = new MessageRepository(db);
    const runRepo = new RunRepository(db);

    // Simulate: run completed, but live row was never cleaned up
    runRepo.upsertRun({ runId: "r1", sessionKey: "s1", status: "done", startedAtMs: 100, updatedAtMs: 200, finishedAtMs: 200 });

    msgRepo.upsertMessages([{
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "live:r1:assistant",
      role: "assistant",
      data: { id: "live:r1:assistant", role: "assistant", text: "partial", __openclaw: { id: "live:r1:assistant", runId: "r1" } },
      updatedAtMs: 100,
    }]);

    // Final arrives and replaces
    msgRepo.deleteMessageById("s1", "live:r1:assistant");
    const final = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "final", __openclaw: { id: "a1", seq: 1, runId: "r1" } },
    ]);
    msgRepo.upsertMessages(final);

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBe("a1");
    expect(rows.some(r => r.messageId === "live:r1:assistant")).toBe(false);

    db.close();
  });

  test("finalizeStaleActivity marks old running runs and tools as done", () => {
    const db = openDatabase({ databasePath: testDbPath("stale-finalize") });
    const runRepo = new RunRepository(db);

    runRepo.upsertRun({ runId: "old-run", sessionKey: "s1", status: "tool_running", startedAtMs: 1_000, updatedAtMs: 1_000 });
    runRepo.upsertToolCall({ sessionKey: "s1", runId: "old-run", toolCallId: "old-tool", name: "read", phase: "start", startedAtMs: 1_000, updatedAtMs: 1_000 });

    const result = runRepo.finalizeStaleActivity({ nowMs: 10_000, activeRunMs: 1_000, runningToolMs: 1_000 });

    expect(result).toMatchObject({ runsFinalized: 1, toolsFinalized: 1 });
    expect(runRepo.latestRun("s1")).toMatchObject({ status: "done", finishedAtMs: 10_000 });
    expect(runRepo.listToolCalls("s1", "old-run")).toEqual([
      expect.objectContaining({ toolCallId: "old-tool", status: "success", phase: "result", finishedAtMs: 10_000 }),
    ]);

    db.close();
  });

  test("live assistant text map does not leak across runs (simulated)", () => {
    const db = openDatabase({ databasePath: testDbPath("live-text-leak") });
    const msgRepo = new MessageRepository(db);

    // Simulate two separate runs both writing to the same session
    for (const runId of ["r1", "r2"]) {
      msgRepo.upsertMessages([{
        sessionKey: "s1",
        openclawSeq: runId === "r1" ? 1 : 2,
        messageId: `live:${runId}:assistant`,
        role: "assistant",
        data: { id: `live:${runId}:assistant`, role: "assistant", text: `partial-${runId}`, __openclaw: { id: `live:${runId}:assistant`, runId } },
        updatedAtMs: 100,
      }]);
    }

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.messageId).toBe("live:r1:assistant");
    expect(rows[1]?.messageId).toBe("live:r2:assistant");

    // Clean up r1
    msgRepo.deleteMessageById("s1", "live:r1:assistant");
    expect(msgRepo.listMessages("s1")).toHaveLength(1);
    expect(msgRepo.listMessages("s1")[0]?.messageId).toBe("live:r2:assistant");

    db.close();
  });

  test("backfill history deduplication drops stale gateway echo of confirmed user", () => {
    const db = openDatabase({ databasePath: testDbPath("backfill-dedup") });
    const msgRepo = new MessageRepository(db);

    // Optimistic user confirmed at seq 1
    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hello", __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: 100,
    });

    const [gateway] = normalizeHistoryMessages("s1", [
      { role: "user", text: "> prior\n\nhello", __openclaw: { id: "gateway-user-1", seq: 7 } },
    ]);
    const confirmed = msgRepo.confirmOptimisticUser("s1", "client-1", gateway!);
    expect(confirmed?.messageId).toBe("client-1");

    // Later backfill replays same text with stripped id (no runId, no idempotency)
    const backfillEcho = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { seq: 7 } },
    ]);
    const p = msgRepo.upsertMessages(backfillEcho);

    // ⚠️ FINDING: This creates a SECOND row at seq 8 because the backfill
    // echo has no gatewayId and no idempotencyKey, so it can't be matched
    // to the confirmed optimistic user. This is the same root cause as the
    // failing test in send.test.ts. The live ingest path guards this via
    // recentlyConfirmedUsers, but the backfill/upsert path does not.
    expect(msgRepo.listMessages("s1")).toHaveLength(2); // BUG: should be 1
    expect(p.upserted).toBe(1); // BUG: should be 0

    db.close();
  });
});
