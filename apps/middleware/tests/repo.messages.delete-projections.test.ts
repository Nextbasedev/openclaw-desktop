import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../src/db/migrate.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";

let db: Database.Database;
let repo: MessageRepository;

function insertMessage(sessionKey: string, seq: number) {
  db.prepare(
    `INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionKey, seq, `m-${sessionKey}-${seq}`, "user", JSON.stringify({ role: "user", text: "hi" }), Date.now());
}

function insertRun(sessionKey: string, runId: string) {
  db.prepare(
    `INSERT INTO v2_runs(run_id, session_key, status, started_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, sessionKey, "done", Date.now(), Date.now());
}

function insertSession(sessionKey: string) {
  db.prepare(
    `INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(sessionKey, null, JSON.stringify({ sessionKey }), Date.now());
}

function countMessages(sessionKey: string) {
  return (db.prepare("SELECT count(*) AS c FROM v2_messages WHERE session_key = ?").get(sessionKey) as { c: number }).c;
}
function countRuns(sessionKey: string) {
  return (db.prepare("SELECT count(*) AS c FROM v2_runs WHERE session_key = ?").get(sessionKey) as { c: number }).c;
}
function countSessions(sessionKey: string) {
  return (db.prepare("SELECT count(*) AS c FROM v2_sessions WHERE session_key = ?").get(sessionKey) as { c: number }).c;
}

beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  repo = new MessageRepository(db);
});

afterEach(() => {
  db.close();
});

describe("MessageRepository.deleteSessionProjections", () => {
  test("removes all cross-table rows for the targeted sessions only", () => {
    insertMessage("s1", 1);
    insertMessage("s1", 2);
    insertRun("s1", "run-s1");
    insertSession("s1");

    insertMessage("s2", 1);
    insertRun("s2", "run-s2");
    insertSession("s2");

    const result = repo.deleteSessionProjections(["s1"]);

    expect(result.sessions).toBe(1);
    expect(result.rowsByTable.v2_messages).toBe(2);
    expect(result.rowsByTable.v2_runs).toBe(1);
    expect(result.rowsByTable.v2_sessions).toBe(1);

    // s1 gone
    expect(countMessages("s1")).toBe(0);
    expect(countRuns("s1")).toBe(0);
    expect(countSessions("s1")).toBe(0);
    // s2 untouched
    expect(countMessages("s2")).toBe(1);
    expect(countRuns("s2")).toBe(1);
    expect(countSessions("s2")).toBe(1);
  });

  test("rolls back ALL deletes when one table delete fails mid-batch", () => {
    insertMessage("s1", 1);
    insertMessage("s1", 2);
    insertRun("s1", "run-s1"); // v2_runs is deleted 2nd, after v2_messages (1st)
    insertSession("s1");

    // Force the v2_runs delete (2nd in the batch) to abort at runtime. The
    // v2_messages delete (1st) has already run by then, so a non-atomic
    // implementation would leave v2_messages emptied; the transaction must
    // roll it back instead.
    db.exec("CREATE TRIGGER t_fail_runs BEFORE DELETE ON v2_runs BEGIN SELECT RAISE(ABORT, 'boom'); END;");

    expect(() => repo.deleteSessionProjections(["s1"])).toThrow();

    // Everything must survive — proof the earlier v2_messages delete rolled back.
    expect(countMessages("s1")).toBe(2);
    expect(countRuns("s1")).toBe(1);
    expect(countSessions("s1")).toBe(1);

    db.exec("DROP TRIGGER t_fail_runs;");
  });

  test("no-op for an empty session list", () => {
    insertMessage("s1", 1);
    const result = repo.deleteSessionProjections([]);
    expect(result.sessions).toBe(0);
    expect(countMessages("s1")).toBe(1);
  });
});
