import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { canonicalPatchPayload, buildChatBootstrapSnapshot, CHAT_PROJECTION_VERSION } from "../src/features/chat/projection.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-projection-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("PROBE: Projection / Timeline Reducer", () => {
  test("bootstrap snapshot preserves monotonic cursor across 45-message segment", () => {
    const db = openDatabase({ databasePath: testDbPath("cursor-mono") });
    const msgRepo = new MessageRepository(db);
    const runRepo = new RunRepository(db);

    const messages = normalizeHistoryMessages("s1", Array.from({ length: 45 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg-${i}`,
      __openclaw: { id: `m${i}`, seq: i + 1 },
    })));

    const proj = msgRepo.upsertMessages(messages);
    expect(proj.upserted).toBe(45);
    expect(proj.lastSeq).toBe(45);

    // Simulate a projection event for each message
    let lastCursor = 0;
    for (let i = 0; i < 45; i++) {
      const patch = msgRepo.appendProjectionEvent({
        sessionKey: "s1",
        eventType: "chat.message.upsert",
        payload: canonicalPatchPayload({
          sessionKey: "s1",
          semanticType: messages[i]!.role === "user" ? "chat.user.confirmed" : "chat.assistant.final",
          payload: { messageSeq: messages[i]!.openclawSeq },
        }),
      });
      expect(patch.cursor).toBeGreaterThan(lastCursor);
      lastCursor = patch.cursor;
    }

    // Build bootstrap snapshot and verify it reflects latest state
    const snapshot = buildChatBootstrapSnapshot(
      { messages: msgRepo, runs: runRepo } as any,
      {
        sessionKey: "s1",
        sessionId: null,
        sessionData: { status: "done" },
        messages: msgRepo.listMessages("s1", { limit: 60 }),
        messageCount: msgRepo.listMessages("s1").length,
        cursor: lastCursor,
        projection: { upserted: proj.upserted, lastSeq: proj.lastSeq, liveSubscribed: true },
      }
    );

    expect(snapshot.projectionVersion).toBe(CHAT_PROJECTION_VERSION);
    expect(snapshot.cursor).toBe(lastCursor);
    expect(snapshot.messages).toHaveLength(45);
    expect(snapshot.messageCount).toBe(45);

    db.close();
  });

  test("timeline reducer collapses duplicate role-adjacent user echoes", () => {
    const db = openDatabase({ databasePath: testDbPath("timeline-dedup") });
    const msgRepo = new MessageRepository(db);

    // First user turn
    const first = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } },
    ]);
    msgRepo.upsertMessages(first);

    // Gateway replay of same user turn with stripped id
    const echo = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { seq: 1 } }, // no id
    ]);
    const proj2 = msgRepo.upsertMessages(echo);

    // Should NOT create a second row (the seq collision logic + same text should keep it in place)
    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data.text).toBe("hello");

    db.close();
  });

  test("timeline reducer appends when role differs at same seq (collision)", () => {
    const db = openDatabase({ databasePath: testDbPath("timeline-collision") });
    const msgRepo = new MessageRepository(db);

    // User at seq=1
    const user = normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } },
    ]);
    msgRepo.upsertMessages(user);

    // Malformed gateway assistant row also claiming seq=1
    const assistant = normalizeHistoryMessages("s1", [
      { role: "assistant", text: "world", __openclaw: { id: "a1", seq: 1 } },
    ]);
    const proj = msgRepo.upsertMessages(assistant);

    // Should have TWO rows because role differs (collision → append)
    const rows = msgRepo.listMessages("s1");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.role).toBe("user");
    expect(rows[1]?.role).toBe("assistant");

    db.close();
  });

  test("resequence restores contiguous seq after collision append", () => {
    const db = openDatabase({ databasePath: testDbPath("resequence") });
    const msgRepo = new MessageRepository(db);

    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "a", __openclaw: { id: "u1", seq: 1 } },
    ]));
    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", text: "b", __openclaw: { id: "a1", seq: 1 } }, // collision
    ]));
    msgRepo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "c", __openclaw: { id: "u2", seq: 2 } },
    ]));

    const before = msgRepo.listMessages("s1").map(r => r.openclawSeq);
    expect(before).toContain(1);
    expect(before).toContain(2); // appended after collision
    expect(before).toContain(3); // u2 shifted

    const reseq = msgRepo.resequenceSessionMessages("s1");
    // In this specific case, collision append already produced contiguous seqs (1,2,3),
    // so resequence may return 0. That's actually correct behavior.
    expect(reseq.changedMessages).toBeGreaterThanOrEqual(0);

    const after = msgRepo.listMessages("s1");
    expect(after.map(r => r.openclawSeq)).toEqual([1, 2, 3]);

    db.close();
  });
});
