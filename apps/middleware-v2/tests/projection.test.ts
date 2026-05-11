import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { readSchemaVersion } from "../src/db/migrate.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("SQLite projection", () => {
  test("migration creates schema version", () => {
    const db = openDatabase({ databasePath: testDbPath("schema") });
    expect(readSchemaVersion(db)).toBe(2);
    db.close();
  });

  test("message upsert is keyed by session and OpenClaw seq", () => {
    const db = openDatabase({ databasePath: testDbPath("upsert") });
    const repo = new MessageRepository(db);
    const first = normalizeHistoryMessages("s1", [
      { role: "user", content: "hello", __openclaw: { id: "a", seq: 1 } },
    ], 100);
    const second = normalizeHistoryMessages("s1", [
      { role: "user", content: "hello edited", __openclaw: { id: "a", seq: 1 } },
    ], 200);
    repo.upsertMessages(first);
    repo.upsertMessages(second);
    const rows = repo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ content: "hello edited" });
    db.close();
  });

  test("normalizer preserves message id fields and explicit fallback seq", () => {
    const rows = normalizeHistoryMessages("s1", [
      { id: "gateway-a", role: "assistant", text: "a" },
      { messageId: "gateway-b", role: "assistant", text: "b" },
    ], 100, 7);
    expect(rows).toMatchObject([
      { openclawSeq: 7, messageId: "gateway-a" },
      { openclawSeq: 8, messageId: "gateway-b" },
    ]);
  });

  test("run projection stores send identity and terminal status", () => {
    const db = openDatabase({ databasePath: testDbPath("runs") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "run:stable", sessionKey: "s1", clientMessageId: "client-1", idempotencyKey: "stable", status: "thinking", startedAtMs: 100, updatedAtMs: 100 });
    repo.upsertRun({ runId: "run:stable", sessionKey: "s1", gatewayRunId: "gateway-run-1", status: "streaming", updatedAtMs: 200 });
    repo.updateRunStatus("run:stable", "done", { updatedAtMs: 300 });

    expect(repo.findRunByClientMessage("s1", "client-1")).toMatchObject({ runId: "run:stable", gatewayRunId: "gateway-run-1", status: "done", finishedAtMs: 300 });
    expect(repo.findRunByIdempotencyKey("s1", "stable")).toMatchObject({ runId: "run:stable" });
    db.close();
  });

  test("tool projection upserts lifecycle by session and toolCallId", () => {
    const db = openDatabase({ databasePath: testDbPath("tools") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking" });
    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", name: "search", phase: "start", startedAtMs: 100, updatedAtMs: 100 });
    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", phase: "result", resultMeta: { count: 3 }, updatedAtMs: 200 });

    expect(repo.listToolCalls("s1", "r1")).toEqual([
      expect.objectContaining({ toolCallId: "tool-1", name: "search", status: "success", resultMeta: { count: 3 }, finishedAtMs: 200 }),
    ]);
    expect(repo.hasRunningTools("s1", "r1")).toBe(false);
    db.close();
  });

  test("confirming optimistic user preserves canonical client id and records gateway identity", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user") });
    const repo = new MessageRepository(db);
    repo.insertOptimisticMessage({ sessionKey: "s1", openclawSeq: 1, messageId: "client-1", role: "user", data: { role: "user", text: "hello", __clientOptimistic: true, __openclaw: { id: "client-1" } }, updatedAtMs: 100 });
    const [gateway] = normalizeHistoryMessages("s1", [{ role: "user", text: "> prior\n\nhello", __openclaw: { id: "gateway-user-1", seq: 7 } }], 200);
    const confirmed = repo.confirmOptimisticUser("s1", "client-1", gateway!);

    expect(confirmed).toMatchObject({ messageId: "client-1", openclawSeq: 1, data: { __clientOptimistic: false, __openclaw: { id: "client-1", gatewayId: "gateway-user-1", gatewaySeq: 7 } } });
    expect(repo.listMessages("s1")).toHaveLength(1);
    db.close();
  });

  test("projection cursor increases monotonically", () => {
    const db = openDatabase({ databasePath: testDbPath("cursor") });
    const repo = new MessageRepository(db);
    const a = repo.appendProjectionEvent({ eventType: "a", payload: {} });
    const b = repo.appendProjectionEvent({ eventType: "b", payload: {} });
    expect(b.cursor).toBeGreaterThan(a.cursor);
    db.close();
  });
});
