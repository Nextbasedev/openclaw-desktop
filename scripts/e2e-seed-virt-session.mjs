#!/usr/bin/env node
/**
 * Seed a long session into the local middleware SQLite so we can exercise
 * windowed /api/chat/messages paging without a live Gateway.
 */
import Database from "better-sqlite3";

const dbPath = process.argv[2] || "C:/Users/krish/.openclaw/middleware/state.sqlite";
const TOTAL = Number(process.argv[3] || 500);
const sessionKey = process.argv[4] || `agent:main:desktop:e2e-virt-seed-${Date.now()}`;
const now = Date.now();

const db = new Database(dbPath);
console.log("db:", dbPath);
console.log("tables:", db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name).join(", "));

function cols(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const sessionCols = cols("v2_sessions");
console.log("v2_sessions:", sessionCols.join(","));

const messageTable = ["v2_messages", "messages"].find((t) => {
  try { cols(t); return true; } catch { return false; }
});
if (!messageTable) {
  console.error("No messages table found");
  process.exit(1);
}
const messageCols = cols(messageTable);
console.log(`${messageTable}:`, messageCols.join(","));

const segmentTable = ["v2_segments", "segments"].find((t) => {
  try { return cols(t).length > 0; } catch { return false; }
});
if (segmentTable) console.log(`${segmentTable}:`, cols(segmentTable).join(","));

db.exec("BEGIN");
try {
  // session
  if (sessionCols.includes("session_key")) {
    db.prepare(
      `INSERT OR REPLACE INTO v2_sessions(session_key, session_id, data_json, updated_at_ms) VALUES (?,?,?,?)`,
    ).run(sessionKey, "e2e-sid", JSON.stringify({ sessionKey, sessionId: "e2e-sid", status: "done", label: "E2E virt seed" }), now);
  }

  let segmentId = null;
  let baseSeq = 0;
  if (segmentTable) {
    const segs = cols(segmentTable);
    const existing = db.prepare(`SELECT * FROM ${segmentTable} WHERE session_key = ? LIMIT 1`).get(sessionKey);
    if (existing) {
      segmentId = existing.segment_id ?? existing.id;
      baseSeq = existing.base_seq ?? 0;
    } else {
      // best-effort insert
      const insertCols = ["session_key"];
      const insertVals = [sessionKey];
      if (segs.includes("session_id")) { insertCols.push("session_id"); insertVals.push("e2e-sid"); }
      if (segs.includes("segment_id")) { insertCols.push("segment_id"); insertVals.push(`${sessionKey}:active`); segmentId = `${sessionKey}:active`; }
      if (segs.includes("base_seq")) { insertCols.push("base_seq"); insertVals.push(0); }
      if (segs.includes("is_active")) { insertCols.push("is_active"); insertVals.push(1); }
      if (segs.includes("session_file")) { insertCols.push("session_file"); insertVals.push(null); }
      if (segs.includes("updated_at_ms")) { insertCols.push("updated_at_ms"); insertVals.push(now); }
      if (segs.includes("created_at_ms")) { insertCols.push("created_at_ms"); insertVals.push(now); }
      const placeholders = insertCols.map(() => "?").join(",");
      db.prepare(`INSERT INTO ${segmentTable}(${insertCols.join(",")}) VALUES (${placeholders})`).run(...insertVals);
      if (!segmentId) {
        const row = db.prepare(`SELECT * FROM ${segmentTable} WHERE session_key = ? LIMIT 1`).get(sessionKey);
        segmentId = row?.segment_id ?? row?.id ?? null;
        baseSeq = row?.base_seq ?? 0;
      }
    }
  }

  const insertMsg = (() => {
    // Expected v2 shape from tests: session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
    // plus optional gateway_seq, segment_id
    const has = (c) => messageCols.includes(c);
    return db.transaction((rows) => {
      for (const row of rows) {
        const data = {
          role: row.role,
          content: [{ type: "text", text: row.text }],
          __openclaw: { id: row.messageId, seq: row.seq },
        };
        if (has("session_key") && has("openclaw_seq") && has("message_id") && has("role") && has("data_json") && has("updated_at_ms")) {
          if (has("segment_id") && has("gateway_seq")) {
            db.prepare(
              `INSERT OR REPLACE INTO ${messageTable}(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms, segment_id, gateway_seq)
               VALUES (?,?,?,?,?,?,?,?)`,
            ).run(sessionKey, row.seq, row.messageId, row.role, JSON.stringify(data), now + row.seq, segmentId, row.seq);
          } else if (has("segment_id")) {
            db.prepare(
              `INSERT OR REPLACE INTO ${messageTable}(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms, segment_id)
               VALUES (?,?,?,?,?,?,?)`,
            ).run(sessionKey, row.seq, row.messageId, row.role, JSON.stringify(data), now + row.seq, segmentId);
          } else {
            db.prepare(
              `INSERT OR REPLACE INTO ${messageTable}(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
               VALUES (?,?,?,?,?,?)`,
            ).run(sessionKey, row.seq, row.messageId, row.role, JSON.stringify(data), now + row.seq);
          }
        } else {
          throw new Error(`Unsupported message schema: ${messageCols.join(",")}`);
        }
      }
    });
  })();

  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    seq: i + 1,
    messageId: `e2e-m-${i + 1}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `E2E virt message ${i + 1}`,
  }));
  insertMsg(rows);
  db.exec("COMMIT");
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${messageTable} WHERE session_key = ?`).get(sessionKey).n;
  console.log(JSON.stringify({ ok: true, sessionKey, seeded: count, segmentId, baseSeq }, null, 2));
} catch (err) {
  db.exec("ROLLBACK");
  console.error(err);
  process.exit(1);
} finally {
  db.close();
}
