import type Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

const schema = `
CREATE TABLE IF NOT EXISTS v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_sessions (session_key TEXT PRIMARY KEY, session_id TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_messages (session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (session_key, openclaw_seq));
CREATE INDEX IF NOT EXISTS idx_v2_messages_session_seq ON v2_messages(session_key, openclaw_seq);
CREATE INDEX IF NOT EXISTS idx_v2_messages_session_message_id ON v2_messages(session_key, message_id) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS v2_projection_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_v2_projection_events_cursor ON v2_projection_events(cursor);
CREATE TABLE IF NOT EXISTS v2_gateway_offsets (session_key TEXT PRIMARY KEY, last_openclaw_seq INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
`;

export function migrateDatabase(db: Database.Database) {
  db.exec(schema);
  db.prepare(`INSERT INTO v2_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION));
}

export function readSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM v2_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  return Number(row?.value ?? 0);
}
