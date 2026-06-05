import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import type { OpenClawMessage, ProjectedMessage } from "../src/features/chat/types.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-live-echo-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function repo(name: string) {
  const db = openDatabase({ databasePath: testDbPath(name) });
  const messages = new MessageRepository(db);
  messages.upsertSession({ sessionKey: "s1", sessionId: "sid-1", data: { sessionKey: "s1" } });
  return { db, messages };
}

function optimistic(seq: number, id: string, text: string, runId: string, idempotencyKey: string): ProjectedMessage {
  return {
    sessionKey: "s1",
    openclawSeq: seq,
    messageId: id,
    role: "user",
    data: {
      role: "user",
      text,
      isOptimistic: true,
      __clientOptimistic: true,
      __openclaw: { id, seq, clientMessageId: id, idempotencyKey, runId },
    },
    updatedAtMs: 1000 + seq,
  };
}

function userEcho(seq: number, text: string, messageId: string | null = null, extra: Partial<OpenClawMessage> = {}): ProjectedMessage {
  return {
    sessionKey: "s1",
    openclawSeq: seq,
    gatewaySeq: seq,
    messageId,
    role: "user",
    data: { role: "user", text, ...(messageId ? { id: messageId } : {}), ...extra },
    updatedAtMs: 2000 + seq,
  };
}

function assistant(seq: number, text = "answer"): ProjectedMessage {
  return {
    sessionKey: "s1",
    openclawSeq: seq,
    gatewaySeq: seq,
    messageId: `a${seq}`,
    role: "assistant",
    data: { role: "assistant", text, __openclaw: { id: `a${seq}`, seq } },
    updatedAtMs: 3000 + seq,
  };
}

function rows(messages: MessageRepository) {
  return messages.listMessages("s1", { limit: 100 }).map((m) => ({ seq: m.openclawSeq, role: m.role, id: m.messageId, text: typeof m.data.text === "string" ? m.data.text : "", gatewaySeq: m.gatewaySeq ?? null, gatewayId: m.data.__openclaw?.gatewayId ?? null }));
}

describe("live send echo DB-backed dedup", () => {
  test("fresh-chat optimistic + decorated stripped echo collapses to one user row", () => {
    const { db, messages } = repo("fresh-double");
    messages.insertOptimisticMessage(optimistic(1, "c1", "hello", "r1", "k1"));
    const confirmed = messages.confirmOptimisticUser("s1", "c1", userEcho(1, "hello", "gw-1", { __openclaw: { clientMessageId: "c1", idempotencyKey: "k1", runId: "r1" } }));
    expect(confirmed?.openclawSeq).toBe(1);

    messages.upsertMessages([userEcho(2, "hello", "gw-1-decorated")]);

    const listed = rows(messages);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ seq: 1, role: "user", id: "c1", text: "hello", gatewaySeq: 2, gatewayId: "gw-1-decorated" });
    db.close();
  });

  test("stripped replay of a prior user on a later send does not create a new row", () => {
    const { db, messages } = repo("prior-replay");
    messages.insertOptimisticMessage(optimistic(1, "c1", "first", "r1", "k1"));
    messages.confirmOptimisticUser("s1", "c1", userEcho(1, "first", "gw-1", { __openclaw: { clientMessageId: "c1", idempotencyKey: "k1", runId: "r1" } }));
    messages.insertOptimisticMessage(optimistic(2, "c2", "second", "r2", "k2"));
    messages.confirmOptimisticUser("s1", "c2", userEcho(2, "second", "gw-2", { __openclaw: { clientMessageId: "c2", idempotencyKey: "k2", runId: "r2" } }));

    messages.upsertMessages([userEcho(3, "first", null), assistant(4)]);

    expect(rows(messages).map((row) => `${row.role}:${row.text}`)).toEqual(["user:first", "user:second", "assistant:answer"]);
    db.close();
  });

  test("cold in-memory map still dedups through persisted SQLite identity", () => {
    const databasePath = testDbPath("cold-map");
    const db1 = openDatabase({ databasePath });
    const firstRepo = new MessageRepository(db1);
    firstRepo.upsertSession({ sessionKey: "s1", sessionId: "sid-1", data: { sessionKey: "s1" } });
    firstRepo.insertOptimisticMessage(optimistic(1, "c1", "survive restart", "r1", "k1"));
    firstRepo.confirmOptimisticUser("s1", "c1", userEcho(1, "survive restart", "gw-1", { __openclaw: { clientMessageId: "c1", idempotencyKey: "k1", runId: "r1" } }));
    db1.close();

    const db2 = openDatabase({ databasePath });
    const restartedRepo = new MessageRepository(db2);
    expect(restartedRepo.findPersistedUserEchoDuplicate("s1", userEcho(2, "survive restart", null))?.openclawSeq).toBe(1);
    restartedRepo.upsertMessages([userEcho(2, "survive restart", null)]);
    expect(rows(restartedRepo)).toHaveLength(1);
    db2.close();
  });

  test("intentional repeated identical sends are preserved as distinct stable turns", () => {
    const { db, messages } = repo("repeated");
    messages.insertOptimisticMessage(optimistic(1, "c1", "again", "r1", "k1"));
    messages.confirmOptimisticUser("s1", "c1", userEcho(1, "again", "gw-1", { __openclaw: { clientMessageId: "c1", idempotencyKey: "k1", runId: "r1" } }));
    messages.insertOptimisticMessage(optimistic(2, "c2", "again", "r2", "k2"));
    messages.confirmOptimisticUser("s1", "c2", userEcho(2, "again", "gw-2", { __openclaw: { clientMessageId: "c2", idempotencyKey: "k2", runId: "r2" } }));

    expect(rows(messages).map((row) => row.id)).toEqual(["c1", "c2"]);
    db.close();
  });

  test("ordering remains user then assistant without history backfill", () => {
    const { db, messages } = repo("ordering");
    messages.insertOptimisticMessage(optimistic(1, "c1", "order", "r1", "k1"));
    messages.confirmOptimisticUser("s1", "c1", userEcho(1, "order", "gw-1", { __openclaw: { clientMessageId: "c1", idempotencyKey: "k1", runId: "r1" } }));
    messages.upsertMessages([assistant(2), userEcho(3, "order", "late-user-echo")]);

    expect(rows(messages).map((row) => `${row.seq}:${row.role}:${row.text}`)).toEqual(["1:user:order", "2:assistant:answer"]);
    db.close();
  });

  test("migration cleanup collapses already-polluted stable optimistic + nearby stripped echo", () => {
    const databasePath = testDbPath("cleanup");
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE v2_sessions (session_key TEXT PRIMARY KEY, session_id TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
      CREATE TABLE v2_chat_segments (segment_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, session_id TEXT, session_file TEXT, segment_index INTEGER NOT NULL, base_seq INTEGER NOT NULL DEFAULT 0, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, reset_reason TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, UNIQUE(session_key, segment_index));
      CREATE TABLE v2_messages (session_key TEXT NOT NULL, segment_id TEXT, session_id TEXT, gateway_seq INTEGER, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (session_key, openclaw_seq));
    `);
    seed.prepare("INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms) VALUES ('s1', 'sid-1', '{}', 1)").run();
    seed.prepare("INSERT INTO v2_chat_segments(segment_id, session_key, session_id, segment_index, base_seq, started_at_ms, created_at_ms, updated_at_ms) VALUES ('seg1', 's1', 'sid-1', 0, 0, 1, 1, 1)").run();
    seed.prepare("INSERT INTO v2_messages(session_key, segment_id, session_id, openclaw_seq, message_id, role, data_json, updated_at_ms) VALUES ('s1', 'seg1', 'sid-1', 1, 'c1', 'user', ?, 1)").run(JSON.stringify(optimistic(1, "c1", "polluted", "r1", "k1").data));
    seed.prepare("INSERT INTO v2_messages(session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms) VALUES ('s1', 'seg1', 'sid-1', 2, 2, NULL, 'user', ?, 2)").run(JSON.stringify({ role: "user", text: "polluted" }));
    seed.prepare("INSERT INTO v2_messages(session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms) VALUES ('s1', 'seg1', 'sid-1', 2, 3, 'a1', 'assistant', ?, 3)").run(JSON.stringify({ role: "assistant", text: "answer" }));
    seed.close();

    const db = new Database(databasePath);
    migrateDatabase(db);
    const messages = new MessageRepository(db);
    expect(rows(messages).map((row) => `${row.seq}:${row.role}:${row.text}`)).toEqual(["1:user:polluted", "3:assistant:answer"]);
    db.close();
  });
});
