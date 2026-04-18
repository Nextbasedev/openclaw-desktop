use std::{
  collections::{HashMap, HashSet},
  fs,
  io::{Read, Write},
  path::{Component, Path, PathBuf},
  sync::{Arc, Mutex as StdMutex},
  time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use ed25519_dalek::{pkcs8::DecodePrivateKey, Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use keyring::Entry;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

#[cfg(test)]
mod cron_openclaw_tests;
#[cfg(test)]
mod git_context_tests;
#[cfg(test)]
mod memory_tests;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod usage_tests;

mod branches;
mod chat;
mod cron;
mod crud;
mod files;
mod fs_raw;
mod git;
mod memory;
mod onboarding;
mod pty;
mod skills;
mod sync;
mod terminal;
mod usage;

pub use branches::*;
pub use chat::*;
pub use cron::*;
pub use crud::*;
pub use files::*;
pub use fs_raw::*;
pub use git::*;
pub use memory::*;
pub use onboarding::*;
pub use pty::*;
pub use skills::*;
pub use sync::*;
pub use terminal::*;
pub use usage::*;

use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
  connect_async,
  tungstenite::{client::IntoClientRequest, Message},
  MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;
use walkdir::WalkDir;

const MIDDLEWARE_CONTRACT_VERSION: &str = "2026-04-17";
const DEFAULT_GATEWAY_PORT: u16 = 18789;
const PROTOCOL_VERSION: u8 = 3;
const DEFAULT_GATEWAY_ORIGIN: &str = "http://127.0.0.1:3000";
const DEFAULT_MODEL: &str = "openai-codex/gpt-5.4";
const DEFAULT_AGENT_ID: &str = "main";
const CHAT_STREAM_EVENT_NAME: &str = "middleware://chat-event";
const TERMINAL_STREAM_EVENT_NAME: &str = "middleware://terminal-event";
const PTY_STREAM_EVENT_NAME: &str = "middleware://pty-event";
const KEYCHAIN_SERVICE: &str = "ai.openclaw.jarvis";
const APP_SETTING_OPENCLAW_BOT_NAME: &str = "openclaw.bot_name";
const APP_SETTING_ONBOARDING_PROVIDER_ID: &str = "onboarding.provider.id";
const APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD: &str = "onboarding.provider.auth_method";
const APP_SETTING_ONBOARDING_PROVIDER_VALUES_PREFIX: &str = "onboarding.provider.values.";
const APP_SETTING_ONBOARDING_MODEL_REF: &str = "onboarding.model.ref";
const APP_SETTING_ONBOARDING_MODEL_PROVIDER_ID: &str = "onboarding.model.provider_id";
const APP_SETTING_SYNC_ENABLED: &str = "sync.enabled";
const APP_SETTING_SYNC_DEVICE_ID: &str = "sync.device_id";
const APP_SETTING_SYNC_DEVICE_NAME: &str = "sync.device_name";
const APP_SETTING_SYNC_LAST_SYNC_AT: &str = "sync.last_sync_at";
const SYNC_TOMBSTONE_TTL_DAYS: i64 = 30;

#[derive(Default)]
pub struct MiddlewareState {
  streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
  terminals: Arc<Mutex<HashMap<String, Arc<TerminalHandle>>>>,
}

struct TerminalHandle {
  master: StdMutex<Box<dyn MasterPty + Send>>,
  writer: StdMutex<Box<dyn Write + Send>>,
  child: StdMutex<Box<dyn Child + Send + Sync>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewareRuntimeInfo {
  contract_version: &'static str,
  transport: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewareBotNamePayload {
  bot_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewareBotNameSetInput {
  bot_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessRequestInput {
  action_id: String,
  action_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessApproveInput {
  action_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessApprover {
  id: &'static str,
  name: &'static str,
  role: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessRetryPayload {
  gateway_method: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  label: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  open_claw_flow: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessRequestPayload {
  status: &'static str,
  title: &'static str,
  message: String,
  primary_action_label: &'static str,
  secondary_action_label: &'static str,
  request_path: &'static str,
  show_approver_picker_by_default: bool,
  recommended_approvers: Vec<AdminAccessApprover>,
  retry: AdminAccessRetryPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessApprovePayload {
  status: &'static str,
  approved: bool,
  retry: AdminAccessRetryPayload,
  message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCreateSessionInput {
  label: Option<String>,
  model: Option<String>,
  agent_id: Option<String>,
  verbose_level: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionKeyInput {
  session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendInput {
  session_key: String,
  text: String,
  timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamStartInput {
  session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamStopInput {
  stream_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCreateInput {
  name: String,
  mode: String,
  gateway_url: String,
  workspace_root: String,
  token: Option<String>,
  is_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateInput {
  profile_id: String,
  name: Option<String>,
  gateway_url: Option<String>,
  workspace_root: Option<String>,
  token: Option<String>,
  is_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIdInput {
  profile_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateInput {
  name: String,
  profile_id: String,
  workspace_root: String,
  repo_root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateInput {
  project_id: String,
  name: Option<String>,
  workspace_root: Option<String>,
  repo_root: Option<String>,
  archived: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdInput {
  project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicListInput {
  project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicCreateInput {
  project_id: String,
  name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicUpdateInput {
  topic_id: String,
  name: Option<String>,
  sort_order: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicArchiveInput {
  topic_id: String,
  archived: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSessionInput {
  topic_id: String,
  session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListInput {
  project_id: Option<String>,
  topic_id: Option<String>,
  include_existing: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateMappingInput {
  project_id: String,
  topic_id: Option<String>,
  agent_id: String,
  label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdateMappingInput {
  session_key: String,
  label: Option<String>,
  pinned: Option<bool>,
  hidden: Option<bool>,
  topic_id: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePathInput {
  project_id: String,
  path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteInput {
  project_id: String,
  path: String,
  content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenameInput {
  project_id: String,
  from: String,
  to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchInput {
  project_id: String,
  query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInput {
  project_id: String,
  topic_id: Option<String>,
  cwd: Option<String>,
  title: Option<String>,
  cols: Option<u16>,
  rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInput {
  session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
  session_id: String,
  data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
  session_id: String,
  cols: u16,
  rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalListInput {
  project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnInput {
  shell: Option<String>,
  cwd: Option<String>,
  cols: Option<u16>,
  rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyWriteInput {
  pty_id: String,
  data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyResizeInput {
  pty_id: String,
  cols: u16,
  rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyKillInput {
  pty_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirInput {
  path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileInput {
  path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileInput {
  path: String,
  content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCreateDirInput {
  path: String,
  recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRemoveInput {
  path: String,
  recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRenameInput {
  old_path: String,
  new_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchInput {
  path: String,
  query: String,
  max_results: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
  pub name: String,
  pub path: String,
  pub is_file: bool,
  pub is_dir: bool,
  pub size: Option<u64>,
  pub modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMetadata {
  pub path: String,
  pub is_file: bool,
  pub is_dir: bool,
  pub size: u64,
  pub modified_at: Option<String>,
  pub created_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchResult {
  pub path: String,
  pub name: String,
  pub is_dir: bool,
}

// ============================================================================
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFullInput {
  profile_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnableInput {
  enabled: bool,
  device_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDevicesInput {
  profile_id: String,
}

// ============================================================================
// SYNC: Data types
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncState {
  schema_version: u32,
  last_writer: SyncLastWriter,
  projects: HashMap<String, SyncProject>,
  topics: HashMap<String, SyncTopic>,
  session_mappings: HashMap<String, SyncSessionMapping>,
  branches: HashMap<String, SyncBranch>,
  tombstones: Vec<SyncTombstone>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncLastWriter {
  device_id: String,
  device_name: String,
  written_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncProject {
  id: String,
  name: String,
  profile_id: String,
  workspace_root: String,
  repo_root: Option<String>,
  archived: bool,
  updated_at: String,
  updated_by: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncTopic {
  id: String,
  project_id: String,
  name: String,
  archived: bool,
  sort_order: i64,
  updated_at: String,
  updated_by: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncSessionMapping {
  session_key: String,
  session_id: Option<String>,
  project_id: Option<String>,
  topic_id: Option<String>,
  agent_id: String,
  label: String,
  status: String,
  pinned: bool,
  hidden: bool,
  source: String,
  updated_at: String,
  updated_by: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncBranch {
  id: String,
  source_session_key: String,
  source_message_id: String,
  branch_session_key: String,
  branch_topic_id: Option<String>,
  branch_reason: Option<String>,
  created_at: String,
  updated_at: String,
  updated_by: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncTombstone {
  entity_type: String,
  entity_id: String,
  deleted_at: String,
  deleted_by: String,
  expires_at: String,
}

impl SyncState {
  fn empty() -> Self {
    SyncState {
      schema_version: 1,
      last_writer: SyncLastWriter {
        device_id: String::new(),
        device_name: String::new(),
        written_at: String::new(),
      },
      projects: HashMap::new(),
      topics: HashMap::new(),
      session_mappings: HashMap::new(),
      branches: HashMap::new(),
      tombstones: Vec::new(),
    }
  }
}

struct LocalSnapshot {
  projects: Vec<SyncProject>,
  topics: Vec<SyncTopic>,
  session_mappings: Vec<SyncSessionMapping>,
  branches: Vec<SyncBranch>,
  tombstones: Vec<SyncTombstone>,
}

struct MergeResult {
  to_upsert_locally: Vec<MergeEntity>,
  to_delete_locally: Vec<(String, String)>,
  new_remote_state: SyncState,
  pulled: usize,
  pushed: usize,
  pushed_project_ids: Vec<String>,
  pushed_topic_ids: Vec<String>,
  pushed_session_keys: Vec<String>,
  pushed_branch_ids: Vec<String>,
}

#[derive(Clone)]
enum MergeEntity {
  Project(SyncProject),
  Topic(SyncTopic),
  SessionMapping(SyncSessionMapping),
  Branch(SyncBranch),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayConfig {
  gateway: Option<GatewaySection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewaySection {
  port: Option<u16>,
  auth: Option<GatewayAuth>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayAuth {
  token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
  device_id: String,
  private_key_pem: String,
}

pub(crate) type GatewaySocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

pub(crate) fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

pub(crate) fn bool_to_sql(value: bool) -> i64 {
  if value { 1 } else { 0 }
}

pub(crate) fn sql_to_bool(value: i64) -> bool {
  value != 0
}

pub(crate) fn action_label(action_id: &str, fallback: Option<&str>) -> String {
  match action_id {
    "sessions.patch" => "edit session details".to_string(),
    "sessions.reset" => "reset a session".to_string(),
    "sessions.delete" => "delete a session".to_string(),
    "settings.schema" => "open advanced settings".to_string(),
    _ => fallback.unwrap_or("continue").trim().to_string(),
  }
}

pub(crate) fn success_message(action_id: &str) -> String {
  match action_id {
    "sessions.patch" => "Admin access approved. Jarvis can now update the session.".to_string(),
    "sessions.reset" => "Admin access approved. Jarvis can now reset the session.".to_string(),
    "sessions.delete" => "Admin access approved. Jarvis can now delete the session.".to_string(),
    "settings.schema" => "Admin access approved. Jarvis can now open advanced settings.".to_string(),
    _ => "Admin access approved. Jarvis can continue.".to_string(),
  }
}

pub(crate) fn home_dir() -> Result<PathBuf, String> {
  dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())
}

pub(crate) fn jarvis_data_dir() -> Result<PathBuf, String> {
  let path = home_dir()?.join(".jarvis").join("openclaw-desktop");
  fs::create_dir_all(&path).map_err(|error| format!("Failed to create Jarvis data dir: {error}"))?;
  Ok(path)
}

pub(crate) fn sqlite_path() -> Result<PathBuf, String> {
  if let Ok(override_path) = std::env::var("JARVIS_TEST_DB_PATH") {
    return Ok(PathBuf::from(override_path));
  }
  Ok(jarvis_data_dir()?.join("jarvis.db"))
}

pub(crate) fn open_db() -> Result<Connection, String> {
  let path = sqlite_path()?;
  let conn = Connection::open(path).map_err(|error| format!("Failed to open SQLite database: {error}"))?;
  init_db(&conn)?;
  Ok(conn)
}

pub(crate) fn init_db(conn: &Connection) -> Result<(), String> {
  conn.execute_batch(
    r#"
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
    "#,
  )
  .map_err(|error| format!("Failed to initialize SQLite schema: {error}"))?;

  match conn.execute("ALTER TABLE projects ADD COLUMN remotes_json TEXT", []) {
    Ok(_) => {}
    Err(error) if error.to_string().contains("duplicate column name") => {}
    Err(error) => return Err(format!("Failed to migrate projects.remotes_json: {error}")),
  }

  // Sync: add sync_dirty column to projects, topics, session_mappings, branches
  for (table, col) in [
    ("projects", "sync_dirty"),
    ("topics", "sync_dirty"),
    ("session_mappings", "sync_dirty"),
    ("branches", "sync_dirty"),
  ] {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {col} INTEGER NOT NULL DEFAULT 1");
    match conn.execute(&sql, []) {
      Ok(_) => {}
      Err(error) if error.to_string().contains("duplicate column name") => {}
      Err(error) => return Err(format!("Failed to migrate {table}.{col}: {error}")),
    }
  }

  // Git context: track which git branch a topic is working on
  conn.execute_batch(
    r#"
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
    "#,
  )
  .map_err(|error| format!("Failed to create topic_git_context table: {error}"))?;

  // Sync: tombstones table for tracking deletions across devices
  conn.execute_batch(
    r#"
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      deleted_by TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );
    "#,
  )
  .map_err(|error| format!("Failed to create sync_tombstones table: {error}"))?;

  Ok(())
}

pub(crate) fn get_app_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
  conn
    .query_row("SELECT value FROM app_settings WHERE key = ?", params![key], |row| row.get(0))
    .optional()
    .map_err(|error| format!("Failed to read app setting: {error}"))
}

pub(crate) fn record_sync_tombstone(conn: &Connection, entity_type: &str, entity_id: &str) -> Result<(), String> {
  let now = now_iso();
  let expires_at = (chrono::Utc::now() + chrono::Duration::days(30))
    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
  let device_id = get_app_setting(conn, "sync.device_id")?.unwrap_or_default();
  conn
    .execute(
      "INSERT OR REPLACE INTO sync_tombstones (entity_type, entity_id, deleted_at, deleted_by, expires_at) VALUES (?, ?, ?, ?, ?)",
      params![entity_type, entity_id, now, device_id, expires_at],
    )
    .map_err(|error| format!("Failed to record sync tombstone: {error}"))?;
  Ok(())
}

pub(crate) fn set_app_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
  conn
    .execute(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      params![key, value, now_iso()],
    )
    .map_err(|error| format!("Failed to store app setting: {error}"))?;
  Ok(())
}

pub(crate) fn keychain_entry(profile_id: &str) -> Result<Entry, String> {
  Entry::new(KEYCHAIN_SERVICE, &format!("profile:{profile_id}:token"))
    .map_err(|error| format!("Failed to open keychain entry: {error}"))
}

pub(crate) fn set_profile_token(profile_id: &str, token: &str) -> Result<(), String> {
  keychain_entry(profile_id)?
    .set_password(token)
    .map_err(|error| format!("Failed to store token in keychain: {error}"))
}

pub(crate) fn get_profile_token(profile_id: &str) -> Result<Option<String>, String> {
  match keychain_entry(profile_id)?.get_password() {
    Ok(token) => Ok(Some(token)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(format!("Failed to read token from keychain: {error}")),
  }
}

pub(crate) fn delete_profile_token(profile_id: &str) -> Result<(), String> {
  match keychain_entry(profile_id)?.delete_credential() {
    Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(format!("Failed to delete token from keychain: {error}")),
  }
}

pub(crate) async fn read_gateway_config() -> Result<GatewayConfig, String> {
  let path = home_dir()?.join(".openclaw").join("openclaw.json");
  let raw = tokio::fs::read_to_string(path)
    .await
    .map_err(|error| format!("Failed to read OpenClaw config: {error}"))?;
  serde_json::from_str(&raw).map_err(|error| format!("Failed to parse OpenClaw config: {error}"))
}

pub(crate) fn openclaw_config_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("openclaw.json"))
}

pub(crate) fn read_openclaw_config_value() -> Result<Value, String> {
  let path = openclaw_config_path()?;
  match fs::read_to_string(&path) {
    Ok(raw) => serde_json::from_str(&raw)
      .map_err(|error| format!("Failed to parse OpenClaw config {}: {error}", path.display())),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
    Err(error) => Err(format!("Failed to read OpenClaw config {}: {error}", path.display())),
  }
}

pub(crate) fn write_openclaw_config_value(config: &Value) -> Result<(), String> {
  let path = openclaw_config_path()?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create OpenClaw config dir {}: {error}", parent.display()))?;
  }
  let raw = serde_json::to_string_pretty(config)
    .map_err(|error| format!("Failed to serialize OpenClaw config: {error}"))?;
  fs::write(&path, format!("{raw}\n"))
    .map_err(|error| format!("Failed to write OpenClaw config {}: {error}", path.display()))
}

pub(crate) fn ensure_json_object(value: &mut Value) -> &mut serde_json::Map<String, Value> {
  if !value.is_object() {
    *value = json!({});
  }
  value
    .as_object_mut()
    .expect("json value should be object after normalization")
}

pub(crate) fn set_json_path(root: &mut Value, path: &str, value: Value) {
  let parts = path.split('.').filter(|part| !part.is_empty()).collect::<Vec<_>>();
  if parts.is_empty() {
    *root = value;
    return;
  }

  let mut current = root;
  for part in &parts[..parts.len().saturating_sub(1)] {
    let object = ensure_json_object(current);
    current = object.entry((*part).to_string()).or_insert_with(|| json!({}));
  }

  if let Some(last) = parts.last() {
    ensure_json_object(current).insert((*last).to_string(), value);
  }
}

pub(crate) fn value_at_json_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
  let mut current = root;
  for part in path.split('.').filter(|part| !part.is_empty()) {
    current = current.get(part)?;
  }
  Some(current)
}

pub(crate) async fn read_device_identity() -> Result<DeviceIdentity, String> {
  let path = home_dir()?
    .join(".openclaw")
    .join("state")
    .join("identity")
    .join("device.json");
  let raw = tokio::fs::read_to_string(path)
    .await
    .map_err(|error| format!("Failed to read device identity: {error}"))?;
  serde_json::from_str(&raw).map_err(|error| format!("Failed to parse device identity: {error}"))
}

pub(crate) fn normalize_device_metadata_for_auth(value: &str) -> String {
  value.trim().to_ascii_lowercase()
}

pub(crate) fn build_device_auth_payload_v3(
  device_id: &str,
  client_id: &str,
  client_mode: &str,
  role: &str,
  scopes: &[&str],
  signed_at_ms: i64,
  token: &str,
  nonce: &str,
  platform: &str,
  device_family: &str,
) -> String {
  [
    "v3".to_string(),
    device_id.to_string(),
    client_id.to_string(),
    client_mode.to_string(),
    role.to_string(),
    scopes.join(","),
    signed_at_ms.to_string(),
    token.to_string(),
    nonce.to_string(),
    normalize_device_metadata_for_auth(platform),
    normalize_device_metadata_for_auth(device_family),
  ]
  .join("|")
}

pub(crate) fn string_from_value(value: Option<&Value>) -> Option<String> {
  value.and_then(Value::as_str).map(ToString::to_string)
}

pub(crate) fn content_blocks_to_text(content: Option<&Value>) -> String {
  match content {
    Some(Value::String(text)) => text.clone(),
    Some(Value::Array(blocks)) => blocks
      .iter()
      .filter_map(|block| {
        if let Some(text) = block.get("text").and_then(Value::as_str) {
          return Some(text.to_string());
        }
        block
          .get("content")
          .and_then(Value::as_str)
          .map(ToString::to_string)
      })
      .collect::<Vec<_>>()
      .join("\n"),
    _ => String::new(),
  }
}

pub(crate) fn tool_output_visibility(verbose_level: Option<&str>) -> &'static str {
  match verbose_level {
    Some("full") => "full",
    Some("on") => "metadata-only",
    _ => "hidden",
  }
}

pub(crate) fn timestamp_to_string(value: Option<&Value>) -> Option<String> {
  match value {
    Some(Value::String(text)) => Some(text.clone()),
    Some(Value::Number(number)) => Some(number.to_string()),
    _ => None,
  }
}

pub(crate) fn metadata_json(value: &Value) -> String {
  value.to_string()
}

pub(crate) fn default_capabilities_value() -> Value {
  json!({
    "openclaw": true,
    "files": true,
    "git": true,
    "terminal": true,
    "bootstrap": false,
  })
}

pub(crate) fn profile_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  let capabilities_json: Option<String> = row.get(8)?;
  let metadata_json_value: Option<String> = row.get(9)?;
  Ok(json!({
    "id": row.get::<_, String>(0)?,
    "name": row.get::<_, String>(1)?,
    "mode": row.get::<_, String>(2)?,
    "gatewayUrl": row.get::<_, String>(3)?,
    "workspaceRoot": row.get::<_, String>(4)?,
    "isDefault": sql_to_bool(row.get::<_, i64>(5)?),
    "status": row.get::<_, String>(6)?,
    "lastUsedAt": row.get::<_, Option<String>>(7)?,
    "lastError": row.get::<_, Option<String>>(10)?,
    "capabilities": capabilities_json.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
    "metadata": metadata_json_value.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
  }))
}

pub(crate) fn project_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  Ok(json!({
    "id": row.get::<_, String>(0)?,
    "name": row.get::<_, String>(1)?,
    "profileId": row.get::<_, String>(2)?,
    "workspaceRoot": row.get::<_, String>(3)?,
    "repoRoot": row.get::<_, Option<String>>(4)?,
    "archived": sql_to_bool(row.get::<_, i64>(5)?),
    "unreadCount": row.get::<_, i64>(6)?,
    "lastActivityAt": row.get::<_, Option<String>>(7)?,
    "createdAt": row.get::<_, String>(8)?,
    "updatedAt": row.get::<_, String>(9)?,
  }))
}

pub(crate) fn topic_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  Ok(json!({
    "id": row.get::<_, String>(0)?,
    "projectId": row.get::<_, String>(1)?,
    "name": row.get::<_, String>(2)?,
    "archived": sql_to_bool(row.get::<_, i64>(3)?),
    "unreadCount": row.get::<_, i64>(4)?,
    "sortOrder": row.get::<_, i64>(5)?,
    "createdAt": row.get::<_, String>(6)?,
    "updatedAt": row.get::<_, String>(7)?,
  }))
}

pub(crate) fn session_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  Ok(json!({
    "key": row.get::<_, String>(0)?,
    "sessionId": row.get::<_, Option<String>>(1)?,
    "projectId": row.get::<_, Option<String>>(2)?,
    "topicId": row.get::<_, Option<String>>(3)?,
    "agentId": row.get::<_, String>(4)?,
    "label": row.get::<_, String>(5)?,
    "status": row.get::<_, String>(6)?,
    "createdAt": row.get::<_, String>(7)?,
    "updatedAt": row.get::<_, String>(8)?,
    "pinned": sql_to_bool(row.get::<_, i64>(9)?),
    "hidden": sql_to_bool(row.get::<_, i64>(10)?),
    "source": row.get::<_, String>(11)?,
  }))
}

pub(crate) fn terminal_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  Ok(json!({
    "id": row.get::<_, String>(0)?,
    "projectId": row.get::<_, String>(1)?,
    "topicId": row.get::<_, Option<String>>(2)?,
    "title": row.get::<_, String>(3)?,
    "cwd": row.get::<_, String>(4)?,
    "status": row.get::<_, String>(5)?,
    "lastActiveAt": row.get::<_, String>(6)?,
    "runtimeId": row.get::<_, Option<String>>(7)?,
  }))
}

pub(crate) fn update_session_mapping_status(session_key: &str, status: &str) -> Result<(), String> {
  let conn = open_db()?;
  conn
    .execute(
      "UPDATE session_mappings SET status = ?, updated_at = ? WHERE session_key = ?",
      params![status, now_iso(), session_key],
    )
    .map_err(|error| format!("Failed to update session status: {error}"))?;
  Ok(())
}

pub(crate) fn resolve_relative_path(path: &str) -> PathBuf {
  let candidate = if path == "/" || path.is_empty() {
    PathBuf::new()
  } else {
    let trimmed = path.trim_start_matches('/');
    PathBuf::from(trimmed)
  };
  candidate
    .components()
    .filter_map(|component| match component {
      Component::Normal(part) => Some(PathBuf::from(part)),
      _ => None,
    })
    .fold(PathBuf::new(), |mut acc, part| {
      acc.push(part);
      acc
    })
}

pub(crate) fn project_workspace_root(project_id: &str) -> Result<PathBuf, String> {
  let conn = open_db()?;
  let workspace_root: Option<String> = conn
    .query_row(
      "SELECT workspace_root FROM projects WHERE id = ?1",
      params![project_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("Failed to look up project workspace root: {error}"))?;
  let workspace_root = workspace_root.ok_or_else(|| format!("Project not found: {project_id}"))?;
  Ok(PathBuf::from(workspace_root))
}

pub(crate) fn project_repo_root(project_id: &str) -> Result<PathBuf, String> {
  let conn = open_db()?;
  let row: Option<(String, Option<String>)> = conn
    .query_row(
      "SELECT workspace_root, repo_root FROM projects WHERE id = ?",
      params![project_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to look up project: {e}"))?;
  let (workspace_root, repo_root) = row.ok_or_else(|| format!("Project not found: {project_id}"))?;
  let root = repo_root.filter(|r| !r.is_empty()).unwrap_or(workspace_root);
  Ok(PathBuf::from(root))
}

pub(crate) fn resolve_project_path(project_id: &str, path: &str) -> Result<PathBuf, String> {
  let root = project_workspace_root(project_id)?;
  let resolved = root.join(resolve_relative_path(path));
  if !resolved.starts_with(&root) {
    return Err(format!("Path escapes project root: {path}"));
  }
  Ok(resolved)
}

pub(crate) fn emit_chat_stream_event(app: &AppHandle, stream_id: &str, event: Value) {
  let _ = app.emit(
    CHAT_STREAM_EVENT_NAME,
    json!({
      "streamId": stream_id,
      "event": event,
    }),
  );
}

pub(crate) fn emit_terminal_event(app: &AppHandle, session_id: &str, event: Value) {
  let _ = app.emit(
    TERMINAL_STREAM_EVENT_NAME,
    json!({
      "sessionId": session_id,
      "event": event,
    }),
  );
}

pub(crate) async fn next_json_message(socket: &mut GatewaySocket) -> Result<Value, String> {
  loop {
    match socket.next().await {
      Some(Ok(Message::Text(text))) => {
        return serde_json::from_str::<Value>(&text)
          .map_err(|error| format!("Failed to parse gateway message: {error}"));
      }
      Some(Ok(Message::Binary(bytes))) => {
        let text = String::from_utf8(bytes.to_vec())
          .map_err(|error| format!("Failed to decode gateway binary frame: {error}"))?;
        return serde_json::from_str::<Value>(&text)
          .map_err(|error| format!("Failed to parse gateway message: {error}"));
      }
      Some(Ok(Message::Ping(payload))) => {
        socket
          .send(Message::Pong(payload))
          .await
          .map_err(|error| format!("Failed to respond to gateway ping: {error}"))?;
      }
      Some(Ok(Message::Pong(_))) => {}
      Some(Ok(Message::Frame(_))) => {}
      Some(Ok(Message::Close(_))) => return Err("OpenClaw gateway closed the connection".to_string()),
      Some(Err(error)) => return Err(format!("OpenClaw gateway websocket error: {error}")),
      None => return Err("OpenClaw gateway websocket ended unexpectedly".to_string()),
    }
  }
}

pub(crate) async fn send_gateway_json(socket: &mut GatewaySocket, value: &Value) -> Result<(), String> {
  socket
    .send(Message::Text(value.to_string().into()))
    .await
    .map_err(|error| format!("Failed to send gateway message: {error}"))
}

pub(crate) async fn gateway_request(
  socket: &mut GatewaySocket,
  method: &str,
  params: Value,
  timeout_ms: u64,
) -> Result<Value, String> {
  let id = Uuid::new_v4().to_string();
  timeout(
    Duration::from_millis(timeout_ms),
    send_gateway_json(
      socket,
      &json!({
        "type": "req",
        "id": id,
        "method": method,
        "params": params,
      }),
    ),
  )
  .await
  .map_err(|_| format!("Timed out sending {method}"))??;

  timeout(Duration::from_millis(timeout_ms), async {
    loop {
      let message = next_json_message(socket).await?;
      if message.get("type").and_then(Value::as_str) != Some("res") {
        continue;
      }
      if message.get("id").and_then(Value::as_str) != Some(id.as_str()) {
        continue;
      }
      return Ok(message);
    }
  })
  .await
  .map_err(|_| format!("Timed out waiting for {method}"))?
}

pub(crate) fn extract_ok_payload(response: Value, method: &str) -> Result<Value, String> {
  let ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);
  if !ok {
    let message = response
      .get("error")
      .and_then(|error| error.get("message"))
      .and_then(Value::as_str)
      .unwrap_or("Unknown gateway error");
    return Err(format!("{method} failed: {message}"));
  }
  Ok(response.get("payload").cloned().unwrap_or(Value::Null))
}

pub(crate) async fn connect_to_gateway(scopes: &[&str]) -> Result<GatewaySocket, String> {
  let config = read_gateway_config().await?;
  let identity = read_device_identity().await?;
  let token = config
    .gateway
    .as_ref()
    .and_then(|gateway| gateway.auth.as_ref())
    .and_then(|auth| auth.token.clone())
    .ok_or_else(|| "OpenClaw gateway token is missing from local config".to_string())?;
  let port = config
    .gateway
    .as_ref()
    .and_then(|gateway| gateway.port)
    .unwrap_or(DEFAULT_GATEWAY_PORT);
  let gateway_url = format!("ws://127.0.0.1:{port}");

  let mut request = gateway_url
    .into_client_request()
    .map_err(|error| format!("Failed to build gateway websocket request: {error}"))?;
  request.headers_mut().insert(
    http::header::ORIGIN,
    http::HeaderValue::from_static(DEFAULT_GATEWAY_ORIGIN),
  );

  let (mut socket, _) = connect_async(request)
    .await
    .map_err(|error| format!("Failed to connect to OpenClaw gateway: {error}"))?;

  let challenge = timeout(Duration::from_secs(10), async {
    loop {
      let message = next_json_message(&mut socket).await?;
      if message.get("type").and_then(Value::as_str) == Some("event")
        && message.get("event").and_then(Value::as_str) == Some("connect.challenge")
      {
        return Ok::<Value, String>(message);
      }
    }
  })
  .await
  .map_err(|_| "Timed out waiting for OpenClaw connect challenge".to_string())??;

  let nonce = challenge
    .get("payload")
    .and_then(|payload| payload.get("nonce"))
    .and_then(Value::as_str)
    .ok_or_else(|| "OpenClaw connect challenge did not include a nonce".to_string())?;

  let signed_at = Utc::now().timestamp_millis();
  let signing_key = SigningKey::from_pkcs8_pem(&identity.private_key_pem)
    .map_err(|error| format!("Failed to decode OpenClaw device key: {error}"))?;
  let auth_payload = build_device_auth_payload_v3(
    &identity.device_id,
    "openclaw-control-ui",
    "webchat",
    "operator",
    scopes,
    signed_at,
    &token,
    nonce,
    "desktop",
    "",
  );
  let signature = signing_key.sign(auth_payload.as_bytes());
  let public_key = signing_key.verifying_key();

  let connect_response = gateway_request(
    &mut socket,
    "connect",
    json!({
      "minProtocol": PROTOCOL_VERSION,
      "maxProtocol": PROTOCOL_VERSION,
      "client": {
        "id": "openclaw-control-ui",
        "displayName": "Jarvis Desktop",
        "version": "0.0.1",
        "platform": "desktop",
        "mode": "webchat"
      },
      "auth": { "token": token },
      "caps": ["chat", "sessions"],
      "scopes": scopes,
      "device": {
        "id": identity.device_id,
        "publicKey": URL_SAFE_NO_PAD.encode(public_key.as_bytes()),
        "signature": URL_SAFE_NO_PAD.encode(signature.to_bytes()),
        "signedAt": signed_at,
        "nonce": nonce
      }
    }),
    15_000,
  )
  .await?;

  extract_ok_payload(connect_response, "connect")?;
  Ok(socket)
}


fn spawn_pty_reader(app: AppHandle, pty_id: String, mut reader: Box<dyn Read + Send>) {
  std::thread::spawn(move || {
    let mut buffer = [0_u8; 4096];
    loop {
      match reader.read(&mut buffer) {
        Ok(0) => {
          emit_pty_event(&app, &pty_id, json!({ "type": "pty.exit", "ptyId": pty_id }));
          break;
        }
        Ok(count) => {
          let text = String::from_utf8_lossy(&buffer[..count]).to_string();
          emit_pty_event(&app, &pty_id, json!({ "type": "pty.data", "ptyId": pty_id, "data": text }));
        }
        Err(error) => {
          emit_pty_event(&app, &pty_id, json!({ "type": "pty.error", "ptyId": pty_id, "message": error.to_string() }));
          break;
        }
      }
    }
  });
}


#[cfg(test)]
mod test_support;
#[cfg(test)]
mod runtime_admin_tests;
#[cfg(test)]
mod fs_direct_tests;
#[cfg(test)]
mod fs_alias_tests;
#[cfg(test)]
mod sqlite_local_tests;
#[cfg(test)]
mod openclaw_chat_tests;
#[cfg(test)]
mod branch_chat_tests;
#[cfg(test)]
mod onboarding_enhancements_tests;
#[cfg(test)]
mod onboarding_provider_tests;
#[cfg(test)]
mod skills_tests;


// ============================================================================
// SYNC: Tauri commands
// ============================================================================

