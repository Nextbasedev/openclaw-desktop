#!/usr/bin/env node
/**
 * Seed a 500-message E2E fixture for window-stabilization browser tests.
 *
 * Writes to the live middleware SQLite DB:
 *   /root/.openclaw/middleware/state.sqlite
 *
 * Session key: agent:main:desktop:e2e-window-stabilize
 *
 * Distribution (visible = 500 - 50 - 30 = 420 visible, plus we still need
 * to demonstrate over-fetch — actually we want >=160 visible *minimum* so
 * the over-fetch loop is exercised even when interleaved with hidden rows):
 *   - 50 hidden rows: subagent_announce sentinels (filtered by isVisibleMessage)
 *   - 30 hidden rows: non-user attached-file echo blocks (filtered)
 *   - remainder: alternating user / assistant with seqs 1..500
 *
 * Hidden rows are scattered (not clustered at the tail).
 */
import { createRequire } from "node:module"
import path from "node:path"
import crypto from "node:crypto"
const require = createRequire(import.meta.url)
const Database = require("/root/.openclaw/workspace/openclaw-desktop/apps/middleware/node_modules/better-sqlite3")

const DB_PATH = process.env.MIDDLEWARE_DB || "/root/.openclaw/middleware/state.sqlite"
const SESSION_KEY = process.env.E2E_SESSION_KEY || "agent:main:desktop:e2e-window-stabilize"
const TOTAL_MESSAGES = 500
const HIDDEN_SUBAGENT_COUNT = 50
const HIDDEN_ATTACHED_FILE_COUNT = 30

const db = new Database(DB_PATH)
db.pragma("journal_mode = WAL")

const now = Date.now()
const sessionId = crypto.randomUUID()
const segmentId = `${SESSION_KEY}::segment::${sessionId}::0`

console.log(`[seed] target db: ${DB_PATH}`)
console.log(`[seed] session_key: ${SESSION_KEY}`)
console.log(`[seed] session_id: ${sessionId}`)
console.log(`[seed] segment_id: ${segmentId}`)

// 1) Wipe any prior fixture rows for this session_key (idempotent reseed)
const delMessages = db.prepare(`DELETE FROM v2_messages WHERE session_key = ?`).run(SESSION_KEY)
const delSegments = db.prepare(`DELETE FROM v2_chat_segments WHERE session_key = ?`).run(SESSION_KEY)
const delSession = db.prepare(`DELETE FROM v2_sessions WHERE session_key = ?`).run(SESSION_KEY)
const delEpoch = db.prepare(`DELETE FROM v2_session_seq_epochs WHERE session_key = ?`).run(SESSION_KEY)
const delEvents = db.prepare(`DELETE FROM v2_projection_events WHERE session_key = ?`).run(SESSION_KEY)
const delGwOffset = db.prepare(`DELETE FROM v2_gateway_offsets WHERE session_key = ?`).run(SESSION_KEY)
console.log(`[seed] wiped: messages=${delMessages.changes} segments=${delSegments.changes} session=${delSession.changes} epoch=${delEpoch.changes} events=${delEvents.changes} gw_offsets=${delGwOffset.changes}`)

// 2) Create v2_sessions row
db.prepare(`
  INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms)
  VALUES (?, ?, ?, ?)
`).run(
  SESSION_KEY,
  sessionId,
  JSON.stringify({
    name: "E2E Window Stabilization",
    target: { type: "desktop", desktopId: "e2e-window-stabilize" },
    sessionKey: SESSION_KEY,
    sessionId,
    createdAtMs: now,
    updatedAtMs: now,
  }),
  now,
)

// 3) Create active segment
db.prepare(`
  INSERT INTO v2_chat_segments(segment_id, session_key, session_id, session_file, segment_index, base_seq, started_at_ms, ended_at_ms, reset_reason, is_active, created_at_ms, updated_at_ms)
  VALUES (?, ?, ?, NULL, 0, 0, ?, NULL, NULL, 1, ?, ?)
`).run(segmentId, SESSION_KEY, sessionId, now, now, now)

// 4) Pick hidden-row seqs (scattered, deterministic)
function pickScatteredSeqs(count, modulo, offset) {
  const seqs = new Set()
  for (let i = 0; i < count; i++) {
    seqs.add((i * modulo + offset) % TOTAL_MESSAGES + 1)
  }
  return seqs
}
const subagentSeqs = pickScatteredSeqs(HIDDEN_SUBAGENT_COUNT, 9, 7)
const attachedFileSeqs = pickScatteredSeqs(HIDDEN_ATTACHED_FILE_COUNT, 13, 11)
// resolve any overlap → drop overlapping from attached-file (keep subagent classification)
for (const seq of subagentSeqs) attachedFileSeqs.delete(seq)
console.log(`[seed] hidden subagent rows: ${subagentSeqs.size}, hidden attached-file rows: ${attachedFileSeqs.size}`)

const insertMessage = db.prepare(`
  INSERT INTO v2_messages(session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms)
  VALUES (@sessionKey, @segmentId, @sessionId, @gatewaySeq, @openclawSeq, @messageId, @role, @dataJson, @updatedAtMs)
`)

const insertProjectionEvent = db.prepare(`
  INSERT INTO v2_projection_events(session_key, event_type, payload_json, created_at_ms)
  VALUES (@sessionKey, @eventType, @payloadJson, @createdAtMs)
`)

function makeVisibleMessage(seq, role) {
  const messageId = `e2e-${role}-${seq}`
  const text =
    role === "user"
      ? `[fixture user seq ${seq}] Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.`
      : `[fixture assistant seq ${seq}] Quisque sit amet ex ut nibh hendrerit cursus. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. ${seq % 23 === 0 ? "This is a longer paragraph to provide vertical variation: " + "x ".repeat(80) : ""}`
  return {
    role,
    content: [{ type: "text", text }],
    text,
    timestamp: now - (TOTAL_MESSAGES - seq) * 1000,
    __openclaw: {
      id: messageId,
      seq,
      gatewayId: messageId,
      gatewaySeq: seq,
      segmentId,
    },
    messageId,
  }
}

function makeSubagentSentinelMessage(seq) {
  // Hidden via isInternalSubagentCompletionMessage (provenance.sourceTool=='subagent_announce')
  const messageId = `e2e-subagent-${seq}`
  const text = `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nseq: ${seq}\nresult: completed\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>`
  return {
    role: "assistant",
    provenance: { sourceTool: "subagent_announce" },
    content: [{ type: "text", text }],
    text,
    timestamp: now - (TOTAL_MESSAGES - seq) * 1000,
    __openclaw: { id: messageId, seq, segmentId },
    messageId,
  }
}

function makeAttachedFileEchoMessage(seq) {
  // Hidden via isNonUserAttachedFileEcho (assistant role + <attached-file> block)
  const messageId = `e2e-attached-${seq}`
  const text = `<attached-file path="/tmp/notes-${seq}.md">\n# Hidden echo seq ${seq}\nThis row should be filtered from the visible window.\n</attached-file>`
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    text,
    timestamp: now - (TOTAL_MESSAGES - seq) * 1000,
    __openclaw: { id: messageId, seq, segmentId },
    messageId,
  }
}

const txn = db.transaction(() => {
  for (let seq = 1; seq <= TOTAL_MESSAGES; seq++) {
    let msg
    let role
    if (subagentSeqs.has(seq)) {
      msg = makeSubagentSentinelMessage(seq)
      role = "assistant"
    } else if (attachedFileSeqs.has(seq)) {
      msg = makeAttachedFileEchoMessage(seq)
      role = "assistant"
    } else {
      role = seq % 2 === 1 ? "user" : "assistant"
      msg = makeVisibleMessage(seq, role)
    }
    insertMessage.run({
      sessionKey: SESSION_KEY,
      segmentId,
      sessionId,
      gatewaySeq: seq,
      openclawSeq: seq,
      messageId: msg.messageId,
      role,
      dataJson: JSON.stringify(msg),
      updatedAtMs: now - (TOTAL_MESSAGES - seq),
    })
    // Mirror as projection event so latestSessionCursor returns a sensible number
    insertProjectionEvent.run({
      sessionKey: SESSION_KEY,
      eventType: "message.upsert",
      payloadJson: JSON.stringify({ seq, role, messageId: msg.messageId }),
      createdAtMs: now - (TOTAL_MESSAGES - seq),
    })
  }

  // Set v2_gateway_offsets so the live-append code thinks the session is at-tail
  db.prepare(`
    INSERT INTO v2_gateway_offsets(session_key, last_openclaw_seq, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET last_openclaw_seq = excluded.last_openclaw_seq, updated_at_ms = excluded.updated_at_ms
  `).run(SESSION_KEY, TOTAL_MESSAGES, now)

  // Seed a v2_session_seq_epochs row
  db.prepare(`
    INSERT INTO v2_session_seq_epochs(session_key, seq_epoch, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET seq_epoch = excluded.seq_epoch, updated_at_ms = excluded.updated_at_ms
  `).run(SESSION_KEY, crypto.randomUUID(), now)
})

txn()

// 5) Verify counts
const total = db.prepare(`SELECT COUNT(*) AS c FROM v2_messages WHERE session_key = ?`).get(SESSION_KEY).c
const maxSeq = db.prepare(`SELECT MAX(openclaw_seq) AS s FROM v2_messages WHERE session_key = ?`).get(SESSION_KEY).s
const minSeq = db.prepare(`SELECT MIN(openclaw_seq) AS s FROM v2_messages WHERE session_key = ?`).get(SESSION_KEY).s

console.log(`[seed] inserted total=${total} minSeq=${minSeq} maxSeq=${maxSeq}`)
console.log(`[seed] expected visible (approx) = ${TOTAL_MESSAGES - subagentSeqs.size - attachedFileSeqs.size}`)
console.log(`[seed] done`)

db.close()
