import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { readSchemaVersion } from "../src/db/migrate.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("SQLite projection", () => {
  test("migration creates schema version", () => {
    const db = openDatabase({ databasePath: testDbPath("schema") });
    expect(readSchemaVersion(db)).toBe(1);
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

  test("projection cursor increases monotonically", () => {
    const db = openDatabase({ databasePath: testDbPath("cursor") });
    const repo = new MessageRepository(db);
    const a = repo.appendProjectionEvent({ eventType: "a", payload: {} });
    const b = repo.appendProjectionEvent({ eventType: "b", payload: {} });
    expect(b.cursor).toBeGreaterThan(a.cursor);
    db.close();
  });
});
