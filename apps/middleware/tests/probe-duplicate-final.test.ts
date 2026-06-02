import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { canonicalPatchPayload } from "../src/features/chat/projection.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-duplicate-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Duplicate Final Detection", () => {
  test("duplicate assistant final with same messageId is idempotent (single row)", () => {
    const db = openDatabase({ databasePath: testDbPath("dup-final-id") });
    const msgRepo = new MessageRepository(db);

    const first = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "final answer", __openclaw: { id: "a1", seq: 1 } },
    ]);
    const p1 = msgRepo.upsertMessages(first);
    expect(p1.upserted).toBe(1);

    const duplicate = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "final answer", __openclaw: { id: "a1", seq: 1 } },
    ]);
    const p2 = msgRepo.upsertMessages(duplicate);
    expect(p2.upserted).toBe(0); // no change

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBe("a1");

    db.close();
  });

  test("duplicate assistant final with DIFFERENT text at same seq collides and appends", () => {
    const db = openDatabase({ databasePath: testDbPath("dup-final-diff-text") });
    const msgRepo = new MessageRepository(db);

    const first = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "first version", __openclaw: { id: "a1", seq: 1 } },
    ]);
    msgRepo.upsertMessages(first);

    const second = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "second version", __openclaw: { id: "a2", seq: 1 } },
    ]);
    const p2 = msgRepo.upsertMessages(second);
    expect(p2.upserted).toBe(1);

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(2);

    db.close();
  });

  test("confirmed optimistic user + gateway echo with different id = 1 row", () => {
    const db = openDatabase({ databasePath: testDbPath("optimistic-echo") });
    const msgRepo = new MessageRepository(db);

    // Client sends optimistic user message
    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hello", __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: 100,
    });

    // Gateway echoes with different messageId, same text
    const [gateway] = normalizeHistoryMessages("s1", [
      { role: "user", text: "> prior\n\nhello", __openclaw: { id: "gateway-user-1", seq: 7 } },
    ]);
    const confirmed = msgRepo.confirmOptimisticUser("s1", "client-1", gateway!);

    expect(confirmed).toMatchObject({
      messageId: "client-1",
      openclawSeq: 1,
      data: { __clientOptimistic: false, __openclaw: { id: "client-1", gatewayId: "gateway-user-1", gatewaySeq: 7 } },
    });

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(1);

    db.close();
  });

  test("live assistant row is replaced by final assistant message with runId", () => {
    const db = openDatabase({ databasePath: testDbPath("live-replace") });
    const msgRepo = new MessageRepository(db);
    const runRepo = new RunRepository(db);

    runRepo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking", startedAtMs: 100, updatedAtMs: 100 });

    // Live streaming assistant text
    msgRepo.upsertMessages([{
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "live:r1:assistant",
      role: "assistant",
      data: { id: "live:r1:assistant", role: "assistant", text: "partial", __openclaw: { id: "live:r1:assistant", runId: "r1" } },
      updatedAtMs: 100,
    }]);

    // Final assistant message arrives
    const final = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "final answer", __openclaw: { id: "a1", seq: 1, runId: "r1" } },
    ]);

    // Simulate what ChatLiveIngest does: delete live, project final
    msgRepo.deleteMessageById("s1", "live:r1:assistant");
    const p = msgRepo.upsertMessages(final);
    expect(p.upserted).toBe(1);

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBe("a1");
    expect(rows[0]?.data.text).toBe("final answer");

    db.close();
  });

  test("10x batch duplicate ingestion yields stable row count", () => {
    const db = openDatabase({ databasePath: testDbPath("batch-dup") });
    const msgRepo = new MessageRepository(db);

    // 10 user messages
    const batch = normalizeHistoryMessages("s1", Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      text: `question ${i}`,
      __openclaw: { id: `u${i}`, seq: i + 1 },
    })));

    // First ingestion
    msgRepo.upsertMessages(batch);
    expect(msgRepo.listMessages("s1")).toHaveLength(10);

    // Second ingestion of identical batch
    msgRepo.upsertMessages(batch);
    expect(msgRepo.listMessages("s1")).toHaveLength(10);

    // Third ingestion with slightly different text for first 5
    const modified = normalizeHistoryMessages("s1", Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      text: i < 5 ? `modified ${i}` : `question ${i}`,
      __openclaw: { id: i < 5 ? `u${i}-mod` : `u${i}`, seq: i + 1 },
    })));
    const p3 = msgRepo.upsertMessages(modified);
    expect(p3.upserted).toBe(5);
    expect(msgRepo.listMessages("s1")).toHaveLength(15); // 5 originals + 5 modified (collision appended) + 5 unchanged

    db.close();
  });
});
