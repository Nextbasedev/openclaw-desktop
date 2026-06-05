import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createLogger } from "../lib/logger.js";
import { CHAT_PROJECTION_VERSION, CHAT_PROJECTION_VERSION_META_KEY, chatProjectionResyncRequiredMetaKey } from "./chat-projection-version.js";
import { normalizeMessageText, textFromMessage } from "../features/chat/message-normalizer.js";
import { extractSubagentSessionKey } from "../features/chat/subagent-session.js";
import type { OpenClawMessage } from "../features/chat/types.js";

const SCHEMA_VERSION = 4;
const log = createLogger("db");

const schema = `
CREATE TABLE IF NOT EXISTS v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_sessions (session_key TEXT PRIMARY KEY, session_id TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_chat_segments (
  segment_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  session_id TEXT,
  session_file TEXT,
  segment_index INTEGER NOT NULL,
  base_seq INTEGER NOT NULL DEFAULT 0,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  reset_reason TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_key, segment_index)
);
CREATE INDEX IF NOT EXISTS idx_v2_chat_segments_session_key ON v2_chat_segments(session_key, segment_index);
CREATE INDEX IF NOT EXISTS idx_v2_chat_segments_active ON v2_chat_segments(session_key, is_active) WHERE is_active = 1;
CREATE TABLE IF NOT EXISTS v2_messages (session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, client_message_id TEXT, idempotency_key TEXT, run_id TEXT, logical_turn_key TEXT, text_fingerprint TEXT, PRIMARY KEY (session_key, openclaw_seq));
CREATE INDEX IF NOT EXISTS idx_v2_messages_session_seq ON v2_messages(session_key, openclaw_seq);
CREATE INDEX IF NOT EXISTS idx_v2_messages_session_message_id ON v2_messages(session_key, message_id) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS v2_archive_imports (
  session_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  segment_id TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  imported_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_key, file_path)
);
CREATE INDEX IF NOT EXISTS idx_v2_archive_imports_session_key ON v2_archive_imports(session_key);
CREATE TABLE IF NOT EXISTS v2_runs (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  client_message_id TEXT,
  idempotency_key TEXT,
  gateway_run_id TEXT,
  status TEXT NOT NULL,
  status_label TEXT,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  error_json TEXT,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_runs_session_key ON v2_runs(session_key);
CREATE INDEX IF NOT EXISTS idx_v2_runs_client_message_id ON v2_runs(client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_runs_idempotency_key ON v2_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_runs_gateway_run_id ON v2_runs(gateway_run_id) WHERE gateway_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS v2_tool_calls (
  tool_call_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  run_id TEXT,
  message_id TEXT,
  name TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  args_meta_json TEXT,
  result_meta_json TEXT,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_key, tool_call_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_tool_calls_session_key ON v2_tool_calls(session_key);
CREATE INDEX IF NOT EXISTS idx_v2_tool_calls_run_id ON v2_tool_calls(run_id) WHERE run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS v2_subagents (
  parent_session_key TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  child_session_key TEXT,
  label TEXT NOT NULL DEFAULT 'Sub-agent',
  status TEXT NOT NULL DEFAULT 'spawning',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (parent_session_key, tool_call_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_subagents_parent_session ON v2_subagents(parent_session_key, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_v2_subagents_child_session ON v2_subagents(child_session_key) WHERE child_session_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS v2_projection_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_v2_projection_events_cursor ON v2_projection_events(cursor);
CREATE TABLE IF NOT EXISTS v2_gateway_offsets (session_key TEXT PRIMARY KEY, last_openclaw_seq INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_compat_state (key TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
`;

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function safeJson(value: string): OpenClawMessage | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as OpenClawMessage : null;
  } catch {
    return null;
  }
}

function stringField(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function openclawMeta(data: OpenClawMessage | null): Record<string, unknown> {
  const meta = data?.__openclaw;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

function textFingerprint(role: string | null, data: OpenClawMessage | null): string | null {
  if (role !== "user" || !data) return null;
  const text = normalizeMessageText(textFromMessage(data));
  if (!text) return null;
  return `user-text:${createHash("sha256").update(text).digest("hex").slice(0, 32)}`;
}

function identityFromRow(row: { message_id: string | null; role: string | null; data_json: string }) {
  const data = safeJson(row.data_json);
  const meta = openclawMeta(data);
  const clientMessageId = stringField(meta.clientMessageId, data?.clientMessageId, data?.__clientOptimistic && row.role === "user" ? row.message_id : null);
  const idempotencyKey = stringField(meta.idempotencyKey, data?.idempotencyKey);
  const runId = stringField(meta.runId, data?.runId, data?.gatewayRunId);
  const logicalTurnKey = clientMessageId ? `client:${clientMessageId}` : idempotencyKey ? `idem:${idempotencyKey}` : runId && row.role === "user" ? `run:${runId}` : null;
  return { clientMessageId, idempotencyKey, runId, logicalTurnKey, textFingerprint: textFingerprint(row.role, data) };
}

function backfillMessageTurnIdentity(db: Database.Database) {
  const rows = db.prepare(`
    SELECT session_key, openclaw_seq, message_id, role, data_json
    FROM v2_messages
    WHERE client_message_id IS NULL OR idempotency_key IS NULL OR run_id IS NULL OR logical_turn_key IS NULL OR text_fingerprint IS NULL
  `).all() as Array<{ session_key: string; openclaw_seq: number; message_id: string | null; role: string | null; data_json: string }>;
  if (rows.length === 0) return;
  const update = db.prepare(`
    UPDATE v2_messages
    SET client_message_id = COALESCE(client_message_id, @clientMessageId),
        idempotency_key = COALESCE(idempotency_key, @idempotencyKey),
        run_id = COALESCE(run_id, @runId),
        logical_turn_key = COALESCE(logical_turn_key, @logicalTurnKey),
        text_fingerprint = COALESCE(text_fingerprint, @textFingerprint)
    WHERE session_key = @sessionKey AND openclaw_seq = @openclawSeq
  `);
  const tx = db.transaction(() => {
    for (const row of rows) update.run({ sessionKey: row.session_key, openclawSeq: row.openclaw_seq, ...identityFromRow(row) });
  });
  tx();
}

function cleanupDuplicateUserEchoes(db: Database.Database) {
  const duplicates = db.prepare(`
    SELECT stable.session_key AS session_key, stable.openclaw_seq AS stable_seq, dup.openclaw_seq AS duplicate_seq, dup.gateway_seq AS duplicate_gateway_seq, dup.message_id AS duplicate_message_id, stable.data_json AS stable_data_json
    FROM v2_messages stable
    JOIN v2_messages dup
      ON dup.session_key = stable.session_key
     AND dup.segment_id IS stable.segment_id
     AND dup.role = 'user'
     AND dup.text_fingerprint = stable.text_fingerprint
     AND dup.openclaw_seq > stable.openclaw_seq
     AND dup.openclaw_seq <= stable.openclaw_seq + 4
    WHERE stable.role = 'user'
      AND stable.text_fingerprint IS NOT NULL
      AND (stable.client_message_id IS NOT NULL OR stable.idempotency_key IS NOT NULL OR stable.run_id IS NOT NULL OR stable.logical_turn_key IS NOT NULL)
      AND dup.client_message_id IS NULL
      AND dup.idempotency_key IS NULL
      AND dup.run_id IS NULL
      AND dup.logical_turn_key IS NULL
  `).all() as Array<{ session_key: string; stable_seq: number; duplicate_seq: number; duplicate_gateway_seq: number | null; duplicate_message_id: string | null; stable_data_json: string }>;
  if (duplicates.length === 0) return;
  const updateStable = db.prepare(`UPDATE v2_messages SET gateway_seq = COALESCE(gateway_seq, @gatewaySeq), data_json = @dataJson WHERE session_key = @sessionKey AND openclaw_seq = @stableSeq`);
  const deleteDup = db.prepare(`DELETE FROM v2_messages WHERE session_key = @sessionKey AND openclaw_seq = @duplicateSeq`);
  const tx = db.transaction(() => {
    for (const row of duplicates) {
      const data = safeJson(row.stable_data_json) ?? {};
      const meta = openclawMeta(data);
      const merged = {
        ...data,
        isOptimistic: false,
        __clientOptimistic: false,
        __openclaw: {
          ...meta,
          ...(row.duplicate_message_id ? { gatewayId: row.duplicate_message_id } : {}),
          ...(row.duplicate_gateway_seq !== null ? { gatewaySeq: row.duplicate_gateway_seq } : {}),
        },
      };
      updateStable.run({ sessionKey: row.session_key, stableSeq: row.stable_seq, gatewaySeq: row.duplicate_gateway_seq, dataJson: JSON.stringify(merged) });
      deleteDup.run({ sessionKey: row.session_key, duplicateSeq: row.duplicate_seq });
    }
  });
  tx();
  log.info("messages.user-echo-cleanup", { duplicateRowsCollapsed: duplicates.length });
}

function parseAnyJson(value: string | null | undefined): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function subagentLabelFromArgs(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "Sub-agent";
  const record = args as Record<string, unknown>;
  for (const key of ["label", "agentId", "task"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 60);
  }
  return "Sub-agent";
}

function backfillSubagents(db: Database.Database) {
  const rows = db.prepare(`
    SELECT session_key, tool_call_id, args_meta_json, result_meta_json, status, started_at_ms, updated_at_ms
    FROM v2_tool_calls
    WHERE name = 'sessions_spawn'
  `).all() as Array<{
    session_key: string;
    tool_call_id: string;
    args_meta_json: string | null;
    result_meta_json: string | null;
    status: string | null;
    started_at_ms: number | null;
    updated_at_ms: number | null;
  }>;
  if (rows.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO v2_subagents(parent_session_key, tool_call_id, child_session_key, label, status, created_at_ms, updated_at_ms)
    VALUES (@parentSessionKey, @toolCallId, @childSessionKey, @label, @status, @createdAtMs, @updatedAtMs)
    ON CONFLICT(parent_session_key, tool_call_id) DO UPDATE SET
      child_session_key = COALESCE(v2_subagents.child_session_key, excluded.child_session_key),
      label = COALESCE(NULLIF(v2_subagents.label, 'Sub-agent'), NULLIF(excluded.label, 'Sub-agent'), v2_subagents.label, excluded.label),
      status = CASE
        WHEN v2_subagents.status IN ('completed', 'failed') THEN v2_subagents.status
        ELSE excluded.status
      END,
      updated_at_ms = max(v2_subagents.updated_at_ms, excluded.updated_at_ms)
  `);
  const tx = db.transaction(() => {
    for (const row of rows) {
      const args = parseAnyJson(row.args_meta_json);
      const result = parseAnyJson(row.result_meta_json);
      const childSessionKey = extractSubagentSessionKey(result);
      const status = row.status === "error" ? "failed" : childSessionKey ? "working" : "spawning";
      const now = Date.now();
      insert.run({
        parentSessionKey: row.session_key,
        toolCallId: row.tool_call_id,
        childSessionKey,
        label: subagentLabelFromArgs(args),
        status,
        createdAtMs: row.started_at_ms ?? row.updated_at_ms ?? now,
        updatedAtMs: row.updated_at_ms ?? row.started_at_ms ?? now,
      });
    }
  });
  tx();
}

function backfillLegacyMessageSegments(db: Database.Database) {
  const sessions = db.prepare(`
    SELECT session_key, min(openclaw_seq) AS min_seq, max(openclaw_seq) AS max_seq
    FROM v2_messages
    WHERE segment_id IS NULL
    GROUP BY session_key
  `).all() as Array<{ session_key: string; min_seq: number | null; max_seq: number | null }>;
  if (sessions.length === 0) return;

  const activeSegment = db.prepare(`
    SELECT segment_id, base_seq
    FROM v2_chat_segments
    WHERE session_key = @sessionKey AND is_active = 1
    ORDER BY segment_index DESC
    LIMIT 1
  `);
  const maxSegment = db.prepare(`SELECT max(segment_index) AS max_index FROM v2_chat_segments WHERE session_key = @sessionKey`);
  const insertSegment = db.prepare(`
    INSERT INTO v2_chat_segments(segment_id, session_key, session_id, session_file, segment_index, base_seq, started_at_ms, reset_reason, is_active, created_at_ms, updated_at_ms)
    VALUES (@segmentId, @sessionKey, NULL, NULL, @segmentIndex, 0, @now, 'legacy_unsegmented', 1, @now, @now)
  `);
  const updateMessages = db.prepare(`
    UPDATE v2_messages
    SET segment_id = @segmentId,
        gateway_seq = COALESCE(gateway_seq, openclaw_seq - @baseSeq)
    WHERE session_key = @sessionKey AND segment_id IS NULL
  `);

  const tx = db.transaction(() => {
    const now = Date.now();
    for (const session of sessions) {
      const sessionKey = session.session_key;
      const active = activeSegment.get({ sessionKey }) as { segment_id: string; base_seq: number } | undefined;
      let segmentId = active?.segment_id;
      let baseSeq = Number(active?.base_seq ?? 0);
      if (!segmentId) {
        const maxRow = maxSegment.get({ sessionKey }) as { max_index?: number | null } | undefined;
        const segmentIndex = Math.max(-1, Number(maxRow?.max_index ?? -1)) + 1;
        segmentId = `${sessionKey}::segment::legacy::${segmentIndex}`;
        baseSeq = 0;
        insertSegment.run({ segmentId, sessionKey, segmentIndex, now });
      }
      updateMessages.run({ segmentId, sessionKey, baseSeq });
    }
  });
  tx();
}

export function migrateDatabase(db: Database.Database) {
  db.exec(schema);
  addColumnIfMissing(db, "v2_messages", "segment_id", "segment_id TEXT");
  addColumnIfMissing(db, "v2_messages", "session_id", "session_id TEXT");
  addColumnIfMissing(db, "v2_messages", "gateway_seq", "gateway_seq INTEGER");
  addColumnIfMissing(db, "v2_messages", "client_message_id", "client_message_id TEXT");
  addColumnIfMissing(db, "v2_messages", "idempotency_key", "idempotency_key TEXT");
  addColumnIfMissing(db, "v2_messages", "run_id", "run_id TEXT");
  addColumnIfMissing(db, "v2_messages", "logical_turn_key", "logical_turn_key TEXT");
  addColumnIfMissing(db, "v2_messages", "text_fingerprint", "text_fingerprint TEXT");
  addColumnIfMissing(db, "v2_tool_calls", "segment_id", "segment_id TEXT");
  addColumnIfMissing(db, "v2_tool_calls", "session_id", "session_id TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_v2_messages_segment_seq ON v2_messages(segment_id, gateway_seq) WHERE segment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_messages_session_id ON v2_messages(session_id) WHERE session_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_messages_client_message_id ON v2_messages(session_key, client_message_id) WHERE client_message_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_messages_idempotency_key ON v2_messages(session_key, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_messages_user_run_id ON v2_messages(session_key, run_id) WHERE run_id IS NOT NULL AND role = 'user';
    CREATE INDEX IF NOT EXISTS idx_v2_messages_logical_turn_key ON v2_messages(session_key, logical_turn_key) WHERE logical_turn_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_messages_text_fingerprint ON v2_messages(session_key, text_fingerprint) WHERE text_fingerprint IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_tool_calls_segment_id ON v2_tool_calls(segment_id) WHERE segment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_subagents_parent_session ON v2_subagents(parent_session_key, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_v2_subagents_child_session ON v2_subagents(child_session_key) WHERE child_session_key IS NOT NULL;
  `);
  backfillSubagents(db);
  backfillMessageTurnIdentity(db);
  cleanupDuplicateUserEchoes(db);
  backfillLegacyMessageSegments(db);
  db.prepare(`INSERT INTO v2_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION));

  const storedProjection = readNumberMeta(db, CHAT_PROJECTION_VERSION_META_KEY);
  if (storedProjection < CHAT_PROJECTION_VERSION) {
    const sessions = db.prepare("SELECT session_key FROM v2_sessions").all() as Array<{ session_key: string }>;
    const writeMeta = db.prepare(`INSERT INTO v2_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    for (const session of sessions) writeMeta.run(chatProjectionResyncRequiredMetaKey(session.session_key), String(CHAT_PROJECTION_VERSION));
    log.info("projection.version-gate.resync", { from: storedProjection || null, to: CHAT_PROJECTION_VERSION, pendingSessions: sessions.length });
  }
  db.prepare(`INSERT INTO v2_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(CHAT_PROJECTION_VERSION_META_KEY, String(CHAT_PROJECTION_VERSION));
}

function readNumberMeta(db: Database.Database, key: string): number {
  const row = db.prepare("SELECT value FROM v2_meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return Number(row?.value ?? 0);
}

export function readSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM v2_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  return Number(row?.value ?? 0);
}
