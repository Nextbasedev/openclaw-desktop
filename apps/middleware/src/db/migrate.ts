import type Database from "better-sqlite3";

const SCHEMA_VERSION = 2;

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
CREATE TABLE IF NOT EXISTS v2_messages (session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (session_key, openclaw_seq));
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

export function migrateDatabase(db: Database.Database) {
  db.exec(schema);
  addColumnIfMissing(db, "v2_messages", "segment_id", "segment_id TEXT");
  addColumnIfMissing(db, "v2_messages", "session_id", "session_id TEXT");
  addColumnIfMissing(db, "v2_messages", "gateway_seq", "gateway_seq INTEGER");
  addColumnIfMissing(db, "v2_tool_calls", "segment_id", "segment_id TEXT");
  addColumnIfMissing(db, "v2_tool_calls", "session_id", "session_id TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_v2_messages_segment_seq ON v2_messages(segment_id, gateway_seq) WHERE segment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_messages_session_id ON v2_messages(session_id) WHERE session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_v2_tool_calls_segment_id ON v2_tool_calls(segment_id) WHERE segment_id IS NOT NULL;
  `);
  db.prepare(`INSERT INTO v2_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION));
}

export function readSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM v2_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  return Number(row?.value ?? 0);
}
