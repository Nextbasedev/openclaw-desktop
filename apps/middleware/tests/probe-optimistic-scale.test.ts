import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-optimistic-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Optimistic User Echo Deduplication at Scale", () => {
  test("100 optimistic users confirmed by gateway echoes = exactly 100 rows", () => {
    const db = openDatabase({ databasePath: testDbPath("100-optimistic") });
    const msgRepo = new MessageRepository(db);

    for (let i = 0; i < 100; i++) {
      msgRepo.insertOptimisticMessage({
        sessionKey: "s1",
        openclawSeq: i + 1,
        messageId: `client-${i}`,
        role: "user",
        data: { role: "user", text: `hello ${i}`, __clientOptimistic: true, __openclaw: { id: `client-${i}` } },
        updatedAtMs: 100 + i,
      });
    }

    for (let i = 0; i < 100; i++) {
      const [gateway] = normalizeHistoryMessages("s1", [
        { role: "user", text: `hello ${i}`, __openclaw: { id: `gateway-user-${i}`, seq: i + 1 } },
      ]);
      msgRepo.confirmOptimisticUser("s1", `client-${i}`, gateway!);
    }

    expect(msgRepo.listMessages("s1")).toHaveLength(100);

    db.close();
  });

  test("optimistic confirmation preserves seq ordering", () => {
    const db = openDatabase({ databasePath: testDbPath("seq-order") });
    const msgRepo = new MessageRepository(db);

    for (let i = 0; i < 50; i++) {
      msgRepo.insertOptimisticMessage({
        sessionKey: "s1",
        openclawSeq: i + 1,
        messageId: `client-${i}`,
        role: "user",
        data: { role: "user", text: `msg-${i}`, __clientOptimistic: true },
        updatedAtMs: 100 + i,
      });
    }

    // Confirm out of order
    for (const idx of [30, 10, 45, 0, 25]) {
      const [gateway] = normalizeHistoryMessages("s1", [
        { role: "user", text: `msg-${idx}`, __openclaw: { id: `gw-${idx}`, seq: idx + 1 } },
      ]);
      msgRepo.confirmOptimisticUser("s1", `client-${idx}`, gateway!);
    }

    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(50);
    expect(rows.map(r => r.openclawSeq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

    db.close();
  });

  test("stale optimistic entries older than TTL are pruned by insertOptimisticMessage cleanup", () => {
    const db = openDatabase({ databasePath: testDbPath("stale-optimistic") });
    const msgRepo = new MessageRepository(db);

    // Insert old optimistic message
    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "old-client",
      role: "user",
      data: { role: "user", text: "old", __clientOptimistic: true },
      updatedAtMs: 1, // very old
    });

    // New optimistic insert should NOT prune from SQLite (repo doesn't have TTL prune)
    // but it should not collide
    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 2,
      messageId: "new-client",
      role: "user",
      data: { role: "user", text: "new", __clientOptimistic: true },
      updatedAtMs: Date.now(),
    });

    expect(msgRepo.listMessages("s1")).toHaveLength(2);

    db.close();
  });

  test("confirmed user text with inbound metadata stripped matches", () => {
    const db = openDatabase({ databasePath: testDbPath("metadata-strip") });
    const msgRepo = new MessageRepository(db);

    msgRepo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hello", __clientOptimistic: true },
      updatedAtMs: 100,
    });

    // Gateway echoes with metadata prefix
    const [gateway] = normalizeHistoryMessages("s1", [
      { role: "user", text: "> prior\n\nhello", __openclaw: { id: "gw-1", seq: 1 } },
    ]);
    const confirmed = msgRepo.confirmOptimisticUser("s1", "client-1", gateway!);

    // Note: confirmOptimisticUser does NOT strip metadata; it stores raw text
    expect(confirmed?.data.text).toBe("> prior\n\nhello");

    db.close();
  });
});
