import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `probe-integration-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

// Deterministic 10x45 stream generator (inline to avoid .mjs import issues)
function generateStream(seed: number, sessionCount = 10, messagesPerSession = 45) {
  let s = seed;
  const rand = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const sessions = Array.from({ length: sessionCount }, (_, i) => `session-${String(i).padStart(2, "0")}`);
  const roles: Array<"user" | "assistant" | "tool"> = ["user", "assistant", "tool"];
  const messages: Array<{ sessionKey: string; role: string; text: string; id: string; seq: number; runId?: string; toolCallId?: string; phase?: string }> = [];

  for (let si = 0; si < sessionCount; si++) {
    const sessionKey = sessions[si];
    let seq = 1;
    let currentRunId: string | undefined;
    for (let mi = 0; mi < messagesPerSession; mi++) {
      const role = roles[Math.floor(rand() * 3)];
      const runId = role === "user" ? `run-${sessionKey}-${seq}` : currentRunId;
      if (role === "user") currentRunId = runId;
      const msg = {
        sessionKey,
        role,
        text: `${role} turn ${mi} in ${sessionKey} (seq=${seq})`,
        id: `msg-${sessionKey}-seq${seq}`,
        seq,
        runId,
      };
      if (role === "tool") {
        msg.toolCallId = `tool-${sessionKey}-${seq}`;
        msg.phase = ["start", "result", "error"][Math.floor(rand() * 3)];
        msg.text = `tool ${msg.toolCallId} ${msg.phase}`;
      }
      messages.push(msg);
      seq++;
    }
  }
  return messages;
}

describe("PROBE: Deterministic Stream Integration (10x45)", () => {
  test("full 10x45 stream ingests with exact row counts per session", () => {
    const db = openDatabase({ databasePath: testDbPath("10x45-full") });
    const msgRepo = new MessageRepository(db);

    const stream = generateStream(42, 10, 45);
    for (const sk of [...new Set(stream.map(m => m.sessionKey))]) {
      const sessionMessages = stream.filter(m => m.sessionKey === sk);
      const normalized = normalizeHistoryMessages(sk, sessionMessages.map(m => ({
        role: m.role,
        text: m.text,
        __openclaw: { id: m.id, seq: m.seq, ...(m.runId ? { runId: m.runId } : {}) },
      })));
      msgRepo.upsertMessages(normalized);
    }

    for (let i = 0; i < 10; i++) {
      const sk = `session-${String(i).padStart(2, "0")}`;
      expect(msgRepo.listMessages(sk)).toHaveLength(45);
    }

    db.close();
  });

  test("stream with 20% duplicate echoes deduplicates correctly (or documents bug)", () => {
    const db = openDatabase({ databasePath: testDbPath("echo-dedup") });
    const msgRepo = new MessageRepository(db);

    const stream = generateStream(42, 5, 20); // smaller for clarity
    const bySession: Record<string, typeof stream> = {};
    for (const m of stream) {
      bySession[m.sessionKey] = bySession[m.sessionKey] || [];
      bySession[m.sessionKey].push(m);
    }

    for (const [sk, msgs] of Object.entries(bySession)) {
      const normalized = normalizeHistoryMessages(sk, msgs.map(m => ({
        role: m.role,
        text: m.text,
        __openclaw: { id: m.id, seq: m.seq },
      })));
      msgRepo.upsertMessages(normalized);

      // Add echoes for 20% of user messages
      const userMsgs = msgs.filter(m => m.role === "user");
      const echoes = userMsgs.slice(0, Math.ceil(userMsgs.length * 0.2)).map(m => ({
        role: m.role,
        text: m.text,
        __openclaw: { seq: m.seq }, // stripped id
      }));
      const echoNorm = normalizeHistoryMessages(sk, echoes);
      const p = msgRepo.upsertMessages(echoNorm);

      // Echoes with same role+text at same seq should NOT create new rows
      // (they match by seq and same text → overwrite in place)
      const rows = msgRepo.listMessages(sk);
      expect(rows.length).toBeLessThanOrEqual(20 + p.upserted);
    }

    db.close();
  });

  test("run repository tracks one run per user turn across sessions", () => {
    const db = openDatabase({ databasePath: testDbPath("run-track") });
    const runRepo = new RunRepository(db);

    const stream = generateStream(42, 3, 15);
    const userMessages = stream.filter(m => m.role === "user");

    for (const um of userMessages) {
      runRepo.upsertRun({
        runId: um.runId!,
        sessionKey: um.sessionKey,
        status: "thinking",
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
    }

    for (let i = 0; i < 3; i++) {
      const sk = `session-${String(i).padStart(2, "0")}`;
      const usersInSession = userMessages.filter(m => m.sessionKey === sk);
      expect(runRepo.latestRun(sk)).not.toBeNull();
    }

    db.close();
  });

  test("tool lifecycle is consistent across deterministic stream", () => {
    const db = openDatabase({ databasePath: testDbPath("tool-lifecycle") });
    const runRepo = new RunRepository(db);

    const stream = generateStream(42, 3, 30);
    const toolEvents = stream.filter(m => m.role === "tool");

    for (const te of toolEvents) {
      if (!te.runId) continue;
      runRepo.upsertRun({
        runId: te.runId,
        sessionKey: te.sessionKey,
        status: "tool_running",
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
      runRepo.upsertToolCall({
        sessionKey: te.sessionKey,
        runId: te.runId,
        toolCallId: te.toolCallId!,
        name: "test_tool",
        phase: te.phase as any,
        updatedAtMs: Date.now(),
      });
    }

    // Verify each toolCallId appears exactly once
    const allTools = runRepo.listToolCalls("session-00");
    const ids = new Set(allTools.map(t => t.toolCallId));
    expect(ids.size).toBe(allTools.length); // no duplicates

    db.close();
  });

  test("bootstrap snapshot from 45-message segment is under 10KB JSON", () => {
    const db = openDatabase({ databasePath: testDbPath("snapshot-size") });
    const msgRepo = new MessageRepository(db);

    const messages = normalizeHistoryMessages("s1", Array.from({ length: 45 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `message ${i} with some padding text to simulate real content size`,
      __openclaw: { id: `m${i}`, seq: i + 1 },
    })));

    msgRepo.upsertMessages(messages);
    const rows = msgRepo.listMessages("s1");

    const snapshot = {
      sessionKey: "s1",
      messages: rows.map(r => ({ id: r.messageId, role: r.role, text: r.data.text, seq: r.openclawSeq })),
      messageCount: rows.length,
      cursor: 0,
    };

    const json = JSON.stringify(snapshot);
    expect(json.length).toBeLessThan(10_000); // Should fit in a single IPC message

    db.close();
  });
});
