import crypto from "node:crypto";
import type Database from "better-sqlite3";

export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      gateway_url TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_used_at TEXT,
      last_error TEXT,
      capabilities_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      repo_root TEXT,
      remotes_json TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_mappings (
      session_key TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT,
      topic_id TEXT,
      agent_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      source_session_key TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      branch_session_key TEXT NOT NULL UNIQUE,
      branch_topic_id TEXT,
      branch_reason TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      topic_id TEXT,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      runtime_id TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_git_context (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      repo_root TEXT NOT NULL,
      detected_command TEXT,
      detected_at TEXT NOT NULL,
      session_key TEXT,
      UNIQUE(topic_id, branch_name)
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'New Chat',
      session_key TEXT,
      space_id TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_dirty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_image_json TEXT,
      repo_root TEXT,
      project_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      deleted_by TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS recent_repos (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      selected_at TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_next ON sync_outbox(next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS anchor_sessions (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS project_local_overrides (
      project_id TEXT PRIMARY KEY,
      workspace_root TEXT,
      repo_root TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_messages (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sent_messages_session ON sent_messages(session_key, created_at);
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      pinned_at TEXT NOT NULL,
      UNIQUE(session_key, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pinned_messages_session ON pinned_messages(session_key);

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      message_text_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content TEXT NOT NULL,
      size INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_attachments_lookup ON message_attachments(session_key, message_text_hash);

    CREATE TABLE IF NOT EXISTS search_messages (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      message_id TEXT,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_messages_session ON search_messages(session_key, created_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_messages_fts USING fts5(
      body,
      content='search_messages',
      content_rowid='rowid',
      tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS search_messages_ai AFTER INSERT ON search_messages BEGIN
      INSERT INTO search_messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS search_messages_ad AFTER DELETE ON search_messages BEGIN
      INSERT INTO search_messages_fts(search_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS search_messages_au AFTER UPDATE ON search_messages BEGIN
      INSERT INTO search_messages_fts(search_messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
      INSERT INTO search_messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
  `);

  const migrations: Array<{ table: string; column: string; sql: string }> = [
    {
      table: "spaces",
      column: "icon_image_json",
      sql: "ALTER TABLE spaces ADD COLUMN icon_image_json TEXT",
    },
    {
      table: "projects",
      column: "remotes_json",
      sql: "ALTER TABLE projects ADD COLUMN remotes_json TEXT",
    },
    {
      table: "projects",
      column: "pinned",
      sql: "ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "projects",
      column: "sync_dirty",
      sql: "ALTER TABLE projects ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 1",
    },
    {
      table: "search_messages",
      column: "message_id",
      sql: "ALTER TABLE search_messages ADD COLUMN message_id TEXT",
    },
    {
      table: "topics",
      column: "sync_dirty",
      sql: "ALTER TABLE topics ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 1",
    },
    {
      table: "session_mappings",
      column: "sync_dirty",
      sql: "ALTER TABLE session_mappings ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 1",
    },
    {
      table: "branches",
      column: "sync_dirty",
      sql: "ALTER TABLE branches ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 1",
    },
    {
      table: "projects",
      column: "updated_by_device",
      sql: "ALTER TABLE projects ADD COLUMN updated_by_device TEXT",
    },
    {
      table: "projects",
      column: "deleted_at",
      sql: "ALTER TABLE projects ADD COLUMN deleted_at TEXT",
    },
    {
      table: "projects",
      column: "sort_order",
      sql: "ALTER TABLE projects ADD COLUMN sort_order TEXT",
    },
    {
      table: "topics",
      column: "updated_by_device",
      sql: "ALTER TABLE topics ADD COLUMN updated_by_device TEXT",
    },
    {
      table: "topics",
      column: "deleted_at",
      sql: "ALTER TABLE topics ADD COLUMN deleted_at TEXT",
    },
    {
      table: "topics",
      column: "sort_order_key",
      sql: "ALTER TABLE topics ADD COLUMN sort_order_key TEXT",
    },
    {
      table: "chats",
      column: "updated_by_device",
      sql: "ALTER TABLE chats ADD COLUMN updated_by_device TEXT",
    },
    {
      table: "chats",
      column: "deleted_at",
      sql: "ALTER TABLE chats ADD COLUMN deleted_at TEXT",
    },
    {
      table: "chats",
      column: "space_id",
      sql: "ALTER TABLE chats ADD COLUMN space_id TEXT",
    },
    {
      table: "session_mappings",
      column: "sort_order_key",
      sql: "ALTER TABLE session_mappings ADD COLUMN sort_order_key TEXT",
    },
  ];

  for (const m of migrations) {
    try {
      db.exec(m.sql);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate column name")) {
        throw new Error(`Failed to migrate ${m.table}.${m.column}: ${msg}`);
      }
    }
  }

  repairNullSessionKeys(db);
}

function repairNullSessionKeys(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT rowid, project_id, topic_id FROM session_mappings WHERE session_key IS NULL",
    )
    .all() as Array<{ rowid: number; project_id: string; topic_id: string }>;

  for (const row of rows) {
    const key = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
    db.prepare(
      "UPDATE session_mappings SET session_key = ? WHERE rowid = ?",
    ).run(key, row.rowid);
  }
}
