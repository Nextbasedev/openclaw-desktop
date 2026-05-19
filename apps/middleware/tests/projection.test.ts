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

  test("can read the latest limited messages in chronological order", () => {
    const db = openDatabase({ databasePath: testDbPath("latest-messages") });
    const repo = new MessageRepository(db);
    repo.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 65 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
      __openclaw: { id: `m${index}`, seq: index },
    }))));

    const rows = repo.listMessages("s1", { limit: 60, latest: true });

    expect(rows).toHaveLength(60);
    expect(rows[0]?.messageId).toBe("m5");
    expect(rows.at(-1)?.messageId).toBe("m64");
    expect(rows.map((row) => row.openclawSeq)).toEqual(
      [...rows].map((row) => row.openclawSeq).sort((a, b) => a - b)
    );
    db.close();
  });

  test("can read older messages before a sequence in chronological order", () => {
    const db = openDatabase({ databasePath: testDbPath("before-seq-messages") });
    const repo = new MessageRepository(db);
    repo.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
      __openclaw: { id: `m${index}`, seq: index + 1 },
    }))));

    const rows = repo.listMessages("s1", { beforeSeq: 15, limit: 5 });

    expect(rows.map((row) => row.openclawSeq)).toEqual([10, 11, 12, 13, 14]);
    expect(rows[0]?.messageId).toBe("m9");
    expect(rows.at(-1)?.messageId).toBe("m13");
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

  test("normalizer hides internal subagent completion messages from parent projection", () => {
    const rows = normalizeHistoryMessages("parent", [
      { id: "visible-user", role: "user", text: "run the task", __openclaw: { seq: 1 } },
      {
        id: "internal-subagent-completion",
        role: "user",
        text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nSUBAGENT_TOOL_CALL_1\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
        provenance: { kind: "inter_session", sourceSessionKey: "agent:main:subagent:child", sourceTool: "subagent_announce" },
        __openclaw: { seq: 2 },
      },
      { id: "visible-assistant", role: "assistant", text: "done", __openclaw: { seq: 3 } },
    ], 100, 1);

    expect(rows.map((row) => row.messageId)).toEqual(["visible-user", "visible-assistant"]);
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

  test("stale activity cleanup finalizes old runs and running tools", () => {
    const db = openDatabase({ databasePath: testDbPath("stale-activity") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "old-run", sessionKey: "s1", status: "tool_running", startedAtMs: 1_000, updatedAtMs: 1_000 });
    repo.upsertToolCall({ sessionKey: "s1", runId: "old-run", toolCallId: "old-tool", name: "read", phase: "start", startedAtMs: 1_000, updatedAtMs: 1_000 });

    const result = repo.finalizeStaleActivity({ nowMs: 10_000, activeRunMs: 1_000, runningToolMs: 1_000 });

    expect(result).toMatchObject({ runsFinalized: 1, toolsFinalized: 1 });
    expect(repo.latestRun("s1")).toMatchObject({ status: "done", finishedAtMs: 10_000 });
    expect(repo.listToolCalls("s1", "old-run")).toEqual([
      expect.objectContaining({ toolCallId: "old-tool", status: "success", phase: "result", finishedAtMs: 10_000 }),
    ]);
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
