import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-stable-ids-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Stable IDs across upserts and resequence", () => {
  test("messageId survives repeated upserts of identical payload", () => {
    const db = openDatabase({ databasePath: testDbPath("id-survive") });
    const msgRepo = new MessageRepository(db);

    const base = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { id: "stable-id", seq: 1 } },
    ]);

    msgRepo.upsertMessages(base);
    expect(msgRepo.listMessages("s1")[0]?.messageId).toBe("stable-id");

    msgRepo.upsertMessages(base);
    expect(msgRepo.listMessages("s1")[0]?.messageId).toBe("stable-id");

    msgRepo.upsertMessages(base);
    expect(msgRepo.listMessages("s1")).toHaveLength(1);
    expect(msgRepo.listMessages("s1")[0]?.messageId).toBe("stable-id");

    db.close();
  });

  test("gatewayId linkage survives after confirmOptimisticUser", () => {
    const db = openDatabase({ databasePath: testDbPath("gateway-id-link") });
    const msgRepo = new MessageRepository(db);

    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hello", __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: 100,
    });

    const [gateway] = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { id: "gateway-user-1", seq: 7 } },
    ]);
    const confirmed = msgRepo.confirmOptimisticUser("s1", "client-1", gateway!);

    expect(confirmed?.data?.__openclaw?.gatewayId).toBe("gateway-user-1");
    expect(confirmed?.data?.__openclaw?.id).toBe("client-1"); // canonical id preserved

    db.close();
  });

  test("runId is stable across status transitions", () => {
    const db = openDatabase({ databasePath: testDbPath("run-id-stable") });
    const runRepo = new RunRepository(db);

    runRepo.upsertRun({ runId: "run:stable", sessionKey: "s1", clientMessageId: "client-1", idempotencyKey: "idem-1", status: "thinking", startedAtMs: 100, updatedAtMs: 100 });
    runRepo.upsertRun({ runId: "run:stable", sessionKey: "s1", gatewayRunId: "gateway-run-1", status: "streaming", updatedAtMs: 200 });
    runRepo.updateRunStatus("run:stable", "done", { updatedAtMs: 300 });

    const run = runRepo.getRun("run:stable");
    expect(run?.runId).toBe("run:stable");
    expect(run?.clientMessageId).toBe("client-1");
    expect(run?.idempotencyKey).toBe("idem-1");
    expect(run?.gatewayRunId).toBe("gateway-run-1");

    db.close();
  });

  test("toolCallId is primary key across phase changes", () => {
    const db = openDatabase({ databasePath: testDbPath("tool-id-stable") });
    const runRepo = new RunRepository(db);

    runRepo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking" });
    runRepo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-abc", name: "search", phase: "start", startedAtMs: 100, updatedAtMs: 100 });
    runRepo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-abc", name: "search", phase: "result", resultMeta: { count: 3 }, updatedAtMs: 200 });

    const tools = runRepo.listToolCalls("s1", "r1");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.toolCallId).toBe("tool-abc");
    expect(tools[0]?.status).toBe("success");

    db.close();
  });

  test("findMessageById returns correct row after live message replacement", () => {
    const db = openDatabase({ databasePath: testDbPath("find-by-id") });
    const msgRepo = new MessageRepository(db);

    msgRepo.upsertMessages([{
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "msg-1",
      role: "user",
      data: { id: "msg-1", role: "user", text: "hello" },
      updatedAtMs: 100,
    }]);

    const found = msgRepo.findMessageById("s1", "msg-1");
    expect(found?.messageId).toBe("msg-1");
    expect(found?.data.text).toBe("hello");

    msgRepo.deleteMessageById("s1", "msg-1");
    expect(msgRepo.findMessageById("s1", "msg-1")).toBeNull();

    db.close();
  });
});
