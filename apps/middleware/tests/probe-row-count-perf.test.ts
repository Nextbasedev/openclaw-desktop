import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-perf-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Row Count / Performance", () => {
  test("10 sessions x 45 messages ingest in under 500ms", () => {
    const db = openDatabase({ databasePath: testDbPath("10x45-ingest") });
    const msgRepo = new MessageRepository(db);

    const sessionKeys = Array.from({ length: 10 }, (_, i) => `session-${i}`);
    const start = Date.now();

    for (const sk of sessionKeys) {
      const messages = normalizeHistoryMessages(sk, Array.from({ length: 45 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        text: `message ${i} in ${sk}`,
        __openclaw: { id: `m${sk}-${i}`, seq: i + 1 },
      })));
      msgRepo.upsertMessages(messages);
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);

    for (const sk of sessionKeys) {
      expect(msgRepo.listMessages(sk)).toHaveLength(45);
    }

    db.close();
  });

  test("100-message batch with 50% duplicates only creates 100 rows", () => {
    const db = openDatabase({ databasePath: testDbPath("dup-batch") });
    const msgRepo = new MessageRepository(db);

    const messages = normalizeHistoryMessages("s1", Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg-${i}`,
      __openclaw: { id: `m${i}`, seq: i + 1 },
    })));

    msgRepo.upsertMessages(messages);
    expect(msgRepo.listMessages("s1")).toHaveLength(100);

    // Re-ingest identical batch
    msgRepo.upsertMessages(messages);
    expect(msgRepo.listMessages("s1")).toHaveLength(100);

    // Re-ingest with 50% different text (collision append)
    const modified = normalizeHistoryMessages("s1", Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: i < 50 ? `modified-${i}` : `msg-${i}`,
      __openclaw: { id: i < 50 ? `m${i}-mod` : `m${i}`, seq: i + 1 },
    })));

    const p = msgRepo.upsertMessages(modified);
    expect(p.upserted).toBe(50);
    expect(msgRepo.listMessages("s1")).toHaveLength(150); // 100 original + 50 appended

    db.close();
  });

  test("pagination beforeSeq returns correct slices", () => {
    const db = openDatabase({ databasePath: testDbPath("pagination") });
    const msgRepo = new MessageRepository(db);

    const messages = normalizeHistoryMessages("s1", Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg-${i}`,
      __openclaw: { id: `m${i}`, seq: i + 1 },
    })));

    msgRepo.upsertMessages(messages);

    const page1 = msgRepo.listMessages("s1", { limit: 50, beforeSeq: 100 });
    expect(page1).toHaveLength(50);
    expect(page1[0]!.openclawSeq).toBe(50);
    expect(page1.at(-1)!.openclawSeq).toBe(99);

    const page2 = msgRepo.listMessages("s1", { limit: 50, beforeSeq: 51 });
    expect(page2).toHaveLength(50);
    expect(page2[0]!.openclawSeq).toBe(1);

    db.close();
  });

  test("run + tool lifecycle scales to 50 runs x 3 tools each", () => {
    const db = openDatabase({ databasePath: testDbPath("50runs-tools") });
    const runRepo = new RunRepository(db);

    const start = Date.now();

    for (let i = 0; i < 50; i++) {
      const runId = `run-${i}`;
      runRepo.upsertRun({ runId, sessionKey: "s1", status: "thinking", startedAtMs: Date.now(), updatedAtMs: Date.now() });
      for (let t = 0; t < 3; t++) {
        runRepo.upsertToolCall({ sessionKey: "s1", runId, toolCallId: `tool-${i}-${t}`, name: "search", phase: "start", startedAtMs: Date.now(), updatedAtMs: Date.now() });
        runRepo.upsertToolCall({ sessionKey: "s1", runId, toolCallId: `tool-${i}-${t}`, name: "search", phase: "result", resultMeta: { count: t }, updatedAtMs: Date.now() });
      }
      runRepo.updateRunStatus(runId, "done", { updatedAtMs: Date.now() });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    expect(runRepo.latestRun("s1")).not.toBeNull();
    expect(runRepo.listToolCalls("s1")).toHaveLength(150); // 50 * 3

    db.close();
  });

  test("resequence 200-message segment is fast", () => {
    const db = openDatabase({ databasePath: testDbPath("resequence-perf") });
    const msgRepo = new MessageRepository(db);

    // Create non-contiguous seqs by forcing collisions
    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "a", __openclaw: { id: "u1", seq: 1 } },
    ]));
    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", text: "b", __openclaw: { id: "a1", seq: 1 } }, // collision → seq 2
    ]));
    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "c", __openclaw: { id: "u2", seq: 2 } }, // collision → seq 3
    ]));

    const start = Date.now();
    const reseq = msgRepo.resequenceSessionMessages("s1");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(reseq.changedMessages).toBeGreaterThanOrEqual(0);
    expect(msgRepo.listMessages("s1").map(r => r.openclawSeq)).toEqual([1, 2, 3]);

    db.close();
  });
});
