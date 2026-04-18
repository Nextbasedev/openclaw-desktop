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
mod sync_tests;
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
// SYNC: Input structs
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

type GatewaySocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

fn bool_to_sql(value: bool) -> i64 {
  if value { 1 } else { 0 }
}

fn sql_to_bool(value: i64) -> bool {
  value != 0
}

fn action_label(action_id: &str, fallback: Option<&str>) -> String {
  match action_id {
    "sessions.patch" => "edit session details".to_string(),
    "sessions.reset" => "reset a session".to_string(),
    "sessions.delete" => "delete a session".to_string(),
    "settings.schema" => "open advanced settings".to_string(),
    _ => fallback.unwrap_or("continue").trim().to_string(),
  }
}

fn success_message(action_id: &str) -> String {
  match action_id {
    "sessions.patch" => "Admin access approved. Jarvis can now update the session.".to_string(),
    "sessions.reset" => "Admin access approved. Jarvis can now reset the session.".to_string(),
    "sessions.delete" => "Admin access approved. Jarvis can now delete the session.".to_string(),
    "settings.schema" => "Admin access approved. Jarvis can now open advanced settings.".to_string(),
    _ => "Admin access approved. Jarvis can continue.".to_string(),
  }
}

fn home_dir() -> Result<PathBuf, String> {
  dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())
}

fn jarvis_data_dir() -> Result<PathBuf, String> {
  let path = home_dir()?.join(".jarvis").join("openclaw-desktop");
  fs::create_dir_all(&path).map_err(|error| format!("Failed to create Jarvis data dir: {error}"))?;
  Ok(path)
}

fn sqlite_path() -> Result<PathBuf, String> {
  if let Ok(override_path) = std::env::var("JARVIS_TEST_DB_PATH") {
    return Ok(PathBuf::from(override_path));
  }
  Ok(jarvis_data_dir()?.join("jarvis.db"))
}

fn open_db() -> Result<Connection, String> {
  let path = sqlite_path()?;
  let conn = Connection::open(path).map_err(|error| format!("Failed to open SQLite database: {error}"))?;
  init_db(&conn)?;
  Ok(conn)
}

fn init_db(conn: &Connection) -> Result<(), String> {
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

fn get_app_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
  conn
    .query_row("SELECT value FROM app_settings WHERE key = ?", params![key], |row| row.get(0))
    .optional()
    .map_err(|error| format!("Failed to read app setting: {error}"))
}

fn record_sync_tombstone(conn: &Connection, entity_type: &str, entity_id: &str) -> Result<(), String> {
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

fn set_app_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
  conn
    .execute(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      params![key, value, now_iso()],
    )
    .map_err(|error| format!("Failed to store app setting: {error}"))?;
  Ok(())
}

fn keychain_entry(profile_id: &str) -> Result<Entry, String> {
  Entry::new(KEYCHAIN_SERVICE, &format!("profile:{profile_id}:token"))
    .map_err(|error| format!("Failed to open keychain entry: {error}"))
}

fn set_profile_token(profile_id: &str, token: &str) -> Result<(), String> {
  keychain_entry(profile_id)?
    .set_password(token)
    .map_err(|error| format!("Failed to store token in keychain: {error}"))
}

fn get_profile_token(profile_id: &str) -> Result<Option<String>, String> {
  match keychain_entry(profile_id)?.get_password() {
    Ok(token) => Ok(Some(token)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(format!("Failed to read token from keychain: {error}")),
  }
}

fn delete_profile_token(profile_id: &str) -> Result<(), String> {
  match keychain_entry(profile_id)?.delete_credential() {
    Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(format!("Failed to delete token from keychain: {error}")),
  }
}

async fn read_gateway_config() -> Result<GatewayConfig, String> {
  let path = home_dir()?.join(".openclaw").join("openclaw.json");
  let raw = tokio::fs::read_to_string(path)
    .await
    .map_err(|error| format!("Failed to read OpenClaw config: {error}"))?;
  serde_json::from_str(&raw).map_err(|error| format!("Failed to parse OpenClaw config: {error}"))
}

fn openclaw_config_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("openclaw.json"))
}

fn read_openclaw_config_value() -> Result<Value, String> {
  let path = openclaw_config_path()?;
  match fs::read_to_string(&path) {
    Ok(raw) => serde_json::from_str(&raw)
      .map_err(|error| format!("Failed to parse OpenClaw config {}: {error}", path.display())),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
    Err(error) => Err(format!("Failed to read OpenClaw config {}: {error}", path.display())),
  }
}

fn write_openclaw_config_value(config: &Value) -> Result<(), String> {
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

fn ensure_json_object(value: &mut Value) -> &mut serde_json::Map<String, Value> {
  if !value.is_object() {
    *value = json!({});
  }
  value
    .as_object_mut()
    .expect("json value should be object after normalization")
}

fn set_json_path(root: &mut Value, path: &str, value: Value) {
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

fn value_at_json_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
  let mut current = root;
  for part in path.split('.').filter(|part| !part.is_empty()) {
    current = current.get(part)?;
  }
  Some(current)
}

async fn read_device_identity() -> Result<DeviceIdentity, String> {
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

fn normalize_device_metadata_for_auth(value: &str) -> String {
  value.trim().to_ascii_lowercase()
}

fn build_device_auth_payload_v3(
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

fn string_from_value(value: Option<&Value>) -> Option<String> {
  value.and_then(Value::as_str).map(ToString::to_string)
}

fn content_blocks_to_text(content: Option<&Value>) -> String {
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

fn tool_output_visibility(verbose_level: Option<&str>) -> &'static str {
  match verbose_level {
    Some("full") => "full",
    Some("on") => "metadata-only",
    _ => "hidden",
  }
}

fn timestamp_to_string(value: Option<&Value>) -> Option<String> {
  match value {
    Some(Value::String(text)) => Some(text.clone()),
    Some(Value::Number(number)) => Some(number.to_string()),
    _ => None,
  }
}

fn metadata_json(value: &Value) -> String {
  value.to_string()
}

fn default_capabilities_value() -> Value {
  json!({
    "openclaw": true,
    "files": true,
    "git": true,
    "terminal": true,
    "bootstrap": false,
  })
}

fn profile_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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

fn project_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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

fn topic_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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

fn session_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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

fn terminal_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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

fn update_session_mapping_status(session_key: &str, status: &str) -> Result<(), String> {
  let conn = open_db()?;
  conn
    .execute(
      "UPDATE session_mappings SET status = ?, updated_at = ? WHERE session_key = ?",
      params![status, now_iso(), session_key],
    )
    .map_err(|error| format!("Failed to update session status: {error}"))?;
  Ok(())
}

fn resolve_relative_path(path: &str) -> PathBuf {
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

fn project_workspace_root(project_id: &str) -> Result<PathBuf, String> {
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

fn resolve_project_path(project_id: &str, path: &str) -> Result<PathBuf, String> {
  let root = project_workspace_root(project_id)?;
  let resolved = root.join(resolve_relative_path(path));
  Ok(resolved)
}

fn emit_chat_stream_event(app: &AppHandle, stream_id: &str, event: Value) {
  let _ = app.emit(
    CHAT_STREAM_EVENT_NAME,
    json!({
      "streamId": stream_id,
      "event": event,
    }),
  );
}

fn emit_terminal_event(app: &AppHandle, session_id: &str, event: Value) {
  let _ = app.emit(
    TERMINAL_STREAM_EVENT_NAME,
    json!({
      "sessionId": session_id,
      "event": event,
    }),
  );
}

async fn next_json_message(socket: &mut GatewaySocket) -> Result<Value, String> {
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

async fn send_gateway_json(socket: &mut GatewaySocket, value: &Value) -> Result<(), String> {
  socket
    .send(Message::Text(value.to_string().into()))
    .await
    .map_err(|error| format!("Failed to send gateway message: {error}"))
}

async fn gateway_request(
  socket: &mut GatewaySocket,
  method: &str,
  params: Value,
  timeout_ms: u64,
) -> Result<Value, String> {
  let id = Uuid::new_v4().to_string();
  send_gateway_json(
    socket,
    &json!({
      "type": "req",
      "id": id,
      "method": method,
      "params": params,
    }),
  )
  .await?;

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

fn extract_ok_payload(response: Value, method: &str) -> Result<Value, String> {
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

async fn connect_to_gateway(scopes: &[&str]) -> Result<GatewaySocket, String> {
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

fn normalize_history(payload: &Value, session_key: &str) -> Value {
  let thinking_level = string_from_value(payload.get("thinkingLevel"));
  let verbose_level = string_from_value(payload.get("verboseLevel"));
  let messages = payload
    .get("messages")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .map(|message| {
      json!({
        "id": string_from_value(message.get("id")).unwrap_or_else(|| Uuid::new_v4().to_string()),
        "role": string_from_value(message.get("role")).unwrap_or_else(|| "assistant".to_string()),
        "content": message.get("content").cloned().unwrap_or(Value::String(String::new())),
        "text": content_blocks_to_text(message.get("content")),
        "createdAt": string_from_value(message.get("createdAt"))
          .or_else(|| timestamp_to_string(message.get("timestamp")))
          .unwrap_or_else(now_iso),
        "model": string_from_value(message.get("model")),
      })
    })
    .collect::<Vec<_>>();

  json!({
    "sessionKey": session_key,
    "thinkingLevel": thinking_level,
    "verboseLevel": verbose_level,
    "messages": messages,
  })
}

fn detect_capabilities_for_workspace(workspace_root: &str) -> Value {
  let exists = Path::new(workspace_root).exists();
  json!({
    "openclaw": true,
    "files": exists,
    "git": exists,
    "terminal": exists,
    "bootstrap": false,
  })
}

fn repo_summary_for_root(root: &str) -> Option<Value> {
  let root_path = Path::new(root);
  if !root_path.exists() {
    return None;
  }
  let output_branch = std::process::Command::new("git")
    .arg("-C")
    .arg(root)
    .arg("branch")
    .arg("--show-current")
    .output()
    .ok()?;
  if !output_branch.status.success() {
    return None;
  }
  let branch = String::from_utf8_lossy(&output_branch.stdout).trim().to_string();
  let output_dirty = std::process::Command::new("git")
    .arg("-C")
    .arg(root)
    .args(["status", "--porcelain"])
    .output()
    .ok()?;
  let dirty = !String::from_utf8_lossy(&output_dirty.stdout).trim().is_empty();
  Some(json!({ "branch": branch, "dirty": dirty }))
}

fn shell_command() -> String {
  std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

fn spawn_terminal_reader(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
  std::thread::spawn(move || {
    let mut buffer = [0_u8; 4096];
    loop {
      match reader.read(&mut buffer) {
        Ok(0) => {
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.closed",
            "sessionId": session_id,
          }));
          break;
        }
        Ok(count) => {
          let text = String::from_utf8_lossy(&buffer[..count]).to_string();
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.output",
            "sessionId": session_id,
            "data": text,
          }));
        }
        Err(error) => {
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.error",
            "sessionId": session_id,
            "message": error.to_string(),
          }));
          break;
        }
      }
    }
  });
}

#[tauri::command]
pub fn middleware_runtime_info() -> MiddlewareRuntimeInfo {
  MiddlewareRuntimeInfo {
    contract_version: MIDDLEWARE_CONTRACT_VERSION,
    transport: "tauri-ipc+gateway-ws+sqlite+keychain+pty+filesystem",
  }
}

#[tauri::command]
pub fn middleware_openclaw_bot_name_get() -> Result<MiddlewareBotNamePayload, String> {
  let conn = open_db()?;
  let bot_name = get_app_setting(&conn, APP_SETTING_OPENCLAW_BOT_NAME)?;
  Ok(MiddlewareBotNamePayload { bot_name })
}

#[tauri::command]
pub fn middleware_openclaw_bot_name_set(
  input: MiddlewareBotNameSetInput,
) -> Result<MiddlewareBotNamePayload, String> {
  let bot_name = input.bot_name.trim();
  if bot_name.is_empty() {
    return Err("Bot name cannot be empty".to_string());
  }

  let conn = open_db()?;
  set_app_setting(&conn, APP_SETTING_OPENCLAW_BOT_NAME, bot_name)?;
  Ok(MiddlewareBotNamePayload {
    bot_name: Some(bot_name.to_string()),
  })
}

#[tauri::command]
pub fn middleware_openclaw_bot_name() -> Result<MiddlewareBotNamePayload, String> {
  middleware_openclaw_bot_name_get()
}

#[tauri::command]
pub fn middleware_request_admin_access(input: AdminAccessRequestInput) -> AdminAccessRequestPayload {
  let label = action_label(&input.action_id, input.action_label.as_deref());
  AdminAccessRequestPayload {
    status: "needs_admin",
    title: "Admin access needed",
    message: format!(
      "To {}, this device needs extra permission for a sensitive action. Approve once, then Jarvis can continue automatically.",
      label
    ),
    primary_action_label: "Approve admin access",
    secondary_action_label: "Not now",
    request_path: "/api/admin-access/approve",
    show_approver_picker_by_default: false,
    recommended_approvers: vec![
      AdminAccessApprover {
        id: "owner",
        name: "Workspace owner",
        role: "Best default for fast approval",
      },
      AdminAccessApprover {
        id: "admin",
        name: "Admin operator",
        role: "Use only when someone else needs to approve",
      },
    ],
    retry: AdminAccessRetryPayload {
      gateway_method: input.action_id,
      label: Some(label),
      open_claw_flow: None,
    },
  }
}

#[tauri::command]
pub fn middleware_approve_admin_access(input: AdminAccessApproveInput) -> AdminAccessApprovePayload {
  let action_id = input.action_id;
  AdminAccessApprovePayload {
    status: "approved",
    approved: true,
    retry: AdminAccessRetryPayload {
      gateway_method: action_id.clone(),
      label: None,
      open_claw_flow: Some(vec!["connect".to_string(), action_id.clone()]),
    },
    message: success_message(&action_id),
  }
}

#[tauri::command]
pub fn middleware_profiles_list() -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn
    .prepare("SELECT id, name, mode, gateway_url, workspace_root, is_default, status, last_used_at, capabilities_json, metadata_json, last_error FROM profiles ORDER BY updated_at DESC")
    .map_err(|error| format!("Failed to prepare profile query: {error}"))?;
  let rows = stmt
    .query_map([], profile_row_to_json)
    .map_err(|error| format!("Failed to list profiles: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode profiles: {error}"))?;
  Ok(json!({ "profiles": rows }))
}

#[tauri::command]
pub fn middleware_profiles_create(input: ProfileCreateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let id = format!("prof_{}", Uuid::new_v4().simple());
  let now = now_iso();
  let capabilities = detect_capabilities_for_workspace(&input.workspace_root);
  if input.is_default.unwrap_or(false) {
    conn.execute("UPDATE profiles SET is_default = 0", [])
      .map_err(|error| format!("Failed to clear existing default profile: {error}"))?;
  }
  conn.execute(
    "INSERT INTO profiles (id, name, mode, gateway_url, workspace_root, is_default, status, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?, ?, ?)",
    params![id, input.name, input.mode, input.gateway_url, input.workspace_root, bool_to_sql(input.is_default.unwrap_or(false)), metadata_json(&capabilities), now, now],
  ).map_err(|error| format!("Failed to create profile: {error}"))?;
  if let Some(token) = input.token.as_deref() {
    set_profile_token(&id, token)?;
  }
  let mut stmt = conn.prepare("SELECT id, name, mode, gateway_url, workspace_root, is_default, status, last_used_at, capabilities_json, metadata_json, last_error FROM profiles WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created profile: {error}"))?;
  let profile = stmt.query_row(params![id], profile_row_to_json).map_err(|error| format!("Failed to decode created profile: {error}"))?;
  Ok(json!({ "profile": profile }))
}

#[tauri::command]
pub fn middleware_profiles_update(input: ProfileUpdateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let existing: Option<(String, String, String, bool)> = conn.query_row(
    "SELECT name, gateway_url, workspace_root, is_default FROM profiles WHERE id = ?",
    params![input.profile_id],
    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, sql_to_bool(row.get::<_, i64>(3)?))),
  ).optional().map_err(|error| format!("Failed to load profile for update: {error}"))?;
  let (name, gateway_url, workspace_root, current_default) = existing.ok_or_else(|| format!("Profile not found: {}", input.profile_id))?;
  let is_default = input.is_default.unwrap_or(current_default);
  if is_default {
    conn.execute("UPDATE profiles SET is_default = 0", [])
      .map_err(|error| format!("Failed to clear existing default profile: {error}"))?;
  }
  let workspace = input.workspace_root.clone().unwrap_or(workspace_root);
  let capabilities = detect_capabilities_for_workspace(&workspace);
  conn.execute(
    "UPDATE profiles SET name = ?, gateway_url = ?, workspace_root = ?, is_default = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
    params![input.name.unwrap_or(name), input.gateway_url.unwrap_or(gateway_url), workspace, bool_to_sql(is_default), metadata_json(&capabilities), now_iso(), input.profile_id],
  ).map_err(|error| format!("Failed to update profile: {error}"))?;
  if let Some(token) = input.token.as_deref() {
    set_profile_token(&input.profile_id, token)?;
  }
  let mut stmt = conn.prepare("SELECT id, name, mode, gateway_url, workspace_root, is_default, status, last_used_at, capabilities_json, metadata_json, last_error FROM profiles WHERE id = ?")
    .map_err(|error| format!("Failed to fetch updated profile: {error}"))?;
  let profile = stmt.query_row(params![input.profile_id], profile_row_to_json).map_err(|error| format!("Failed to decode updated profile: {error}"))?;
  Ok(json!({ "profile": profile }))
}

#[tauri::command]
pub fn middleware_profiles_delete(input: ProfileIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  conn.execute("DELETE FROM profiles WHERE id = ?", params![input.profile_id])
    .map_err(|error| format!("Failed to delete profile: {error}"))?;
  delete_profile_token(&input.profile_id)?;
  Ok(json!({ "ok": true, "deletedProfileId": input.profile_id }))
}

#[tauri::command]
pub fn middleware_profile_token_set(input: ProfileUpdateInput) -> Result<Value, String> {
  let token = input.token.ok_or_else(|| "token is required".to_string())?;
  set_profile_token(&input.profile_id, &token)?;
  Ok(json!({ "ok": true, "profileId": input.profile_id }))
}

#[tauri::command]
pub fn middleware_profile_token_get(input: ProfileIdInput) -> Result<Value, String> {
  Ok(json!({ "profileId": input.profile_id, "token": get_profile_token(&input.profile_id)? }))
}

#[tauri::command]
pub fn middleware_profile_token_delete(input: ProfileIdInput) -> Result<Value, String> {
  delete_profile_token(&input.profile_id)?;
  Ok(json!({ "ok": true, "profileId": input.profile_id }))
}

#[tauri::command]
pub fn middleware_environment_connect(input: ProfileIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let profile: Option<(String, String)> = conn.query_row(
    "SELECT workspace_root, gateway_url FROM profiles WHERE id = ?",
    params![input.profile_id],
    |row| Ok((row.get(0)?, row.get(1)?)),
  ).optional().map_err(|error| format!("Failed to load profile for connect: {error}"))?;
  let (workspace_root, _gateway_url) = profile.ok_or_else(|| format!("Profile not found: {}", input.profile_id))?;
  let capabilities = detect_capabilities_for_workspace(&workspace_root);
  let now = now_iso();
  conn.execute(
    "UPDATE profiles SET status = 'connected', last_used_at = ?, last_error = NULL, capabilities_json = ?, updated_at = ? WHERE id = ?",
    params![now, metadata_json(&capabilities), now_iso(), input.profile_id],
  ).map_err(|error| format!("Failed to mark profile connected: {error}"))?;
  Ok(json!({ "ok": true, "profileId": input.profile_id, "status": "connected", "capabilities": capabilities }))
}

#[tauri::command]
pub fn middleware_environment_status(input: ProfileIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let row: Option<(String, Option<String>, Option<String>)> = conn.query_row(
    "SELECT status, capabilities_json, workspace_root FROM profiles WHERE id = ?",
    params![input.profile_id],
    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
  ).optional().map_err(|error| format!("Failed to load environment status: {error}"))?;
  let (status, capabilities_json, workspace_root) = row.ok_or_else(|| format!("Profile not found: {}", input.profile_id))?;
  let capabilities = capabilities_json
    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
    .unwrap_or_else(|| detect_capabilities_for_workspace(workspace_root.as_deref().unwrap_or("")));
  Ok(json!({ "profileId": input.profile_id, "status": status, "capabilities": capabilities }))
}

#[tauri::command]
pub fn middleware_environment_detect(input: ProfileIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let workspace_root: Option<String> = conn.query_row(
    "SELECT workspace_root FROM profiles WHERE id = ?",
    params![input.profile_id],
    |row| row.get(0),
  ).optional().map_err(|error| format!("Failed to load profile for detect: {error}"))?;
  let workspace_root = workspace_root.ok_or_else(|| format!("Profile not found: {}", input.profile_id))?;
  Ok(json!({ "capabilities": detect_capabilities_for_workspace(&workspace_root) }))
}

#[tauri::command]
pub fn middleware_projects_list() -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at FROM projects ORDER BY updated_at DESC")
    .map_err(|error| format!("Failed to prepare projects query: {error}"))?;
  let projects = stmt
    .query_map([], project_row_to_json)
    .map_err(|error| format!("Failed to list projects: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode projects: {error}"))?;
  Ok(json!({ "projects": projects }))
}

#[tauri::command]
pub fn middleware_projects_create(input: ProjectCreateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let id = format!("proj_{}", Uuid::new_v4().simple());
  let now = now_iso();
  conn.execute(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)",
    params![id, input.name, input.profile_id, input.workspace_root, input.repo_root, now, now],
  ).map_err(|error| format!("Failed to create project: {error}"))?;
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at FROM projects WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created project: {error}"))?;
  let project = stmt.query_row(params![id], project_row_to_json).map_err(|error| format!("Failed to decode created project: {error}"))?;
  Ok(json!({ "project": project }))
}

#[tauri::command]
pub fn middleware_projects_get(input: ProjectIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at FROM projects WHERE id = ?")
    .map_err(|error| format!("Failed to prepare project fetch: {error}"))?;
  let project = stmt.query_row(params![input.project_id], project_row_to_json).optional().map_err(|error| format!("Failed to fetch project: {error}"))?
    .ok_or_else(|| "Project not found".to_string())?;
  let repo_root = project.get("repoRoot").and_then(Value::as_str).or_else(|| project.get("workspaceRoot").and_then(Value::as_str)).unwrap_or("");
  let mut object = project.as_object().cloned().ok_or_else(|| "Project payload was not an object".to_string())?;
  object.insert("repo".to_string(), repo_summary_for_root(repo_root).unwrap_or(Value::Null));
  Ok(json!({ "project": Value::Object(object) }))
}

#[tauri::command]
pub fn middleware_projects_update(input: ProjectUpdateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let existing: Option<(String, String, Option<String>, bool)> = conn.query_row(
    "SELECT name, workspace_root, repo_root, archived FROM projects WHERE id = ?",
    params![input.project_id],
    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, sql_to_bool(row.get::<_, i64>(3)?))),
  ).optional().map_err(|error| format!("Failed to load project for update: {error}"))?;
  let (name, workspace_root, repo_root, archived) = existing.ok_or_else(|| format!("Project not found: {}", input.project_id))?;
  conn.execute(
    "UPDATE projects SET name = ?, workspace_root = ?, repo_root = ?, archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![input.name.unwrap_or(name), input.workspace_root.unwrap_or(workspace_root), input.repo_root.or(repo_root), bool_to_sql(input.archived.unwrap_or(archived)), now_iso(), input.project_id],
  ).map_err(|error| format!("Failed to update project: {error}"))?;
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at FROM projects WHERE id = ?")
    .map_err(|error| format!("Failed to fetch updated project: {error}"))?;
  let project = stmt.query_row(params![input.project_id], project_row_to_json).map_err(|error| format!("Failed to decode updated project: {error}"))?;
  Ok(json!({ "project": project }))
}

#[tauri::command]
pub fn middleware_projects_archive(input: ProjectUpdateInput) -> Result<Value, String> {
  let archived = input.archived.unwrap_or(true);
  let conn = open_db()?;
  conn.execute(
    "UPDATE projects SET archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![bool_to_sql(archived), now_iso(), input.project_id],
  ).map_err(|error| format!("Failed to archive project: {error}"))?;
  Ok(json!({ "ok": true, "projectId": input.project_id, "archived": archived }))
}

#[tauri::command]
pub fn middleware_projects_sidebar(input: ProjectIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let project: Option<(String,)> = conn.query_row(
    "SELECT name FROM projects WHERE id = ?",
    params![input.project_id],
    |row| Ok((row.get(0)?,)),
  ).optional().map_err(|error| format!("Failed to load project sidebar: {error}"))?;
  let (project_name,) = project.ok_or_else(|| format!("Project not found: {}", input.project_id))?;

  let mut topics_stmt = conn.prepare("SELECT id, project_id, name, archived, unread_count, sort_order, created_at, updated_at FROM topics WHERE project_id = ? AND archived = 0 ORDER BY sort_order ASC, updated_at DESC")
    .map_err(|error| format!("Failed to prepare topics sidebar query: {error}"))?;
  let topics = topics_stmt
    .query_map(params![input.project_id.clone()], topic_row_to_json)
    .map_err(|error| format!("Failed to load sidebar topics: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode sidebar topics: {error}"))?;

  let mut sessions_stmt = conn.prepare("SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source FROM session_mappings WHERE project_id = ? AND hidden = 0 ORDER BY pinned DESC, updated_at DESC")
    .map_err(|error| format!("Failed to prepare sidebar sessions query: {error}"))?;
  let sessions = sessions_stmt
    .query_map(params![input.project_id], session_row_to_json)
    .map_err(|error| format!("Failed to load sidebar sessions: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode sidebar sessions: {error}"))?
    .into_iter()
    .map(|session| json!({
      "key": session.get("key").cloned().unwrap_or(Value::Null),
      "title": session.get("label").cloned().unwrap_or(Value::Null),
      "status": session.get("status").cloned().unwrap_or(Value::Null),
    }))
    .collect::<Vec<_>>();

  Ok(json!({
    "project": { "id": input.project_id, "name": project_name },
    "topics": topics.into_iter().map(|topic| json!({
      "id": topic.get("id").cloned().unwrap_or(Value::Null),
      "name": topic.get("name").cloned().unwrap_or(Value::Null),
      "unreadCount": topic.get("unreadCount").cloned().unwrap_or(Value::Null),
    })).collect::<Vec<_>>(),
    "agents": [{ "id": "main", "name": "Main", "status": "online" }],
    "sessions": sessions,
    "sessionVisibility": "jarvis-only",
  }))
}

#[tauri::command]
pub fn middleware_topics_list(input: TopicListInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, project_id, name, archived, unread_count, sort_order, created_at, updated_at FROM topics WHERE project_id = ? ORDER BY sort_order ASC, updated_at DESC")
    .map_err(|error| format!("Failed to prepare topics query: {error}"))?;
  let topics = stmt
    .query_map(params![input.project_id], topic_row_to_json)
    .map_err(|error| format!("Failed to list topics: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode topics: {error}"))?;
  Ok(json!({ "topics": topics }))
}

#[tauri::command]
pub fn middleware_topics_create(input: TopicCreateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let id = format!("topic_{}", Uuid::new_v4().simple());
  let sort_order: i64 = conn.query_row(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM topics WHERE project_id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|error| format!("Failed to compute topic sort order: {error}"))?;
  let now = now_iso();
  conn.execute(
    "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
    params![id, input.project_id, input.name, sort_order, now, now],
  ).map_err(|error| format!("Failed to create topic: {error}"))?;
  let mut stmt = conn.prepare("SELECT id, project_id, name, archived, unread_count, sort_order, created_at, updated_at FROM topics WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created topic: {error}"))?;
  let topic = stmt.query_row(params![id], topic_row_to_json).map_err(|error| format!("Failed to decode created topic: {error}"))?;
  Ok(json!({ "topic": topic }))
}

#[tauri::command]
pub fn middleware_topics_update(input: TopicUpdateInput) -> Result<Value, String> {
  let conn = open_db()?;
  let existing: Option<(String, i64)> = conn.query_row(
    "SELECT name, sort_order FROM topics WHERE id = ?",
    params![input.topic_id],
    |row| Ok((row.get(0)?, row.get(1)?)),
  ).optional().map_err(|error| format!("Failed to load topic for update: {error}"))?;
  let (name, sort_order) = existing.ok_or_else(|| format!("Topic not found: {}", input.topic_id))?;
  conn.execute(
    "UPDATE topics SET name = ?, sort_order = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![input.name.unwrap_or(name), input.sort_order.unwrap_or(sort_order), now_iso(), input.topic_id],
  ).map_err(|error| format!("Failed to update topic: {error}"))?;
  let mut stmt = conn.prepare("SELECT id, project_id, name, archived, unread_count, sort_order, created_at, updated_at FROM topics WHERE id = ?")
    .map_err(|error| format!("Failed to fetch updated topic: {error}"))?;
  let topic = stmt.query_row(params![input.topic_id], topic_row_to_json).map_err(|error| format!("Failed to decode updated topic: {error}"))?;
  Ok(json!({ "topic": topic }))
}

#[tauri::command]
pub fn middleware_topics_archive(input: TopicArchiveInput) -> Result<Value, String> {
  let archived = input.archived.unwrap_or(true);
  let conn = open_db()?;
  conn.execute(
    "UPDATE topics SET archived = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![bool_to_sql(archived), now_iso(), input.topic_id],
  ).map_err(|error| format!("Failed to archive topic: {error}"))?;
  Ok(json!({ "ok": true, "topicId": input.topic_id, "archived": archived }))
}

#[tauri::command]
pub fn middleware_topics_attach_session(input: TopicSessionInput) -> Result<Value, String> {
  let conn = open_db()?;
  conn.execute(
    "UPDATE session_mappings SET topic_id = ?, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
    params![input.topic_id, now_iso(), input.session_key],
  ).map_err(|error| format!("Failed to attach session to topic: {error}"))?;
  Ok(json!({ "ok": true, "topicId": input.topic_id, "sessionKey": input.session_key }))
}

#[tauri::command]
pub fn middleware_topics_detach_session(input: TopicSessionInput) -> Result<Value, String> {
  let conn = open_db()?;
  conn.execute(
    "UPDATE session_mappings SET topic_id = NULL, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
    params![now_iso(), input.session_key],
  ).map_err(|error| format!("Failed to detach session from topic: {error}"))?;
  Ok(json!({ "ok": true, "topicId": input.topic_id, "sessionKey": input.session_key }))
}

#[tauri::command]
pub fn middleware_sessions_list(input: Option<SessionListInput>) -> Result<Value, String> {
  let conn = open_db()?;
  let filter = input.unwrap_or(SessionListInput { project_id: None, topic_id: None, include_existing: None });
  let mut sql = "SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source FROM session_mappings WHERE 1=1".to_string();
  let mut values: Vec<String> = vec![];
  if let Some(project_id) = filter.project_id.as_ref() {
    sql.push_str(" AND project_id = ?");
    values.push(project_id.clone());
  }
  if let Some(topic_id) = filter.topic_id.as_ref() {
    sql.push_str(" AND topic_id = ?");
    values.push(topic_id.clone());
  }
  if !filter.include_existing.unwrap_or(false) {
    sql.push_str(" AND source = 'jarvis'");
  }
  sql.push_str(" ORDER BY pinned DESC, updated_at DESC");
  let mut stmt = conn.prepare(&sql).map_err(|error| format!("Failed to prepare session list query: {error}"))?;
  let sessions = match values.len() {
    0 => stmt.query_map([], session_row_to_json),
    1 => stmt.query_map(params![values[0].clone()], session_row_to_json),
    _ => stmt.query_map(params![values[0].clone(), values[1].clone()], session_row_to_json),
  }
  .map_err(|error| format!("Failed to list sessions: {error}"))?
  .collect::<Result<Vec<_>, _>>()
  .map_err(|error| format!("Failed to decode sessions: {error}"))?;
  Ok(json!({ "sessions": sessions, "sessionVisibility": if filter.include_existing.unwrap_or(false) { "all-visible" } else { "jarvis-only" } }))
}

#[tauri::command]
pub async fn middleware_sessions_create(input: SessionCreateMappingInput) -> Result<Value, String> {
  let created = middleware_chat_create_session(ChatCreateSessionInput {
    label: Some(input.label.clone()),
    model: None,
    agent_id: Some(input.agent_id.clone()),
    verbose_level: Some("full".to_string()),
  }).await?;
  let session_key = created.get("sessionKey").and_then(Value::as_str).ok_or_else(|| "chat create session failed to return sessionKey".to_string())?.to_string();
  let conn = open_db()?;
  let now = now_iso();
  conn.execute(
    "INSERT OR REPLACE INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, ?, ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    params![session_key, input.project_id, input.topic_id, input.agent_id, input.label, now, now],
  ).map_err(|error| format!("Failed to store session mapping: {error}"))?;
  let mut stmt = conn.prepare("SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source FROM session_mappings WHERE session_key = ?")
    .map_err(|error| format!("Failed to fetch created session mapping: {error}"))?;
  let session = stmt.query_row(params![session_key], session_row_to_json).map_err(|error| format!("Failed to decode created session mapping: {error}"))?;
  Ok(json!({ "session": session }))
}

#[tauri::command]
pub fn middleware_sessions_update(input: SessionUpdateMappingInput) -> Result<Value, String> {
  let conn = open_db()?;
  let existing: Option<(String, bool, bool, Option<String>)> = conn.query_row(
    "SELECT label, pinned, hidden, topic_id FROM session_mappings WHERE session_key = ?",
    params![input.session_key],
    |row| Ok((row.get(0)?, sql_to_bool(row.get::<_, i64>(1)?), sql_to_bool(row.get::<_, i64>(2)?), row.get(3)?)),
  ).optional().map_err(|error| format!("Failed to load session mapping for update: {error}"))?;
  let (label, pinned, hidden, topic_id) = existing.ok_or_else(|| format!("Session mapping not found: {}", input.session_key))?;
  let next_topic_id = input.topic_id.unwrap_or(topic_id);
  conn.execute(
    "UPDATE session_mappings SET label = ?, pinned = ?, hidden = ?, topic_id = ?, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
    params![input.label.unwrap_or(label), bool_to_sql(input.pinned.unwrap_or(pinned)), bool_to_sql(input.hidden.unwrap_or(hidden)), next_topic_id, now_iso(), input.session_key],
  ).map_err(|error| format!("Failed to update session mapping: {error}"))?;
  let mut stmt = conn.prepare("SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source FROM session_mappings WHERE session_key = ?")
    .map_err(|error| format!("Failed to fetch updated session mapping: {error}"))?;
  let session = stmt.query_row(params![input.session_key], session_row_to_json).map_err(|error| format!("Failed to decode updated session mapping: {error}"))?;
  Ok(json!({ "session": session }))
}

#[tauri::command]
pub async fn middleware_sessions_reset(input: SessionKeyInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals", "operator.admin"]).await?;
  extract_ok_payload(
    gateway_request(&mut socket, "sessions.reset", json!({ "key": input.session_key }), 30_000).await?,
    "sessions.reset",
  )?;
  let _ = socket.close(None).await;
  update_session_mapping_status(&input.session_key, "idle")?;
  Ok(json!({ "ok": true, "sessionKey": input.session_key }))
}

#[tauri::command]
pub async fn middleware_sessions_delete(input: SessionKeyInput) -> Result<Value, String> {
  let conn = open_db()?;
  record_sync_tombstone(&conn, "session_mapping", &input.session_key)?;
  conn.execute("DELETE FROM session_mappings WHERE session_key = ?", params![input.session_key])
    .map_err(|error| format!("Failed to delete session mapping: {error}"))?;
  middleware_chat_delete_session(SessionKeyInput { session_key: input.session_key.clone() }).await?;
  Ok(json!({ "ok": true, "sessionKey": input.session_key }))
}

#[tauri::command]
pub fn middleware_files_tree(input: FilePathInput) -> Result<Value, String> {
  let path = resolve_project_path(&input.project_id, &input.path)?;
  let mut nodes = vec![];
  for entry in fs::read_dir(&path).map_err(|error| format!("Failed to read directory: {error}"))? {
    let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
    let metadata = entry.metadata().map_err(|error| format!("Failed to read file metadata: {error}"))?;
    nodes.push(json!({
      "name": entry.file_name().to_string_lossy().to_string(),
      "path": format!("{}/{}", input.path.trim_end_matches('/'), entry.file_name().to_string_lossy()).replace("//", "/"),
      "type": if metadata.is_dir() { "directory" } else { "file" },
      "size": if metadata.is_file() { Some(metadata.len()) } else { None::<u64> },
      "modifiedAt": metadata.modified().ok().map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339()),
    }));
  }
  nodes.sort_by(|a, b| a.get("name").and_then(Value::as_str).cmp(&b.get("name").and_then(Value::as_str)));
  Ok(json!({ "nodes": nodes }))
}

#[tauri::command]
pub fn middleware_files_read(input: FilePathInput) -> Result<Value, String> {
  let path = resolve_project_path(&input.project_id, &input.path)?;
  let content = fs::read_to_string(&path).map_err(|error| format!("Failed to read file: {error}"))?;
  Ok(json!({ "file": { "path": input.path, "content": content, "encoding": "utf8" } }))
}

#[tauri::command]
pub fn middleware_files_write(input: FileWriteInput) -> Result<Value, String> {
  let path = resolve_project_path(&input.project_id, &input.path)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create parent directories: {error}"))?;
  }
  fs::write(&path, input.content).map_err(|error| format!("Failed to write file: {error}"))?;
  Ok(json!({ "ok": true, "path": input.path }))
}

#[tauri::command]
pub fn middleware_files_mkdir(input: FilePathInput) -> Result<Value, String> {
  let path = resolve_project_path(&input.project_id, &input.path)?;
  fs::create_dir_all(&path).map_err(|error| format!("Failed to create directory: {error}"))?;
  Ok(json!({ "ok": true, "path": input.path }))
}

#[tauri::command]
pub fn middleware_files_rename(input: FileRenameInput) -> Result<Value, String> {
  let from = resolve_project_path(&input.project_id, &input.from)?;
  let to = resolve_project_path(&input.project_id, &input.to)?;
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create target parent directories: {error}"))?;
  }
  fs::rename(from, to).map_err(|error| format!("Failed to rename path: {error}"))?;
  Ok(json!({ "ok": true, "from": input.from, "to": input.to }))
}

#[tauri::command]
pub fn middleware_files_delete(input: FilePathInput) -> Result<Value, String> {
  let path = resolve_project_path(&input.project_id, &input.path)?;
  if path.is_dir() {
    fs::remove_dir_all(&path).map_err(|error| format!("Failed to delete directory: {error}"))?;
  } else {
    fs::remove_file(&path).map_err(|error| format!("Failed to delete file: {error}"))?;
  }
  Ok(json!({ "ok": true, "path": input.path }))
}

#[tauri::command]
pub fn middleware_files_search(input: FileSearchInput) -> Result<Value, String> {
  let root = project_workspace_root(&input.project_id)?;
  let query = input.query.to_lowercase();
  let mut results = vec![];
  for entry in WalkDir::new(&root)
    .max_depth(6)
    .into_iter()
    .filter_map(|entry| entry.ok())
  {
    let file_name = entry.file_name().to_string_lossy().to_string();
    if !file_name.to_lowercase().contains(&query) {
      continue;
    }
    let metadata: Option<std::fs::Metadata> = entry.metadata().ok();
    let relative = entry.path().strip_prefix(&root).unwrap_or(entry.path()).to_string_lossy().to_string();
    results.push(json!({
      "name": file_name,
      "path": format!("/{}", relative),
      "type": if entry.file_type().is_dir() { "directory" } else { "file" },
      "size": metadata.as_ref().and_then(|m: &std::fs::Metadata| if m.is_file() { Some(m.len()) } else { None }),
      "modifiedAt": metadata.and_then(|m: std::fs::Metadata| m.modified().ok()).map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339()),
    }));
  }
  Ok(json!({ "results": results }))
}

#[tauri::command]
pub fn middleware_terminal_list(input: TerminalListInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id FROM terminal_sessions WHERE project_id = ? ORDER BY last_active_at DESC")
    .map_err(|error| format!("Failed to prepare terminal list query: {error}"))?;
  let terminals = stmt
    .query_map(params![input.project_id], terminal_row_to_json)
    .map_err(|error| format!("Failed to list terminal sessions: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode terminal sessions: {error}"))?;
  Ok(json!({ "terminals": terminals }))
}

#[tauri::command]
pub async fn middleware_terminal_create(
  app: AppHandle,
  state: State<'_, MiddlewareState>,
  input: TerminalCreateInput,
) -> Result<Value, String> {
  let project_root = project_workspace_root(&input.project_id)?;
  let cwd = input.cwd.clone().map(PathBuf::from).unwrap_or(project_root);
  let title = input.title.unwrap_or_else(|| "Terminal".to_string());
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: input.rows.unwrap_or(30),
      cols: input.cols.unwrap_or(120),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to open PTY: {error}"))?;

  let mut command = CommandBuilder::new(shell_command());
  command.cwd(cwd.clone());
  let child = pair.slave.spawn_command(command).map_err(|error| format!("Failed to spawn shell: {error}"))?;
  let reader = pair.master.try_clone_reader().map_err(|error| format!("Failed to create PTY reader: {error}"))?;
  let writer = pair.master.take_writer().map_err(|error| format!("Failed to create PTY writer: {error}"))?;

  let id = format!("term_{}", Uuid::new_v4().simple());
  let runtime_id = Uuid::new_v4().to_string();
  let handle = Arc::new(TerminalHandle {
    master: StdMutex::new(pair.master),
    writer: StdMutex::new(writer),
    child: StdMutex::new(child),
  });
  state.terminals.lock().await.insert(id.clone(), handle);
  spawn_terminal_reader(app, id.clone(), reader);

  let conn = open_db()?;
  conn.execute(
    "INSERT OR REPLACE INTO terminal_sessions (id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
    params![id, input.project_id, input.topic_id, title, cwd.to_string_lossy().to_string(), now_iso(), runtime_id],
  ).map_err(|error| format!("Failed to store terminal session: {error}"))?;

  let mut stmt = conn.prepare("SELECT id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id FROM terminal_sessions WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created terminal session: {error}"))?;
  let terminal = stmt.query_row(params![id], terminal_row_to_json).map_err(|error| format!("Failed to decode created terminal session: {error}"))?;
  Ok(json!({ "terminal": terminal }))
}

#[tauri::command]
pub async fn middleware_terminal_write(
  state: State<'_, MiddlewareState>,
  input: TerminalWriteInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.session_id).cloned().ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  drop(terminals);
  handle
    .writer
    .lock()
    .map_err(|_| "Failed to lock PTY writer".to_string())?
    .write_all(input.data.as_bytes())
    .map_err(|error| format!("Failed to write to PTY: {error}"))?;
  let conn = open_db()?;
  conn.execute("UPDATE terminal_sessions SET last_active_at = ? WHERE id = ?", params![now_iso(), input.session_id])
    .map_err(|error| format!("Failed to update terminal last_active_at: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}

#[tauri::command]
pub async fn middleware_terminal_resize(
  state: State<'_, MiddlewareState>,
  input: TerminalResizeInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.session_id).cloned().ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  drop(terminals);
  handle
    .master
    .lock()
    .map_err(|_| "Failed to lock PTY master".to_string())?
    .resize(PtySize {
      rows: input.rows,
      cols: input.cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to resize PTY: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}

#[tauri::command]
pub async fn middleware_terminal_close(
  state: State<'_, MiddlewareState>,
  input: TerminalSessionInput,
) -> Result<Value, String> {
  let handle = state.terminals.lock().await.remove(&input.session_id).ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  handle
    .child
    .lock()
    .map_err(|_| "Failed to lock PTY child".to_string())?
    .kill()
    .map_err(|error| format!("Failed to kill PTY child: {error}"))?;
  let conn = open_db()?;
  conn.execute("UPDATE terminal_sessions SET status = 'closed', last_active_at = ? WHERE id = ?", params![now_iso(), input.session_id])
    .map_err(|error| format!("Failed to mark terminal closed: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}

async fn spawn_stream_loop(app: AppHandle, stream_id: String, session_key: String, mut socket: GatewaySocket, mut stop_rx: oneshot::Receiver<()>) {
  let mut seen_tool_events = HashSet::<String>::new();
  let mut seen_message_ids = HashSet::<String>::new();

  loop {
    tokio::select! {
      _ = &mut stop_rx => {
        let _ = socket.close(None).await;
        break;
      }
      next = next_json_message(&mut socket) => {
        let message = match next {
          Ok(message) => message,
          Err(error) => {
            emit_chat_stream_event(&app, &stream_id, json!({
              "type": "chat.error",
              "sessionKey": session_key,
              "message": error,
            }));
            let _ = update_session_mapping_status(&session_key, "error");
            break;
          }
        };

        if message.get("type").and_then(Value::as_str) != Some("event") {
          continue;
        }

        match message.get("event").and_then(Value::as_str) {
          Some("session.message") => {
            let payload = match message.get("payload") {
              Some(payload) => payload,
              None => continue,
            };
            if payload.get("sessionKey").and_then(Value::as_str) != Some(session_key.as_str()) {
              continue;
            }
            let chat_message = match payload.get("message") {
              Some(message) => message,
              None => continue,
            };

            let message_id = string_from_value(chat_message.get("id"))
              .or_else(|| string_from_value(payload.get("messageId")));
            if let Some(message_id) = message_id.as_ref() {
              if seen_message_ids.contains(message_id) {
                continue;
              }
              seen_message_ids.insert(message_id.clone());
            }

            let role = string_from_value(chat_message.get("role")).unwrap_or_else(|| "assistant".to_string());
            if role == "user" || role == "tool" || role == "tool_result" || role == "toolResult" {
              continue;
            }

            let block_types = chat_message
              .get("content")
              .and_then(Value::as_array)
              .map(|blocks| {
                blocks
                  .iter()
                  .filter_map(|block| block.get("type").and_then(Value::as_str).map(ToString::to_string))
                  .collect::<Vec<_>>()
              })
              .unwrap_or_default();

            if block_types.iter().any(|block_type| block_type == "toolCall" || block_type == "tool_use") {
              emit_chat_stream_event(&app, &stream_id, json!({
                "type": "chat.status",
                "sessionKey": session_key,
                "state": "tool_running",
              }));
              let _ = update_session_mapping_status(&session_key, "running");
              continue;
            }

            let text = content_blocks_to_text(chat_message.get("content"));
            emit_chat_stream_event(&app, &stream_id, json!({
              "type": "chat.message",
              "sessionKey": session_key,
              "messageId": message_id,
              "role": role,
              "content": chat_message.get("content").cloned().unwrap_or(Value::String(String::new())),
              "text": text,
              "createdAt": string_from_value(chat_message.get("createdAt"))
                .or_else(|| timestamp_to_string(chat_message.get("timestamp"))),
              "model": string_from_value(chat_message.get("model")),
            }));
            emit_chat_stream_event(&app, &stream_id, json!({
              "type": "chat.status",
              "sessionKey": session_key,
              "state": if text.is_empty() { "streaming" } else { "done" },
            }));
            let _ = update_session_mapping_status(&session_key, if text.is_empty() { "running" } else { "completed" });
          }
          Some("session.tool") => {
            let payload = match message.get("payload") {
              Some(payload) => payload,
              None => continue,
            };
            if payload.get("sessionKey").and_then(Value::as_str) != Some(session_key.as_str()) {
              continue;
            }
            let data = match payload.get("data") {
              Some(data) => data,
              None => continue,
            };
            let key = format!(
              "{}:{}:{}",
              payload.get("runId").and_then(Value::as_str).unwrap_or("run"),
              payload.get("seq").map(Value::to_string).unwrap_or_else(|| string_from_value(data.get("toolCallId")).unwrap_or_else(|| "tool".to_string())),
              data.get("phase").and_then(Value::as_str).unwrap_or("phase")
            );
            if seen_tool_events.contains(&key) {
              continue;
            }
            seen_tool_events.insert(key);

            let verbose_level = string_from_value(payload.get("verboseLevel"));
            emit_chat_stream_event(&app, &stream_id, json!({
              "type": "chat.tool",
              "sessionKey": session_key,
              "runId": string_from_value(payload.get("runId")),
              "verboseLevel": verbose_level,
              "toolOutputVisibility": tool_output_visibility(payload.get("verboseLevel").and_then(Value::as_str)),
              "phase": string_from_value(data.get("phase")),
              "name": string_from_value(data.get("name")),
              "toolCallId": string_from_value(data.get("toolCallId")),
              "args": data.get("args").cloned(),
              "partialResult": data.get("partialResult").cloned(),
              "result": data.get("result").cloned(),
              "error": string_from_value(data.get("error")),
            }));
            emit_chat_stream_event(&app, &stream_id, json!({
              "type": "chat.status",
              "sessionKey": session_key,
              "state": match data.get("phase").and_then(Value::as_str) {
                Some("error") => "error",
                Some("result") => "thinking",
                _ => "tool_running",
              },
              "label": string_from_value(data.get("name")),
            }));
            let _ = update_session_mapping_status(&session_key, if data.get("phase").and_then(Value::as_str) == Some("error") { "error" } else { "running" });
          }
          _ => {}
        }
      }
    }
  }
}

#[tauri::command]
pub async fn middleware_chat_create_session(input: ChatCreateSessionInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals", "operator.admin"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "sessions.create",
      json!({
        "agentId": input.agent_id.unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
        "label": input.label.unwrap_or_else(|| format!("Jarvis desktop session {}", Utc::now().to_rfc3339())),
        "model": input.model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
      }),
      30_000,
    )
    .await?,
    "sessions.create",
  )?;

  let session_key = string_from_value(payload.get("key"))
    .ok_or_else(|| "sessions.create did not return a session key".to_string())?;

  if let Some(verbose_level) = input.verbose_level {
    extract_ok_payload(
      gateway_request(
        &mut socket,
        "sessions.patch",
        json!({
          "key": session_key,
          "verboseLevel": verbose_level,
        }),
        30_000,
      )
      .await?,
      "sessions.patch",
    )?;
  }

  let _ = socket.close(None).await;
  Ok(json!({ "sessionKey": session_key }))
}

#[tauri::command]
pub async fn middleware_chat_delete_session(input: SessionKeyInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals", "operator.admin"]).await?;
  extract_ok_payload(
    gateway_request(
      &mut socket,
      "sessions.delete",
      json!({
        "key": input.session_key,
        "deleteTranscript": true,
      }),
      30_000,
    )
    .await?,
    "sessions.delete",
  )?;
  let _ = socket.close(None).await;
  Ok(json!({ "deleted": true, "sessionKey": input.session_key }))
}

#[tauri::command]
pub async fn middleware_chat_history(input: SessionKeyInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "chat.history",
      json!({
        "sessionKey": input.session_key,
        "limit": 200,
      }),
      30_000,
    )
    .await?,
    "chat.history",
  )?;
  let _ = socket.close(None).await;
  Ok(normalize_history(&payload, &input.session_key))
}

#[tauri::command]
pub async fn middleware_chat_send(input: ChatSendInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "chat.send",
      json!({
        "sessionKey": input.session_key,
        "message": input.text,
        "timeoutMs": input.timeout_ms.unwrap_or(60_000),
        "idempotencyKey": Uuid::new_v4().to_string(),
      }),
      65_000,
    )
    .await?,
    "chat.send",
  )?;
  let _ = socket.close(None).await;
  let _ = update_session_mapping_status(&input.session_key, "running");
  Ok(json!({
    "accepted": true,
    "sessionKey": input.session_key,
    "runId": string_from_value(payload.get("runId")),
    "status": string_from_value(payload.get("status")).unwrap_or_else(|| "started".to_string()),
  }))
}

#[tauri::command]
pub async fn middleware_chat_stream_start(
  app: AppHandle,
  state: State<'_, MiddlewareState>,
  input: ChatStreamStartInput,
) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals"]).await?;
  let history_payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "chat.history",
      json!({
        "sessionKey": input.session_key,
        "limit": 20,
      }),
      30_000,
    )
    .await?,
    "chat.history",
  )?;
  extract_ok_payload(gateway_request(&mut socket, "sessions.subscribe", json!({}), 15_000).await?, "sessions.subscribe")?;
  extract_ok_payload(
    gateway_request(
      &mut socket,
      "sessions.messages.subscribe",
      json!({ "key": input.session_key }),
      15_000,
    )
    .await?,
    "sessions.messages.subscribe",
  )?;

  let stream_id = Uuid::new_v4().to_string();
  let verbose_level = history_payload
    .get("verboseLevel")
    .and_then(Value::as_str)
    .map(ToString::to_string);

  emit_chat_stream_event(&app, &stream_id, json!({
    "type": "chat.ready",
    "sessionKey": input.session_key,
    "thinkingLevel": string_from_value(history_payload.get("thinkingLevel")),
    "verboseLevel": verbose_level,
    "toolOutputVisibility": tool_output_visibility(history_payload.get("verboseLevel").and_then(Value::as_str)),
    "recentMessages": history_payload
      .get("messages")
      .and_then(Value::as_array)
      .cloned()
      .unwrap_or_default()
      .into_iter()
      .rev()
      .take(5)
      .collect::<Vec<_>>()
      .into_iter()
      .rev()
      .map(|message| json!({
        "id": string_from_value(message.get("id")),
        "role": string_from_value(message.get("role")).unwrap_or_else(|| "assistant".to_string()),
        "text": content_blocks_to_text(message.get("content")),
        "createdAt": string_from_value(message.get("createdAt"))
          .or_else(|| timestamp_to_string(message.get("timestamp"))),
        "model": string_from_value(message.get("model")),
      }))
      .collect::<Vec<_>>(),
  }));
  emit_chat_stream_event(&app, &stream_id, json!({
    "type": "chat.status",
    "sessionKey": input.session_key,
    "state": "connected",
  }));

  let (stop_tx, stop_rx) = oneshot::channel();
  state.streams.lock().await.insert(stream_id.clone(), stop_tx);
  tauri::async_runtime::spawn(spawn_stream_loop(app.clone(), stream_id.clone(), input.session_key.clone(), socket, stop_rx));

  Ok(json!({
    "streamId": stream_id,
    "sessionKey": input.session_key,
  }))
}

#[tauri::command]
pub async fn middleware_chat_stream_stop(
  state: State<'_, MiddlewareState>,
  input: ChatStreamStopInput,
) -> Result<Value, String> {
  if let Some(stop_tx) = state.streams.lock().await.remove(&input.stream_id) {
    let _ = stop_tx.send(());
    return Ok(json!({ "stopped": true, "streamId": input.stream_id }));
  }
  Ok(json!({ "stopped": false, "streamId": input.stream_id }))
}

// ============================================================================
// CRON MIDDLEWARE COMMANDS
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronListJobsInput {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronGetJobInput {
  job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronCreateJobInput {
  name: String,
  schedule: String,
  task: String,
  params: Option<Value>,
  enabled: Option<bool>,
  metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronUpdateJobInput {
  job_id: String,
  name: Option<String>,
  schedule: Option<String>,
  task: Option<String>,
  params: Option<Value>,
  enabled: Option<bool>,
  metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronDeleteJobInput {
  job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRunJobInput {
  job_id: String,
  params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobStatusInput {
  job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronListRunsInput {
  job_id: String,
  limit: Option<u32>,
  sort_dir: Option<String>,
  after_ts: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronGetRunInput {
  job_id: String,
  run_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronPauseJobInput {
  job_id: String,
  paused: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronPollRunCompletionInput {
  job_id: String,
  after_ts: i64,
  timeout_ms: Option<u64>,
  interval_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronCreateNotificationJobInput {
  name: String,
  schedule: String,
  notification_message: String,
  session_key: String,
}

fn parse_cron_schedule(schedule: &str) -> Result<Value, String> {
  let trimmed = schedule.trim();
  if trimmed.is_empty() {
    return Err("Cron schedule cannot be empty".to_string());
  }

  Ok(json!({
    "kind": "cron",
    "expr": trimmed,
  }))
}

fn is_invalid_cron_params_error(error: &str, method: &str) -> bool {
  error.contains(&format!("{method} failed: invalid {method} params"))
}

fn legacy_cron_schedule(schedule: &str) -> Value {
  json!(schedule.trim())
}

fn legacy_cron_run_params(input: &CronRunJobInput) -> Value {
  json!({
    "id": input.job_id,
    "params": input.params,
  })
}

fn cron_task_to_job_fields(task: &str, params: Option<Value>, _metadata: Option<Value>) -> Result<Value, String> {
  match task {
    "session.message" => {
      let params_obj = params
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| "session.message cron job requires params object".to_string())?;
      let session_key = params_obj
        .get("key")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session.message cron job requires params.key".to_string())?;
      let message = params_obj
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session.message cron job requires params.message".to_string())?;

      Ok(json!({
        "sessionTarget": format!("session:{session_key}"),
        "wakeMode": "now",
        "sessionKey": session_key,
        "payload": {
          "kind": "agentTurn",
          "message": message,
        },
        "delivery": {
          "mode": "none"
        }
      }))
    }
    "system.event" => {
      let params_obj = params
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| "system.event cron job requires params object".to_string())?;
      let text = params_obj
        .get("text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "system.event cron job requires params.text".to_string())?;

      Ok(json!({
        "sessionTarget": "main",
        "wakeMode": "next-heartbeat",
        "payload": {
          "kind": "systemEvent",
          "text": text,
        }
      }))
    }
    _ => Err(format!("Unsupported cron task: {task}")),
  }
}

fn normalize_cron_schedule(value: &Value) -> String {
  match value.get("kind").and_then(Value::as_str) {
    Some("cron") => value
      .get("expr")
      .and_then(Value::as_str)
      .unwrap_or_default()
      .to_string(),
    Some("at") => value.get("at").and_then(Value::as_str).unwrap_or_default().to_string(),
    Some("every") => value
      .get("everyMs")
      .and_then(Value::as_i64)
      .map(|ms| format!("every:{ms}"))
      .unwrap_or_default(),
    _ => string_from_value(Some(value)).unwrap_or_default(),
  }
}

fn normalize_cron_job(value: &Value) -> Value {
  let raw_job = value.get("job").unwrap_or(value);
  let payload = raw_job.get("payload").unwrap_or(&Value::Null);
  let legacy_params = raw_job.get("params").cloned();
  let session_key = string_from_value(raw_job.get("sessionKey")).or_else(|| {
    legacy_params
      .as_ref()
      .and_then(Value::as_object)
      .and_then(|params| params.get("key"))
      .and_then(Value::as_str)
      .map(ToString::to_string)
  });
  let task = match payload.get("kind").and_then(Value::as_str) {
    Some("agentTurn") => "session.message".to_string(),
    Some("systemEvent") => "system.event".to_string(),
    _ => string_from_value(raw_job.get("task")).unwrap_or_default(),
  };
  let params = match payload.get("kind").and_then(Value::as_str) {
    Some("agentTurn") => Some(json!({
      "key": session_key,
      "message": payload.get("message").and_then(Value::as_str),
    })),
    Some("systemEvent") => Some(json!({
      "text": payload.get("text").and_then(Value::as_str),
    })),
    _ => legacy_params,
  };
  let state = raw_job.get("state").unwrap_or(&Value::Null);

  json!({
    "id": string_from_value(raw_job.get("id")),
    "name": string_from_value(raw_job.get("name")).unwrap_or_default(),
    "schedule": normalize_cron_schedule(raw_job.get("schedule").unwrap_or(&Value::Null)),
    "enabled": raw_job.get("enabled").and_then(Value::as_bool).unwrap_or(true),
    "task": task,
    "params": params,
    "lastRunAt": timestamp_to_string(state.get("lastRunAtMs").or_else(|| raw_job.get("lastRunAtMs")).or_else(|| raw_job.get("lastRunAt"))),
    "nextRunAt": timestamp_to_string(state.get("nextRunAtMs").or_else(|| raw_job.get("nextRunAtMs")).or_else(|| raw_job.get("nextRunAt"))),
    "createdAt": timestamp_to_string(raw_job.get("createdAtMs").or_else(|| raw_job.get("createdAt"))).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "updatedAt": timestamp_to_string(raw_job.get("updatedAtMs").or_else(|| raw_job.get("updatedAt"))).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "status": string_from_value(state.get("lastRunStatus").or_else(|| state.get("lastStatus")).or_else(|| raw_job.get("status"))).unwrap_or_else(|| "idle".to_string()),
    "runCount": raw_job.get("runCount").and_then(Value::as_i64).unwrap_or(0),
    "failCount": state.get("consecutiveErrors").and_then(Value::as_i64).or_else(|| raw_job.get("failCount").and_then(Value::as_i64)).unwrap_or(0),
    "metadata": raw_job.get("metadata").cloned(),
    "sessionTarget": string_from_value(raw_job.get("sessionTarget")),
    "payload": raw_job.get("payload").cloned(),
    "delivery": raw_job.get("delivery").cloned(),
    "sessionKey": session_key,
  })
}

fn normalize_cron_run(value: &Value) -> Value {
  let raw_run = value.get("run").unwrap_or(value);
  json!({
    "id": string_from_value(raw_run.get("id")),
    "jobId": string_from_value(raw_run.get("jobId")),
    "status": string_from_value(raw_run.get("status")).unwrap_or_else(|| "unknown".to_string()),
    "startedAt": timestamp_to_string(raw_run.get("startedAt").or_else(|| raw_run.get("startedAtMs"))),
    "completedAt": timestamp_to_string(raw_run.get("completedAt").or_else(|| raw_run.get("completedAtMs"))),
    "summary": string_from_value(raw_run.get("summary")),
    "error": string_from_value(raw_run.get("error")),
    "output": string_from_value(raw_run.get("output")),
    "deliveryStatus": string_from_value(raw_run.get("deliveryStatus")),
    "metadata": raw_run.get("metadata").cloned(),
    "sessionKey": string_from_value(raw_run.get("sessionKey")),
  })
}

#[tauri::command]
pub async fn middleware_cron_list_jobs(_input: CronListJobsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let payload = extract_ok_payload(
    gateway_request(&mut socket, "cron.list", json!({ "includeDisabled": true }), 30_000).await?,
    "cron.list",
  )?;
  let _ = socket.close(None).await;

  let jobs = payload
    .get("jobs")
    .and_then(Value::as_array)
    .map(|arr| arr.iter().map(normalize_cron_job).collect::<Vec<_>>())
    .unwrap_or_default();

  Ok(json!({ "jobs": jobs }))
}

#[tauri::command]
pub async fn middleware_cron_get_job(input: CronGetJobInput) -> Result<Value, String> {
  let listed = middleware_cron_list_jobs(CronListJobsInput {}).await?;
  let jobs = listed
    .get("jobs")
    .and_then(Value::as_array)
    .ok_or("Failed to list jobs")?;

  let job = jobs
    .iter()
    .find(|entry| entry.get("id").and_then(Value::as_str) == Some(input.job_id.as_str()))
    .cloned()
    .ok_or("Job not found")?;

  Ok(json!({
    "job": job,
    "currentRun": Value::Null,
  }))
}

#[tauri::command]
pub async fn middleware_cron_create_job(input: CronCreateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  let schedule = parse_cron_schedule(&input.schedule)?;
  let job_fields = cron_task_to_job_fields(&input.task, input.params.clone(), input.metadata.clone())?;
  let new_params = json!({
    "name": input.name,
    "schedule": schedule,
    "enabled": input.enabled.unwrap_or(true),
    "sessionTarget": job_fields.get("sessionTarget").cloned().unwrap_or(Value::Null),
    "wakeMode": job_fields.get("wakeMode").cloned().unwrap_or(Value::Null),
    "sessionKey": job_fields.get("sessionKey").cloned().unwrap_or(Value::Null),
    "payload": job_fields.get("payload").cloned().unwrap_or(Value::Null),
    "delivery": job_fields.get("delivery").cloned().unwrap_or(Value::Null),
  });
  let legacy_params = json!({
    "name": input.name,
    "schedule": legacy_cron_schedule(&input.schedule),
    "task": input.task,
    "params": input.params,
    "enabled": input.enabled.unwrap_or(true),
    "metadata": input.metadata,
  });

  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.add", new_params, 30_000).await?,
    "cron.add",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.add") => extract_ok_payload(
      gateway_request(&mut socket, "cron.add", legacy_params, 30_000).await?,
      "cron.add",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let job = normalize_cron_job(&payload);
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_update_job(input: CronUpdateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;

  let mut patch = json!({});
  let mut legacy_update_params = json!({ "id": input.job_id });
  if let Some(name) = input.name.clone() {
    patch["name"] = json!(name.clone());
    legacy_update_params["name"] = json!(name);
  }
  if let Some(schedule) = input.schedule.clone() {
    patch["schedule"] = parse_cron_schedule(&schedule)?;
    legacy_update_params["schedule"] = legacy_cron_schedule(&schedule);
  }
  if input.task.is_some() || input.params.is_some() || input.metadata.is_some() {
    let task = input.task.clone().unwrap_or_else(|| "session.message".to_string());
    let job_fields = cron_task_to_job_fields(&task, input.params.clone(), input.metadata.clone())?;
    if let Some(value) = job_fields.get("sessionTarget") {
      patch["sessionTarget"] = value.clone();
    }
    if let Some(value) = job_fields.get("wakeMode") {
      patch["wakeMode"] = value.clone();
    }
    if let Some(value) = job_fields.get("sessionKey") {
      patch["sessionKey"] = value.clone();
    }
    if let Some(value) = job_fields.get("payload") {
      patch["payload"] = value.clone();
    }
    if let Some(value) = job_fields.get("delivery") {
      patch["delivery"] = value.clone();
    }
    legacy_update_params["task"] = json!(task);
    legacy_update_params["params"] = input.params.clone().unwrap_or(Value::Null);
    legacy_update_params["metadata"] = input.metadata.clone().unwrap_or(Value::Null);
  }
  if let Some(enabled) = input.enabled {
    patch["enabled"] = json!(enabled);
    legacy_update_params["enabled"] = json!(enabled);
  }

  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.update", json!({ "id": input.job_id, "patch": patch }), 30_000).await?,
    "cron.update",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.update") => extract_ok_payload(
      gateway_request(&mut socket, "cron.update", legacy_update_params, 30_000).await?,
      "cron.update",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let job = normalize_cron_job(&payload);
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_delete_job(input: CronDeleteJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  extract_ok_payload(
    gateway_request(&mut socket, "cron.remove", json!({ "id": input.job_id }), 30_000).await?,
    "cron.remove",
  )?;
  let _ = socket.close(None).await;

  Ok(json!({ "ok": true, "jobId": input.job_id }))
}

#[tauri::command]
pub async fn middleware_cron_run_job(input: CronRunJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  let new_params = json!({
    "id": input.job_id,
    "mode": "force",
  });
  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.run", new_params, 60_000).await?,
    "cron.run",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.run") => extract_ok_payload(
      gateway_request(&mut socket, "cron.run", legacy_cron_run_params(&input), 60_000).await?,
      "cron.run",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  Ok(json!({
    "runId": string_from_value(payload.get("runId")),
    "jobId": input.job_id,
    "status": if payload.get("enqueued").and_then(Value::as_bool).unwrap_or(false) { "queued".to_string() } else { string_from_value(payload.get("status")).unwrap_or_else(|| "started".to_string()) },
  }))
}

#[tauri::command]
pub async fn middleware_cron_job_status(input: CronJobStatusInput) -> Result<Value, String> {
  middleware_cron_get_job(CronGetJobInput { job_id: input.job_id }).await
}

#[tauri::command]
pub async fn middleware_cron_list_runs(input: CronListRunsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let new_params = json!({
    "id": input.job_id,
    "limit": input.limit.unwrap_or(20),
    "sortDir": input.sort_dir.as_deref().unwrap_or("desc"),
  });
  let legacy_params = json!({
    "id": input.job_id,
    "limit": input.limit.unwrap_or(20),
    "sortDir": input.sort_dir.as_deref().unwrap_or("desc"),
    "afterTs": input.after_ts,
  });
  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.runs", new_params, 30_000).await?,
    "cron.runs",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.runs") => extract_ok_payload(
      gateway_request(&mut socket, "cron.runs", legacy_params, 30_000).await?,
      "cron.runs",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let runs = payload
    .get("entries")
    .and_then(Value::as_array)
    .map(|arr| {
      arr
        .iter()
        .filter(|entry| {
          input.after_ts.map_or(true, |after_ts| {
            entry
              .get("startedAtMs")
              .and_then(Value::as_i64)
              .or_else(|| entry.get("completedAtMs").and_then(Value::as_i64))
              .map(|ts| ts > after_ts)
              .unwrap_or(true)
          })
        })
        .map(normalize_cron_run)
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  Ok(json!({ "jobId": input.job_id, "runs": runs }))
}

#[tauri::command]
pub async fn middleware_cron_get_run(input: CronGetRunInput) -> Result<Value, String> {
  // cron.runs returns a list; we need to find the specific run
  let runs_result = middleware_cron_list_runs(CronListRunsInput {
    job_id: input.job_id.clone(),
    limit: Some(100),
    sort_dir: Some("desc".to_string()),
    after_ts: None,
  }).await?;

  let runs = runs_result
    .get("runs")
    .and_then(Value::as_array)
    .ok_or("Failed to fetch runs")?;

  let run = runs
    .iter()
    .find(|r| {
      r.get("id")
        .and_then(Value::as_str)
        .map(|id| id == input.run_id)
        .unwrap_or(false)
    })
    .cloned()
    .ok_or("Run not found")?;

  Ok(json!({ "run": run }))
}

#[tauri::command]
pub async fn middleware_cron_pause_job(input: CronPauseJobInput) -> Result<Value, String> {
  middleware_cron_update_job(CronUpdateJobInput {
    job_id: input.job_id,
    name: None,
    schedule: None,
    task: None,
    params: None,
    enabled: Some(!input.paused),
    metadata: None,
  }).await
}

#[tauri::command]
pub async fn middleware_cron_poll_run_completion(
  input: CronPollRunCompletionInput,
) -> Result<Value, String> {
  let timeout_ms = input.timeout_ms.unwrap_or(90_000);
  let interval_ms = input.interval_ms.unwrap_or(1_000);
  let started_at = std::time::Instant::now();
  let after_ts = input.after_ts;

  loop {
    if started_at.elapsed().as_millis() > timeout_ms as u128 {
      return Err(format!(
        "Timed out waiting for cron run completion for job {}",
        input.job_id
      ));
    }

    let runs_result = middleware_cron_list_runs(CronListRunsInput {
      job_id: input.job_id.clone(),
      limit: Some(20),
      sort_dir: Some("desc".to_string()),
      after_ts: Some(after_ts),
    }).await?;

    let runs = runs_result
      .get("runs")
      .and_then(Value::as_array)
      .unwrap_or(&vec![])
      .clone();

    if let Some(completed) = runs.iter().find(|r| {
      let status = r
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
      status == "ok" || status == "error" || status == "skipped"
    }) {
      return Ok(json!({ "completed": true, "run": completed }));
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
  }
}

#[tauri::command]
pub async fn middleware_cron_create_notification_job(
  input: CronCreateNotificationJobInput,
) -> Result<Value, String> {
  // Create a cron job that sends a message to a session when triggered
  // The session subscription will then push the notification to Jarvis UI in real-time
  let task = "session.message";
  let params = json!({
    "key": input.session_key,
    "message": input.notification_message,
  });

  middleware_cron_create_job(CronCreateJobInput {
    name: input.name,
    schedule: input.schedule,
    task: task.to_string(),
    params: Some(params),
    enabled: Some(true),
    metadata: Some(json!({
      "type": "notification",
      "sessionKey": input.session_key,
    })),
  }).await
}

fn emit_pty_event(app: &AppHandle, pty_id: &str, event: Value) {
  let _ = app.emit(
    PTY_STREAM_EVENT_NAME,
    json!({
      "ptyId": pty_id,
      "event": event,
    }),
  );
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

#[tauri::command]
pub async fn middleware_pty_spawn(
  app: AppHandle,
  state: State<'_, MiddlewareState>,
  input: PtySpawnInput,
) -> Result<Value, String> {
  let cwd = input
    .cwd
    .clone()
    .map(PathBuf::from)
    .unwrap_or(std::env::current_dir().map_err(|e| format!("Failed to resolve current dir: {e}"))?);
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: input.rows.unwrap_or(24),
      cols: input.cols.unwrap_or(80),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("Failed to open PTY: {e}"))?;

  let shell = input.shell.unwrap_or_else(shell_command);
  let mut command = CommandBuilder::new(shell);
  command.cwd(cwd.clone());
  let child = pair.slave.spawn_command(command).map_err(|e| format!("Failed to spawn shell: {e}"))?;
  let reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to create PTY reader: {e}"))?;
  let writer = pair.master.take_writer().map_err(|e| format!("Failed to create PTY writer: {e}"))?;

  let pty_id = format!("pty_{}", Uuid::new_v4().simple());
  let handle = Arc::new(TerminalHandle {
    master: StdMutex::new(pair.master),
    writer: StdMutex::new(writer),
    child: StdMutex::new(child),
  });
  state.terminals.lock().await.insert(pty_id.clone(), handle);
  spawn_pty_reader(app, pty_id.clone(), reader);

  Ok(json!({ "ptyId": pty_id, "cwd": cwd.to_string_lossy().to_string() }))
}

#[tauri::command]
pub async fn middleware_pty_write(
  state: State<'_, MiddlewareState>,
  input: PtyWriteInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.pty_id).cloned().ok_or_else(|| format!("PTY session not found: {}", input.pty_id))?;
  drop(terminals);
  handle
    .writer
    .lock()
    .map_err(|_| "Failed to lock PTY writer".to_string())?
    .write_all(input.data.as_bytes())
    .map_err(|e| format!("Failed to write to PTY: {e}"))?;
  Ok(json!({ "written": true, "ptyId": input.pty_id }))
}

#[tauri::command]
pub async fn middleware_pty_resize(
  state: State<'_, MiddlewareState>,
  input: PtyResizeInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.pty_id).cloned().ok_or_else(|| format!("PTY session not found: {}", input.pty_id))?;
  drop(terminals);
  handle
    .master
    .lock()
    .map_err(|_| "Failed to lock PTY master".to_string())?
    .resize(PtySize {
      rows: input.rows,
      cols: input.cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("Failed to resize PTY: {e}"))?;
  Ok(json!({ "resized": true, "ptyId": input.pty_id }))
}

#[tauri::command]
pub async fn middleware_pty_kill(
  state: State<'_, MiddlewareState>,
  input: PtyKillInput,
) -> Result<Value, String> {
  let handle = state.terminals.lock().await.remove(&input.pty_id);
  if let Some(handle) = handle {
    let _ = handle.child.lock().map_err(|_| "Failed to lock PTY child".to_string())?.kill();
    return Ok(json!({ "killed": true, "ptyId": input.pty_id }));
  }
  Ok(json!({ "killed": false, "ptyId": input.pty_id }))
}

#[tauri::command]
pub async fn middleware_fs_read_dir(input: FsReadDirInput) -> Result<Value, String> {
  let path = PathBuf::from(&input.path);
  let mut entries = Vec::new();
  let mut dir = tokio::fs::read_dir(&path).await.map_err(|e| format!("Failed to read directory: {e}"))?;
  while let Some(entry) = dir.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
    let name = entry.file_name().to_string_lossy().to_string();
    let entry_path = entry.path().to_string_lossy().to_string();
    let metadata = entry.metadata().await.ok();
    entries.push(FsDirEntry {
      name,
      path: entry_path,
      is_file: metadata.as_ref().map(|m| m.is_file()).unwrap_or(false),
      is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
      size: metadata.as_ref().map(|m| m.len()),
      modified_at: metadata.as_ref().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
    });
  }
  Ok(json!({ "entries": entries }))
}

#[tauri::command]
pub async fn middleware_fs_read_file(input: FsReadFileInput) -> Result<Value, String> {
  let content = tokio::fs::read(&input.path).await.map_err(|e| format!("Failed to read file: {e}"))?;
  match String::from_utf8(content.clone()) {
    Ok(text) => Ok(json!({ "content": text, "encoding": "utf-8" })),
    Err(_) => Ok(json!({ "content": URL_SAFE_NO_PAD.encode(&content), "encoding": "base64" })),
  }
}

#[tauri::command]
pub async fn middleware_fs_write_file(input: FsWriteFileInput) -> Result<Value, String> {
  if let Some(parent) = PathBuf::from(&input.path).parent() {
    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Failed to create parent directory: {e}"))?;
  }
  tokio::fs::write(&input.path, input.content.as_bytes()).await.map_err(|e| format!("Failed to write file: {e}"))?;
  Ok(json!({ "written": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_create_dir(input: FsCreateDirInput) -> Result<Value, String> {
  if input.recursive.unwrap_or(false) {
    tokio::fs::create_dir_all(&input.path).await.map_err(|e| format!("Failed to create directory: {e}"))?;
  } else {
    tokio::fs::create_dir(&input.path).await.map_err(|e| format!("Failed to create directory: {e}"))?;
  }
  Ok(json!({ "created": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_remove(input: FsRemoveInput) -> Result<Value, String> {
  let metadata = tokio::fs::metadata(&input.path).await.map_err(|e| format!("Failed to get metadata: {e}"))?;
  if metadata.is_dir() {
    if input.recursive.unwrap_or(false) {
      tokio::fs::remove_dir_all(&input.path).await.map_err(|e| format!("Failed to remove directory: {e}"))?;
    } else {
      tokio::fs::remove_dir(&input.path).await.map_err(|e| format!("Failed to remove directory: {e}"))?;
    }
  } else {
    tokio::fs::remove_file(&input.path).await.map_err(|e| format!("Failed to remove file: {e}"))?;
  }
  Ok(json!({ "removed": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_rename(input: FsRenameInput) -> Result<Value, String> {
  tokio::fs::rename(&input.old_path, &input.new_path).await.map_err(|e| format!("Failed to rename: {e}"))?;
  Ok(json!({ "renamed": true, "oldPath": input.old_path, "newPath": input.new_path }))
}

#[tauri::command]
pub async fn middleware_fs_metadata(input: FsReadFileInput) -> Result<Value, String> {
  let metadata = tokio::fs::metadata(&input.path).await.map_err(|e| format!("Failed to get metadata: {e}"))?;
  Ok(json!({
    "path": input.path,
    "isFile": metadata.is_file(),
    "isDir": metadata.is_dir(),
    "size": metadata.len(),
    "modifiedAt": metadata.modified().ok().map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
    "createdAt": metadata.created().ok().map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
  }))
}

#[tauri::command]
pub async fn middleware_fs_search(input: FsSearchInput) -> Result<Value, String> {
  let root = PathBuf::from(&input.path);
  let query = input.query.to_lowercase();
  let max_results = input.max_results.unwrap_or(100);
  let mut results = Vec::new();

  async fn search_recursive(dir: &std::path::Path, query: &str, results: &mut Vec<FsSearchResult>, max_results: usize) -> Result<(), String> {
    let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| format!("Failed to read directory: {e}"))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
      if results.len() >= max_results { return Ok(()); }
      let name = entry.file_name().to_string_lossy().to_string();
      let path = entry.path();
      let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
      if name.to_lowercase().contains(query) {
        results.push(FsSearchResult { path: path.to_string_lossy().to_string(), name, is_dir });
      }
      if is_dir {
        Box::pin(search_recursive(&path, query, results, max_results)).await?;
      }
    }
    Ok(())
  }

  if root.is_dir() {
    search_recursive(&root, &query, &mut results, max_results).await?;
  }

  Ok(json!({ "results": results, "query": input.query, "count": results.len() }))
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
// BRANCH CHAT MIDDLEWARE COMMANDS
// ============================================================================
// Conversation branching/forking - creates new topic from message point

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateInput {
  source_session_key: String,
  source_message_id: String,
  project_id: String,
  branch_name: String,
  branch_reason: Option<String>, // 'regenerate', 'edit', 'manual', 'thread'
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchListInput {
  source_session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchGetInput {
  branch_session_key: String,
}

fn branch_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
  let metadata_json: Option<String> = row.get(7)?;
  Ok(json!({
    "id": row.get::<_, String>(0)?,
    "sourceSessionKey": row.get::<_, String>(1)?,
    "sourceMessageId": row.get::<_, String>(2)?,
    "branchSessionKey": row.get::<_, String>(3)?,
    "branchTopicId": row.get::<_, Option<String>>(4)?,
    "branchReason": row.get::<_, Option<String>>(5)?,
    "createdAt": row.get::<_, String>(6)?,
    "metadata": metadata_json.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
  }))
}

#[tauri::command]
pub async fn middleware_branch_create(
  input: BranchCreateInput,
) -> Result<Value, String> {
  let history = middleware_chat_history(SessionKeyInput { session_key: input.source_session_key.clone() }).await?;

  let new_session = middleware_chat_create_session(ChatCreateSessionInput {
    label: Some(input.branch_name.clone()),
    model: None,
    agent_id: Some("main".to_string()),
    verbose_level: Some("full".to_string()),
  }).await?;

  let branch_session_key = new_session
    .get("sessionKey")
    .and_then(Value::as_str)
    .ok_or("Failed to create branch session")?
    .to_string();

  let conn = open_db()?;
  let topic_id = format!("topic_{}", Uuid::new_v4().simple());
  let now = now_iso();
  let sort_order: i64 = conn.query_row(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM topics WHERE project_id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|error| format!("Failed to compute topic sort order: {error}"))?;

  conn.execute(
    "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
    params![topic_id, input.project_id, input.branch_name, sort_order, now, now],
  ).map_err(|error| format!("Failed to create branch topic: {error}"))?;

  conn.execute(
    "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, 'main', ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    params![branch_session_key, input.project_id, topic_id, input.branch_name, now, now],
  ).map_err(|error| format!("Failed to store branch session mapping: {error}"))?;

  let branch_id = format!("branch_{}", Uuid::new_v4().simple());
  conn.execute(
    "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    params![
      branch_id,
      input.source_session_key,
      input.source_message_id,
      branch_session_key,
      topic_id,
      input.branch_reason.unwrap_or_else(|| "manual".to_string()),
      now,
      metadata_json(&json!({"history": history}))
    ],
  ).map_err(|error| format!("Failed to store branch relationship: {error}"))?;

  let mut stmt = conn.prepare("SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json FROM branches WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created branch: {error}"))?;
  let branch = stmt.query_row(params![branch_id], branch_row_to_json)
    .map_err(|error| format!("Failed to decode created branch: {error}"))?;

  Ok(json!({
    "branch": branch,
    "topicId": topic_id,
    "sessionKey": branch_session_key,
  }))
}

#[tauri::command]
pub fn middleware_branch_list(input: BranchListInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare(
    "SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json FROM branches WHERE source_session_key = ? ORDER BY created_at DESC"
  ).map_err(|error| format!("Failed to prepare branch list query: {error}"))?;

  let branches = stmt
    .query_map(params![input.source_session_key], branch_row_to_json)
    .map_err(|error| format!("Failed to list branches: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode branches: {error}"))?;

  Ok(json!({ "branches": branches }))
}

#[tauri::command]
pub fn middleware_branch_get(input: BranchGetInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare(
    "SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json FROM branches WHERE branch_session_key = ?"
  ).map_err(|error| format!("Failed to prepare branch fetch: {error}"))?;

  let branch = stmt.query_row(params![input.branch_session_key], branch_row_to_json)
    .optional()
    .map_err(|error| format!("Failed to fetch branch: {error}"))?
    .ok_or_else(|| "Branch not found".to_string())?;

  Ok(json!({ "branch": branch }))
}

#[tauri::command]
pub fn middleware_branch_delete(input: BranchGetInput) -> Result<Value, String> {
  let conn = open_db()?;

  let branch_topic_id: Option<String> = conn.query_row(
    "SELECT branch_topic_id FROM branches WHERE branch_session_key = ?",
    params![input.branch_session_key],
    |row| row.get(0),
  ).optional().map_err(|error| format!("Failed to find branch: {error}"))?;

  let topic_id = branch_topic_id.ok_or("Branch not found")?;

  record_sync_tombstone(&conn, "branch", &input.branch_session_key)?;
  conn.execute(
    "DELETE FROM branches WHERE branch_session_key = ?",
    params![input.branch_session_key],
  ).map_err(|error| format!("Failed to delete branch: {error}"))?;

  conn.execute(
    "UPDATE topics SET archived = 1, updated_at = ? WHERE id = ?",
    params![now_iso(), topic_id],
  ).map_err(|error| format!("Failed to archive branch topic: {error}"))?;

  Ok(json!({
    "deleted": true,
    "branchSessionKey": input.branch_session_key,
    "topicArchived": topic_id,
  }))
}

// ============================================================================
// BRANCH CHAT HELPERS
// ============================================================================

#[tauri::command]
pub async fn middleware_branch_from_regenerate(
  source_session_key: String,
  source_message_id: String,
  project_id: String,
) -> Result<Value, String> {
  middleware_branch_create(BranchCreateInput {
    source_session_key,
    source_message_id: source_message_id.clone(),
    project_id,
    branch_name: format!("Regenerated {}", &source_message_id[..8.min(source_message_id.len())]),
    branch_reason: Some("regenerate".to_string()),
  }).await
}

#[tauri::command]
pub async fn middleware_branch_from_edit(
  source_session_key: String,
  source_message_id: String,
  project_id: String,
  new_message: String,
) -> Result<Value, String> {
  let result = middleware_branch_create(BranchCreateInput {
    source_session_key: source_session_key.clone(),
    source_message_id: source_message_id.clone(),
    project_id: project_id.clone(),
    branch_name: format!("Edit {}", &source_message_id[..8.min(source_message_id.len())]),
    branch_reason: Some("edit".to_string()),
  }).await?;

  let branch_session_key = result
    .get("sessionKey")
    .and_then(Value::as_str)
    .ok_or("Failed to get branch session key")?
    .to_string();

  middleware_chat_send(ChatSendInput {
    session_key: branch_session_key,
    text: new_message,
    timeout_ms: Some(60_000),
  }).await?;

  Ok(result)
}

#[tauri::command]
pub async fn middleware_branch_create_thread(
  source_session_key: String,
  source_message_id: String,
  project_id: String,
  thread_name: String,
) -> Result<Value, String> {
  middleware_branch_create(BranchCreateInput {
    source_session_key,
    source_message_id: source_message_id.clone(),
    project_id,
    branch_name: thread_name,
    branch_reason: Some("thread".to_string()),
  }).await
}

// ============================================================================
// ONBOARDING ENHANCEMENTS: OpenClaw Detection, Install, Git Remote
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawCheckInput {
  gateway_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCoreInput {
  action: Option<String>,
  gateway_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawInstallInput {
  install_path: Option<String>,
  version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProviderInput {
  provider_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProviderSubmitInput {
  provider_id: String,
  auth_method: Option<String>,
  values: Option<Value>,
  set_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingModelContractInput {
  provider_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingModelSubmitInput {
  provider_id: Option<String>,
  model_ref: String,
  set_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteAddInput {
  project_id: String,
  remote_name: String,
  remote_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRemoveInput {
  project_id: String,
  remote_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteListInput {
  project_id: String,
}

async fn command_version(binary: &str, version_arg: &str) -> Option<String> {
  tokio::process::Command::new(binary)
    .arg(version_arg)
    .output()
    .await
    .ok()
    .filter(|output| output.status.success())
    .and_then(|output| String::from_utf8(output.stdout).ok())
    .map(|stdout| stdout.trim().to_string())
    .filter(|stdout| !stdout.is_empty())
}

async fn gateway_running(gateway_url: &str) -> bool {
  matches!(
    timeout(Duration::from_secs(2), async {
      let request = gateway_url.to_string().into_client_request().map_err(|e| e.to_string())?;
      connect_async(request).await.map_err(|e| e.to_string())
    })
    .await,
    Ok(Ok(_))
  )
}

fn onboarding_recommendation(
  node_installed: bool,
  npm_installed: bool,
  openclaw_installed: bool,
  gateway_running: bool,
) -> &'static str {
  if !node_installed {
    "install_node"
  } else if !npm_installed {
    "install_npm"
  } else if !openclaw_installed {
    "install_openclaw"
  } else if !gateway_running {
    "start_gateway"
  } else {
    "ready"
  }
}

async fn onboarding_snapshot(gateway_url: String) -> Value {
  let node_version = command_version("node", "--version").await;
  let npm_version = command_version("npm", "--version").await;
  let openclaw_version = command_version("openclaw", "--version").await;
  let gateway_is_running = gateway_running(&gateway_url).await;

  json!({
    "node": {
      "installed": node_version.is_some(),
      "version": node_version,
    },
    "npm": {
      "installed": npm_version.is_some(),
      "version": npm_version,
    },
    "openclaw": {
      "installed": openclaw_version.is_some(),
      "version": openclaw_version,
      "installMethod": "npm i -g openclaw",
    },
    "gateway": {
      "url": gateway_url,
      "running": gateway_is_running,
      "status": if gateway_is_running { "running" } else { "stopped" },
    },
    "recommendation": onboarding_recommendation(
      node_version.is_some(),
      npm_version.is_some(),
      openclaw_version.is_some(),
      gateway_is_running,
    )
  })
}

fn openclaw_extensions_dir() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../..")
    .join(".openclaw-src")
    .join("extensions")
}

fn title_case_provider_id(provider_id: &str) -> String {
  provider_id
    .split('-')
    .filter(|part| !part.is_empty())
    .map(|part| {
      let mut chars = part.chars();
      match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
      }
    })
    .collect::<Vec<_>>()
    .join(" ")
}

fn onboarding_provider_category(provider_id: &str) -> &'static str {
  match provider_id {
    "openai" | "openai-codex" | "anthropic" | "google" | "google-gemini-cli" | "openrouter" | "deepseek" | "mistral" | "xai" | "qwen" | "moonshot" | "together" => "core",
    "ollama" | "lmstudio" | "vllm" | "sglang" | "github-copilot" | "codex" | "copilot-proxy" | "opencode" | "opencode-go" | "kilocode" => "local",
    _ => "advanced",
  }
}

fn flatten_config_schema_fields(
  prefix: Option<&str>,
  schema: &Value,
  ui_hints: &Value,
  output: &mut Vec<Value>,
) {
  let properties = match schema.get("properties").and_then(Value::as_object) {
    Some(properties) => properties,
    None => return,
  };

  let required = schema
    .get("required")
    .and_then(Value::as_array)
    .map(|arr| {
      arr.iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<HashSet<_>>()
    })
    .unwrap_or_default();

  for (key, field_schema) in properties {
    let path = match prefix {
      Some(prefix) if !prefix.is_empty() => format!("{prefix}.{key}"),
      _ => key.to_string(),
    };

    let label = ui_hints
      .get(&path)
      .and_then(|hint| hint.get("label"))
      .and_then(Value::as_str)
      .map(ToString::to_string);
    let help = ui_hints
      .get(&path)
      .and_then(|hint| hint.get("help"))
      .and_then(Value::as_str)
      .map(ToString::to_string);

    let field_type = match field_schema.get("type") {
      Some(Value::String(value)) => value.to_string(),
      Some(Value::Array(values)) => values
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("|"),
      _ => "object".to_string(),
    };

    output.push(json!({
      "path": path,
      "type": field_type,
      "required": required.contains(key),
      "label": label,
      "help": help,
      "enum": field_schema.get("enum").cloned().unwrap_or(Value::Null),
      "default": field_schema.get("default").cloned().unwrap_or(Value::Null),
      "sensitive": ui_hints
        .get(&path)
        .and_then(|hint| hint.get("sensitive"))
        .and_then(Value::as_bool)
        .unwrap_or(false),
    }));

    if field_schema.get("type").and_then(Value::as_str) == Some("object")
      || field_schema.get("properties").is_some()
    {
      flatten_config_schema_fields(Some(&path), field_schema, ui_hints, output);
    }
  }
}

fn read_openclaw_provider_manifests() -> Result<Vec<Value>, String> {
  let mut manifests = Vec::new();
  for entry in fs::read_dir(openclaw_extensions_dir())
    .map_err(|error| format!("Failed to read OpenClaw extensions dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("Failed to read OpenClaw extension entry: {error}"))?;
    let manifest_path = entry.path().join("openclaw.plugin.json");
    if !manifest_path.exists() {
      continue;
    }
    let raw = fs::read_to_string(&manifest_path)
      .map_err(|error| format!("Failed to read plugin manifest {}: {error}", manifest_path.display()))?;
    let manifest = serde_json::from_str::<Value>(&raw)
      .map_err(|error| format!("Failed to parse plugin manifest {}: {error}", manifest_path.display()))?;
    manifests.push(manifest);
  }
  manifests.sort_by(|left, right| {
    left.get("id")
      .and_then(Value::as_str)
      .cmp(&right.get("id").and_then(Value::as_str))
  });
  Ok(manifests)
}

fn manifest_for_provider(provider_id: &str) -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  manifests
    .into_iter()
    .find(|manifest| {
      manifest
        .get("providers")
        .and_then(Value::as_array)
        .map(|providers| {
          providers
            .iter()
            .any(|provider| provider.as_str() == Some(provider_id))
        })
        .unwrap_or(false)
    })
    .ok_or_else(|| format!("Unsupported OpenClaw provider: {provider_id}"))
}

fn provider_type_name(provider_id: &str, suffix: &str) -> String {
  format!(
    "{}{}",
    provider_id
      .split('-')
      .filter(|part| !part.is_empty())
      .map(|part| {
        let mut chars = part.chars();
        match chars.next() {
          Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
          None => String::new(),
        }
      })
      .collect::<String>(),
    suffix
  )
}

fn infer_auth_method_from_env_var(env_var: &str) -> &'static str {
  if env_var.contains("OAUTH") {
    "oauth"
  } else if env_var.starts_with("AWS_") {
    "aws-sdk"
  } else if env_var.contains("TOKEN") {
    "token"
  } else {
    "api-key"
  }
}

fn preferred_env_var_for_auth_method(
  auth_method: &str,
  auth_env_vars: &[Value],
) -> Option<String> {
  let matcher = match auth_method {
    "oauth" => Some("OAUTH"),
    "token" | "device" => Some("TOKEN"),
    "aws-sdk" => Some("AWS_"),
    _ => Some("API_KEY"),
  };

  matcher
    .and_then(|needle| {
      auth_env_vars.iter().find_map(|value| {
        let env_var = value.as_str()?;
        if env_var.contains(needle) || (needle == "AWS_" && env_var.starts_with("AWS_")) {
          Some(env_var.to_string())
        } else {
          None
        }
      })
    })
    .or_else(|| {
      auth_env_vars
        .iter()
        .find_map(|value| value.as_str().map(ToString::to_string))
    })
}

fn field_input_kind(field_type: &str, has_enum: bool, sensitive: bool) -> &'static str {
  if sensitive {
    "secret"
  } else if has_enum {
    "select"
  } else if field_type.contains("boolean") {
    "toggle"
  } else if field_type.contains("number") || field_type.contains("integer") {
    "number"
  } else if field_type == "object" {
    "group"
  } else {
    "text"
  }
}

fn is_leaf_field(config_fields: &[Value], path: &str) -> bool {
  !config_fields.iter().any(|candidate| {
    candidate
      .get("path")
      .and_then(Value::as_str)
      .map(|other| other != path && other.starts_with(&format!("{path}.")))
      .unwrap_or(false)
  })
}

fn build_provider_auth_fields(auth_choices: &[Value], auth_env_vars: &[Value]) -> Vec<Value> {
  let mut fields = Vec::new();
  let mut used_env_vars = HashSet::new();

  for choice in auth_choices {
    let auth_method = choice
      .get("method")
      .and_then(Value::as_str)
      .unwrap_or("api-key");
    let option_key = choice.get("optionKey").and_then(Value::as_str);
    let env_var = preferred_env_var_for_auth_method(auth_method, auth_env_vars);
    if let Some(env_var_name) = env_var.as_ref() {
      used_env_vars.insert(env_var_name.clone());
    }

    fields.push(json!({
      "key": option_key.unwrap_or(auth_method),
      "label": choice.get("choiceLabel").cloned().unwrap_or_else(|| Value::String(title_case_provider_id(auth_method))),
      "help": choice.get("choiceHint").cloned().unwrap_or(Value::Null),
      "group": "credentials",
      "authMethod": auth_method,
      "valueType": "string",
      "inputKind": if auth_method == "oauth" { "action" } else { "secret" },
      "required": option_key.is_some() && auth_method != "oauth",
      "sensitive": auth_method != "oauth",
      "envVar": env_var,
      "optionKey": option_key,
      "cliFlag": choice.get("cliFlag").cloned().unwrap_or(Value::Null),
    }));
  }

  for env_var in auth_env_vars.iter().filter_map(Value::as_str) {
    if used_env_vars.contains(env_var) {
      continue;
    }
    let auth_method = infer_auth_method_from_env_var(env_var);
    fields.push(json!({
      "key": env_var,
      "label": title_case_provider_id(env_var),
      "help": Value::Null,
      "group": "credentials",
      "authMethod": auth_method,
      "valueType": "string",
      "inputKind": if auth_method == "oauth" { "action" } else { "secret" },
      "required": auth_method != "oauth" && auth_method != "aws-sdk",
      "sensitive": auth_method != "oauth",
      "envVar": env_var,
      "optionKey": Value::Null,
      "cliFlag": Value::Null,
    }));
  }

  fields
}

fn build_provider_config_input_fields(config_fields: &[Value]) -> Vec<Value> {
  config_fields
    .iter()
    .filter(|field| {
      field
        .get("path")
        .and_then(Value::as_str)
        .map(|path| is_leaf_field(config_fields, path))
        .unwrap_or(false)
    })
    .map(|field| {
      let field_type = field.get("type").and_then(Value::as_str).unwrap_or("string");
      let sensitive = field
        .get("sensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
      let has_enum = field.get("enum").map(|value| value.is_array()).unwrap_or(false);
      json!({
        "key": field.get("path").cloned().unwrap_or(Value::Null),
        "sourcePath": field.get("path").cloned().unwrap_or(Value::Null),
        "label": field.get("label").cloned().unwrap_or_else(|| field.get("path").cloned().unwrap_or(Value::Null)),
        "help": field.get("help").cloned().unwrap_or(Value::Null),
        "group": "config",
        "valueType": field_type,
        "inputKind": field_input_kind(field_type, has_enum, sensitive),
        "required": field.get("required").cloned().unwrap_or(Value::Bool(false)),
        "sensitive": field.get("sensitive").cloned().unwrap_or(Value::Bool(false)),
        "enum": field.get("enum").cloned().unwrap_or(Value::Null),
        "default": field.get("default").cloned().unwrap_or(Value::Null),
      })
    })
    .collect()
}

fn provider_submit_schema_from_manifest(manifest: &Value, provider_id: &str) -> Value {
  let auth_choices = manifest
    .get("providerAuthChoices")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|choice| choice.get("provider").and_then(Value::as_str) == Some(provider_id))
    .collect::<Vec<_>>();
  let auth_env_vars = manifest
    .get("providerAuthEnvVars")
    .and_then(|value| value.get(provider_id))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let auth_methods = auth_choices
    .iter()
    .filter_map(|choice| choice.get("method").cloned())
    .collect::<Vec<_>>();
  let config_schema = manifest.get("configSchema").cloned().unwrap_or_else(|| json!({}));
  let ui_hints = manifest.get("uiHints").cloned().unwrap_or_else(|| json!({}));
  let mut config_fields = Vec::new();
  flatten_config_schema_fields(None, &config_schema, &ui_hints, &mut config_fields);
  let credential_fields = build_provider_auth_fields(&auth_choices, &auth_env_vars);
  let config_input_fields = build_provider_config_input_fields(&config_fields);
  let step_kind = match onboarding_provider_category(provider_id) {
    "local" => "local",
    "advanced" => "advanced",
    _ if auth_methods.iter().any(|method| method.as_str() == Some("oauth")) => "mixed",
    _ => "api-key",
  };

  json!({
    "providerId": provider_id,
    "submitEndpoint": "middleware_onboarding_provider_submit",
    "stepKind": step_kind,
    "typeNames": {
      "payload": provider_type_name(provider_id, "OnboardingSubmitPayload"),
      "authMethod": provider_type_name(provider_id, "AuthMethod"),
      "values": provider_type_name(provider_id, "OnboardingValues"),
    },
    "payloadShape": {
      "providerId": { "type": "literal", "value": provider_id },
      "authMethod": { "type": "enum", "options": auth_methods },
      "setDefault": { "type": "boolean", "default": true },
      "values": {
        "type": "object",
        "fields": {
          "credentials": credential_fields,
          "config": config_input_fields,
        }
      }
    }
  })
}

fn provider_summary_from_manifest(manifest: &Value, provider_id: &str) -> Value {
  let plugin_id = manifest.get("id").and_then(Value::as_str).unwrap_or_default();
  let auth_choices = manifest
    .get("providerAuthChoices")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|choice| choice.get("provider").and_then(Value::as_str) == Some(provider_id))
    .collect::<Vec<_>>();
  let auth_env_vars = manifest
    .get("providerAuthEnvVars")
    .and_then(|value| value.get(provider_id))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let option_keys = auth_choices
    .iter()
    .filter_map(|choice| choice.get("optionKey").and_then(Value::as_str))
    .collect::<Vec<_>>();
  let auth_methods = auth_choices
    .iter()
    .filter_map(|choice| choice.get("method").and_then(Value::as_str))
    .collect::<Vec<_>>();
  let config_schema = manifest.get("configSchema").cloned().unwrap_or_else(|| json!({}));
  let ui_hints = manifest.get("uiHints").cloned().unwrap_or_else(|| json!({}));
  let mut config_fields = Vec::new();
  flatten_config_schema_fields(None, &config_schema, &ui_hints, &mut config_fields);

  let display_name = auth_choices
    .iter()
    .find_map(|choice| choice.get("groupLabel").and_then(Value::as_str))
    .map(ToString::to_string)
    .or_else(|| auth_choices.iter().find_map(|choice| choice.get("choiceLabel").and_then(Value::as_str)).map(ToString::to_string))
    .unwrap_or_else(|| title_case_provider_id(provider_id));

  json!({
    "id": provider_id,
    "pluginId": plugin_id,
    "displayName": display_name,
    "category": onboarding_provider_category(provider_id),
    "authEnvVars": auth_env_vars,
    "authMethods": auth_methods,
    "optionKeys": option_keys,
    "authChoices": auth_choices,
    "configFieldCount": config_fields.len(),
    "configFields": config_fields,
    "schema": config_schema,
    "uiHints": ui_hints,
    "submit": provider_submit_schema_from_manifest(manifest, provider_id),
  })
}

fn onboarding_model_options_for_provider(provider_id: &str, auth_method: Option<&str>) -> Vec<Value> {
  let refs = match provider_id {
    "openai" => vec!["openai/gpt-5.4", "openai/gpt-5.4-mini", "openai/o4-mini"],
    "openai-codex" => vec!["openai-codex/gpt-5.4", "openai-codex/gpt-5.4-pro"],
    "anthropic" => {
      if auth_method == Some("cli") {
        vec![
          "claude-cli/claude-sonnet-4-6",
          "claude-cli/claude-opus-4-6",
          "claude-cli/claude-haiku-4-5",
        ]
      } else {
        vec![
          "anthropic/claude-sonnet-4-6",
          "anthropic/claude-opus-4-6",
          "anthropic/claude-haiku-4-5",
        ]
      }
    }
    "google" => vec!["google/gemini-2.5-pro", "google/gemini-2.5-flash"],
    "openrouter" => vec!["openrouter/openai/gpt-4o-mini", "openrouter/anthropic/claude-sonnet-4-5"],
    "deepseek" => vec!["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
    "mistral" => vec!["mistral/mistral-medium-2505", "mistral/mistral-small-2503"],
    "xai" => vec!["xai/grok-4", "xai/grok-3-mini"],
    "qwen" => vec!["qwen/qwen3-coder-plus", "qwen/qwen3-235b-a22b"],
    "moonshot" => vec!["moonshot/kimi-k2", "moonshot/kimi-latest"],
    "ollama" => vec!["ollama/qwen3:4b", "ollama/llama3.2:3b"],
    "lmstudio" => vec!["lmstudio/local-model", "lmstudio/qwen2.5-coder"],
    "github-copilot" => vec!["github-copilot/gpt-4.1", "github-copilot/claude-sonnet-4-5"],
    "codex" => vec!["codex/gpt-5.4", "codex/gpt-5.4-mini"],
    _ => Vec::new(),
  };

  refs
    .into_iter()
    .map(|model_ref| {
      let display_name = model_ref
        .split('/')
        .last()
        .unwrap_or(model_ref)
        .to_string();
      json!({
        "id": model_ref,
        "value": model_ref,
        "label": display_name,
      })
    })
    .collect()
}

fn default_onboarding_model_ref(provider_id: &str, auth_method: Option<&str>) -> Option<String> {
  onboarding_model_options_for_provider(provider_id, auth_method)
    .first()
    .and_then(|value| value.get("value").and_then(Value::as_str))
    .map(ToString::to_string)
}

fn selected_onboarding_provider(conn: &Connection) -> Result<Option<(String, Option<String>)>, String> {
  let provider_id = get_app_setting(conn, APP_SETTING_ONBOARDING_PROVIDER_ID)?;
  let auth_method = get_app_setting(conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
    .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
  Ok(provider_id.map(|provider_id| (provider_id, auth_method)))
}

fn onboarding_model_contract_value(
  conn: &Connection,
  provider_id: String,
  auth_method: Option<String>,
) -> Result<Value, String> {
  let manifest = manifest_for_provider(&provider_id)?;
  let provider = provider_summary_from_manifest(&manifest, &provider_id);
  let selected_model_ref = get_app_setting(conn, APP_SETTING_ONBOARDING_MODEL_REF)?;
  let recommended_model_ref = default_onboarding_model_ref(&provider_id, auth_method.as_deref());
  let recommended_for_field = recommended_model_ref.clone();
  let model_options = onboarding_model_options_for_provider(&provider_id, auth_method.as_deref());

  Ok(json!({
    "providerId": provider_id,
    "authMethod": auth_method,
    "selectedModelRef": selected_model_ref,
    "recommendedModelRef": recommended_model_ref,
    "submitEndpoint": "middleware_onboarding_model_submit",
    "nextStep": "complete",
    "provider": provider,
    "types": {
      "providerId": provider.get("id").cloned().unwrap_or(Value::Null),
      "submitEndpoint": "middleware_onboarding_model_submit",
      "typeNames": {
        "payload": provider_type_name(
          provider.get("id").and_then(Value::as_str).unwrap_or("model"),
          "OnboardingModelSubmitPayload",
        ),
        "selection": provider_type_name(
          provider.get("id").and_then(Value::as_str).unwrap_or("model"),
          "OnboardingModelSelection",
        ),
      },
      "payloadShape": {
        "providerId": { "type": "literal", "value": provider.get("id").cloned().unwrap_or(Value::Null) },
        "modelRef": {
          "type": "string",
          "required": true,
          "inputKind": if model_options.is_empty() { "text" } else { "combobox" },
          "allowCustom": true,
          "recommended": recommended_for_field,
          "options": model_options,
        },
        "setDefault": { "type": "boolean", "default": true }
      }
    }
  }))
}

fn onboarding_step_state(core_status: &Value, bot_name: Option<String>, provider_done: bool, model_done: bool) -> Value {
  let core_done = core_status.get("recommendation").and_then(Value::as_str) == Some("ready");
  let bot_done = bot_name.as_deref().map(|value| !value.trim().is_empty()).unwrap_or(false);
  let next_step = if !core_done {
    "core"
  } else if !bot_done {
    "bot"
  } else if !provider_done {
    "provider"
  } else if !model_done {
    "model"
  } else {
    "complete"
  };

  json!({
    "steps": [
      { "id": "core", "title": "Install and start OpenClaw", "complete": core_done },
      { "id": "bot", "title": "Set bot name", "complete": bot_done },
      { "id": "provider", "title": "Choose provider", "complete": provider_done },
      { "id": "model", "title": "Choose default model", "complete": model_done }
    ],
    "nextStep": next_step,
    "completed": next_step == "complete"
  })
}

#[tauri::command]
pub fn middleware_onboarding_providers() -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  let mut providers = Vec::new();
  for manifest in manifests {
    for provider_id in manifest
      .get("providers")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(Value::as_str)
    {
      providers.push(provider_summary_from_manifest(&manifest, provider_id));
    }
  }
  providers.sort_by(|left, right| {
    left.get("id")
      .and_then(Value::as_str)
      .cmp(&right.get("id").and_then(Value::as_str))
  });
  Ok(json!({ "providers": providers, "count": providers.len() }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_types() -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  let mut providers = Vec::new();
  for manifest in manifests {
    for provider_id in manifest
      .get("providers")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(Value::as_str)
    {
      providers.push(json!({
        "providerId": provider_id,
        "displayName": provider_summary_from_manifest(&manifest, provider_id)
          .get("displayName")
          .cloned()
          .unwrap_or(Value::Null),
        "types": provider_submit_schema_from_manifest(&manifest, provider_id),
      }));
    }
  }
  providers.sort_by(|left, right| {
    left
      .get("providerId")
      .and_then(Value::as_str)
      .cmp(&right.get("providerId").and_then(Value::as_str))
  });
  Ok(json!({
    "version": "2026-04-18",
    "submitEndpoint": "middleware_onboarding_provider_submit",
    "providers": providers,
  }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_details(input: OnboardingProviderInput) -> Result<Value, String> {
  let manifest = manifest_for_provider(&input.provider_id)?;
  Ok(json!({ "provider": provider_summary_from_manifest(&manifest, &input.provider_id) }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_submit(
  input: OnboardingProviderSubmitInput,
) -> Result<Value, String> {
  let manifest = manifest_for_provider(&input.provider_id)?;
  let provider = provider_summary_from_manifest(&manifest, &input.provider_id);
  let submit_schema = provider_submit_schema_from_manifest(&manifest, &input.provider_id);
  let auth_methods = provider
    .get("authMethods")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter_map(|value| value.as_str().map(ToString::to_string))
    .collect::<Vec<_>>();
  let auth_method = input.auth_method.or_else(|| {
    if auth_methods.len() == 1 {
      auth_methods.first().cloned()
    } else {
      None
    }
  });

  if auth_methods.len() > 1 && auth_method.is_none() {
    return Err(format!(
      "Provider {} requires authMethod. Supported values: {}",
      input.provider_id,
      auth_methods.join(", ")
    ));
  }

  if let Some(selected_auth_method) = auth_method.as_deref() {
    if !auth_methods.is_empty() && !auth_methods.iter().any(|method| method == selected_auth_method) {
      return Err(format!(
        "Unsupported authMethod '{}' for provider {}",
        selected_auth_method, input.provider_id
      ));
    }
  }

  let values = input.values.unwrap_or_else(|| json!({}));
  let values_object = values
    .as_object()
    .ok_or_else(|| "values must be a JSON object".to_string())?;

  let credential_fields = submit_schema
    .get("payloadShape")
    .and_then(|value| value.get("values"))
    .and_then(|value| value.get("fields"))
    .and_then(|value| value.get("credentials"))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let config_fields = submit_schema
    .get("payloadShape")
    .and_then(|value| value.get("values"))
    .and_then(|value| value.get("fields"))
    .and_then(|value| value.get("config"))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  for field in &credential_fields {
    let field_auth_method = field.get("authMethod").and_then(Value::as_str);
    if auth_method.as_deref().is_some()
      && field_auth_method.is_some()
      && field_auth_method != auth_method.as_deref()
    {
      continue;
    }
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let required = field.get("required").and_then(Value::as_bool).unwrap_or(false);
    let is_present = values_object
      .get(key)
      .and_then(Value::as_str)
      .map(|value| !value.trim().is_empty())
      .unwrap_or(false);
    if required && !is_present {
      return Err(format!("Missing required credential field: {key}"));
    }
  }

  for field in &config_fields {
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let required = field.get("required").and_then(Value::as_bool).unwrap_or(false);
    if required && !values_object.contains_key(key) {
      return Err(format!("Missing required config field: {key}"));
    }
  }

  let mut config = read_openclaw_config_value()?;
  let mut saved_env_vars = Vec::new();
  let mut saved_config_paths = Vec::new();

  for field in &credential_fields {
    let field_auth_method = field.get("authMethod").and_then(Value::as_str);
    if auth_method.as_deref().is_some()
      && field_auth_method.is_some()
      && field_auth_method != auth_method.as_deref()
    {
      continue;
    }
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    if let Some(value) = values_object.get(key).and_then(Value::as_str) {
      if value.trim().is_empty() {
        continue;
      }
      if let Some(env_var) = field.get("envVar").and_then(Value::as_str) {
        set_json_path(&mut config, &format!("env.vars.{env_var}"), Value::String(value.to_string()));
        saved_env_vars.push(env_var.to_string());
      }
    }
  }

  let plugin_id = provider
    .get("pluginId")
    .and_then(Value::as_str)
    .unwrap_or_default();
  let mut plugin_config = value_at_json_path(&config, plugin_id)
    .cloned()
    .unwrap_or_else(|| json!({}));

  for field in &config_fields {
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let source_path = field
      .get("sourcePath")
      .and_then(Value::as_str)
      .unwrap_or(key);
    if let Some(value) = values_object.get(key).cloned() {
      set_json_path(&mut plugin_config, source_path, value);
      saved_config_paths.push(format!("{plugin_id}.{source_path}"));
    }
  }

  if !saved_config_paths.is_empty() {
    set_json_path(&mut config, plugin_id, plugin_config);
  }

  write_openclaw_config_value(&config)?;

  let conn = open_db()?;
  set_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_ID, &input.provider_id)?;
  set_app_setting(
    &conn,
    APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
    auth_method.as_deref().unwrap_or(""),
  )?;

  let persisted_values = values_object
    .iter()
    .filter_map(|(key, value)| {
      let is_sensitive = credential_fields.iter().chain(config_fields.iter()).any(|field| {
        field.get("key").and_then(Value::as_str) == Some(key.as_str())
          && field.get("sensitive").and_then(Value::as_bool).unwrap_or(false)
      });
      if is_sensitive {
        None
      } else {
        Some((key.clone(), value.clone()))
      }
    })
    .collect::<serde_json::Map<String, Value>>();
  set_app_setting(
    &conn,
    &format!("{APP_SETTING_ONBOARDING_PROVIDER_VALUES_PREFIX}{}", input.provider_id),
    &Value::Object(persisted_values).to_string(),
  )?;

  Ok(json!({
    "ok": true,
    "providerId": input.provider_id,
    "authMethod": auth_method,
    "saved": {
      "envVars": saved_env_vars,
      "configPaths": saved_config_paths,
      "setDefault": input.set_default.unwrap_or(true),
    },
    "nextStep": "model-selection",
    "openClawFlow": ["onboarding", "model-selection"],
    "provider": provider,
    "types": submit_schema,
  }))
}

#[tauri::command]
pub fn middleware_onboarding_model_contract(
  input: Option<OnboardingModelContractInput>,
) -> Result<Value, String> {
  let conn = open_db()?;
  let selected = if let Some(provider_id) = input.and_then(|value| value.provider_id) {
    let auth_method = get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
      .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
    Some((provider_id, auth_method))
  } else {
    selected_onboarding_provider(&conn)?
  }
  .ok_or_else(|| "No onboarding provider selected yet".to_string())?;

  let (provider_id, auth_method) = selected;
  let contract = onboarding_model_contract_value(&conn, provider_id, auth_method)?;
  Ok(json!({ "contract": contract }))
}

#[tauri::command]
pub fn middleware_onboarding_model_submit(input: OnboardingModelSubmitInput) -> Result<Value, String> {
  let conn = open_db()?;
  let (provider_id, auth_method) = match input.provider_id {
    Some(provider_id) => {
      let auth_method = get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
        .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
      (provider_id, auth_method)
    }
    None => selected_onboarding_provider(&conn)?
      .ok_or_else(|| "No onboarding provider selected yet".to_string())?,
  };

  let model_ref = input.model_ref.trim();
  if model_ref.is_empty() {
    return Err("modelRef is required".to_string());
  }
  if !model_ref.contains('/') {
    return Err("modelRef must use provider/model format".to_string());
  }
  if !model_ref.starts_with(&format!("{provider_id}/")) {
    return Err(format!(
      "modelRef '{}' does not belong to selected provider {}",
      model_ref, provider_id
    ));
  }

  let mut config = read_openclaw_config_value()?;
  set_json_path(
    &mut config,
    "agents.defaults.model.primary",
    Value::String(model_ref.to_string()),
  );
  write_openclaw_config_value(&config)?;

  set_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF, model_ref)?;
  set_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_PROVIDER_ID, &provider_id)?;

  let contract = onboarding_model_contract_value(&conn, provider_id.clone(), auth_method)?;
  Ok(json!({
    "ok": true,
    "providerId": provider_id,
    "modelRef": model_ref,
    "saved": {
      "setDefault": input.set_default.unwrap_or(true),
      "configPaths": ["agents.defaults.model.primary"],
    },
    "nextStep": "complete",
    "openClawFlow": ["onboarding", "complete"],
    "contract": contract,
  }))
}

#[tauri::command]
pub async fn middleware_onboarding_flow(input: Option<OnboardingCoreInput>) -> Result<Value, String> {
  let gateway_url = input
    .and_then(|value| value.gateway_url)
    .unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT));
  let core_status = onboarding_snapshot(gateway_url).await;
  let conn = open_db()?;
  let bot_name = get_app_setting(&conn, APP_SETTING_OPENCLAW_BOT_NAME)?;
  let selected_provider = selected_onboarding_provider(&conn)?;
  let config = read_openclaw_config_value().unwrap_or_else(|_| json!({}));
  let selected_model_ref = get_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF)?
    .or_else(|| value_at_json_path(&config, "agents.defaults.model.primary").and_then(Value::as_str).map(ToString::to_string));

  let provider_details = if let Some((provider_id, auth_method)) = selected_provider.clone() {
    Some(json!({
      "providerId": provider_id,
      "authMethod": auth_method,
    }))
  } else {
    None
  };
  let model_contract = if let Some((provider_id, auth_method)) = selected_provider.clone() {
    Some(onboarding_model_contract_value(&conn, provider_id, auth_method)?)
  } else {
    None
  };
  let flow = onboarding_step_state(&core_status, bot_name.clone(), selected_provider.is_some(), selected_model_ref.is_some());

  Ok(json!({
    "flow": flow,
    "state": {
      "core": {
        "status": core_status,
        "checkEndpoint": "middleware_onboarding_core",
      },
      "bot": {
        "botName": bot_name,
        "getEndpoint": "middleware_openclaw_bot_name_get",
        "setEndpoint": "middleware_openclaw_bot_name_set",
      },
      "provider": {
        "selection": provider_details,
        "listEndpoint": "middleware_onboarding_providers",
        "typesEndpoint": "middleware_onboarding_provider_types",
        "detailsEndpoint": "middleware_onboarding_provider_details",
        "submitEndpoint": "middleware_onboarding_provider_submit",
      },
      "model": {
        "selectedModelRef": selected_model_ref,
        "contractEndpoint": "middleware_onboarding_model_contract",
        "submitEndpoint": "middleware_onboarding_model_submit",
        "contract": model_contract,
      }
    }
  }))
}

#[tauri::command]
pub async fn middleware_onboarding_core(input: OnboardingCoreInput) -> Result<Value, String> {
  let gateway_url = input.gateway_url.unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT));
  let action = input.action.unwrap_or_else(|| "check".to_string());
  let mut actions_run: Vec<String> = Vec::new();

  if action == "apply" {
    let before = onboarding_snapshot(gateway_url.clone()).await;
    let node_installed = before.get("node").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let npm_installed = before.get("npm").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let openclaw_installed = before.get("openclaw").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let gateway_is_running = before.get("gateway").and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false);

    if !node_installed {
      return Ok(json!({
        "action": action,
        "applied": false,
        "canAutoFix": false,
        "message": "Node.js is not installed. Install Node.js first, then rerun onboarding.",
        "manualAction": "install_node",
        "docsUrl": "https://nodejs.org/en/download",
        "status": before,
        "actionsRun": actions_run,
      }));
    }

    if !npm_installed {
      return Ok(json!({
        "action": action,
        "applied": false,
        "canAutoFix": false,
        "message": "npm is not installed. Install npm first, then rerun onboarding.",
        "manualAction": "install_npm",
        "docsUrl": "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
        "status": before,
        "actionsRun": actions_run,
      }));
    }

    if !openclaw_installed {
      let output = tokio::process::Command::new("npm")
        .args(&["i", "-g", "openclaw"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm install: {}", e))?;

      if !output.status.success() {
        return Err(format!(
          "OpenClaw npm install failed: {}",
          String::from_utf8_lossy(&output.stderr)
        ));
      }

      actions_run.push("npm i -g openclaw".to_string());
    }

    if !gateway_is_running {
      let output = tokio::process::Command::new("openclaw")
        .args(&["gateway", "start"])
        .output()
        .await
        .map_err(|e| format!("Failed to start OpenClaw Gateway: {}", e))?;

      if !output.status.success() {
        return Err(format!(
          "OpenClaw gateway start failed: {}",
          String::from_utf8_lossy(&output.stderr)
        ));
      }

      actions_run.push("openclaw gateway start".to_string());
    }
  }

  let status = onboarding_snapshot(gateway_url).await;
  let recommendation = status.get("recommendation").and_then(Value::as_str).unwrap_or("install_node");

  Ok(json!({
    "action": action,
    "applied": action == "apply" && !actions_run.is_empty(),
    "canAutoFix": matches!(recommendation, "install_openclaw" | "start_gateway" | "ready"),
    "status": status,
    "actionsRun": actions_run,
  }))
}

#[tauri::command]
pub async fn middleware_openclaw_check(input: OpenClawCheckInput) -> Result<Value, String> {
  let status = onboarding_snapshot(
    input.gateway_url.unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT))
  ).await;

  Ok(json!({
    "installed": status.get("openclaw").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false),
    "running": status.get("gateway").and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false),
    "version": status.get("openclaw").and_then(|v| v.get("version")).cloned().unwrap_or(Value::Null),
    "gateway": status.get("gateway").cloned().unwrap_or(Value::Null),
    "recommendation": match status.get("recommendation").and_then(Value::as_str).unwrap_or("install_openclaw") {
      "ready" => "ready",
      "start_gateway" => "start",
      _ => "install",
    },
    "core": status,
  }))
}

#[tauri::command]
pub async fn middleware_openclaw_install(_input: OpenClawInstallInput) -> Result<Value, String> {
  let result = middleware_onboarding_core(OnboardingCoreInput {
    action: Some("apply".to_string()),
    gateway_url: None,
  }).await?;

  Ok(json!({
    "installed": result.get("status").and_then(|v| v.get("openclaw")).and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false),
    "running": result.get("status").and_then(|v| v.get("gateway")).and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false),
    "actionsRun": result.get("actionsRun").cloned().unwrap_or_else(|| json!([])),
    "status": result.get("status").cloned().unwrap_or(Value::Null),
  }))
}

#[tauri::command]
pub async fn middleware_git_remote_add(input: GitRemoteAddInput) -> Result<Value, String> {
  let conn = open_db()?;
  let repo_root: String = conn.query_row(
    "SELECT repo_root FROM projects WHERE id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|e| format!("Project not found: {}", e))?;

  if repo_root.is_empty() {
    return Err("Project has no repo_root configured".to_string());
  }

  let git_dir = std::path::Path::new(&repo_root).join(".git");
  if !git_dir.exists() {
    let init_output = tokio::process::Command::new("git")
      .arg("init")
      .current_dir(&repo_root)
      .output()
      .await
      .map_err(|e| format!("Failed to init git: {}", e))?;

    if !init_output.status.success() {
      return Err(format!("Git init failed: {}", String::from_utf8_lossy(&init_output.stderr)));
    }
  }

  let output = tokio::process::Command::new("git")
    .args(&["remote", "add", &input.remote_name, &input.remote_url])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to add remote: {}", e))?;

  if output.status.success() {
    let remotes_json: String = conn.query_row(
      "SELECT remotes_json FROM projects WHERE id = ?",
      params![input.project_id],
      |row| row.get::<_, Option<String>>(0).map(|s| s.unwrap_or_else(|| "{}".to_string())),
    ).unwrap_or_else(|_| "{}".to_string());

    let mut remotes: Value = serde_json::from_str(&remotes_json).unwrap_or_else(|_| json!({}));
    remotes[input.remote_name.clone()] = json!(input.remote_url);

    conn.execute(
      "UPDATE projects SET remotes_json = ?, updated_at = ? WHERE id = ?",
      params![remotes.to_string(), now_iso(), input.project_id],
    ).map_err(|e| format!("Failed to update project: {}", e))?;

    Ok(json!({
      "added": true,
      "remoteName": input.remote_name,
      "remoteUrl": input.remote_url,
      "projectId": input.project_id,
    }))
  } else {
    Err(format!("Git remote add failed: {}", String::from_utf8_lossy(&output.stderr)))
  }
}

#[tauri::command]
pub async fn middleware_git_remote_list(input: GitRemoteListInput) -> Result<Value, String> {
  let conn = open_db()?;
  let repo_root: String = conn.query_row(
    "SELECT repo_root FROM projects WHERE id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|e| format!("Project not found: {}", e))?;

  if repo_root.is_empty() {
    return Ok(json!({ "remotes": [] }));
  }

  let git_dir = std::path::Path::new(&repo_root).join(".git");
  if !git_dir.exists() {
    return Ok(json!({ "remotes": [] }));
  }

  let output = tokio::process::Command::new("git")
    .args(&["remote", "-v"])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to list remotes: {}", e))?;

  if !output.status.success() {
    return Ok(json!({ "remotes": [] }));
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let mut remotes = Vec::new();

  for line in stdout.lines() {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
      remotes.push(json!({
        "name": parts[0],
        "url": parts[1],
        "type": parts.get(2).unwrap_or(&"(fetch)").trim_start_matches('(').trim_end_matches(')'),
      }));
    }
  }

  Ok(json!({ "remotes": remotes }))
}

#[tauri::command]
pub async fn middleware_git_remote_remove(input: GitRemoteRemoveInput) -> Result<Value, String> {
  let conn = open_db()?;
  let repo_root: String = conn.query_row(
    "SELECT repo_root FROM projects WHERE id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|e| format!("Project not found: {}", e))?;

  if repo_root.is_empty() {
    return Err("Project has no repo_root configured".to_string());
  }

  let output = tokio::process::Command::new("git")
    .args(&["remote", "remove", &input.remote_name])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to remove remote: {}", e))?;

  if output.status.success() {
    let remotes_json: String = conn.query_row(
      "SELECT remotes_json FROM projects WHERE id = ?",
      params![input.project_id],
      |row| row.get::<_, Option<String>>(0).map(|s| s.unwrap_or_else(|| "{}".to_string())),
    ).unwrap_or_else(|_| "{}".to_string());

    let mut remotes: Value = serde_json::from_str(&remotes_json).unwrap_or_else(|_| json!({}));
    if let Some(obj) = remotes.as_object_mut() {
      obj.remove(&input.remote_name);
    }

    conn.execute(
      "UPDATE projects SET remotes_json = ?, updated_at = ? WHERE id = ?",
      params![remotes.to_string(), now_iso(), input.project_id],
    ).map_err(|e| format!("Failed to update project: {}", e))?;

    Ok(json!({
      "removed": true,
      "remoteName": input.remote_name,
      "projectId": input.project_id,
    }))
  } else {
    Err(format!("Git remote remove failed: {}", String::from_utf8_lossy(&output.stderr)))
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoverInput {
  query: Option<String>,
  limit: Option<usize>,
  include_local: Option<bool>,
  include_claw_hub: Option<bool>,
  include_github_probe: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallInput {
  source: String,
  slug: Option<String>,
  version: Option<String>,
  repo_url: Option<String>,
  #[serde(rename = "ref")]
  git_ref: Option<String>,
  local_path: Option<String>,
  scope: Option<String>,
  force: Option<bool>,
}

fn openclaw_user_root() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw"))
}

fn openclaw_skill_root_for_scope(scope: &str) -> Result<PathBuf, String> {
  let root = match scope {
    "workspace" => openclaw_user_root()?.join("workspace").join("skills"),
    _ => openclaw_user_root()?.join("skills"),
  };
  fs::create_dir_all(&root).map_err(|error| format!("Failed to create skill install root {}: {error}", root.display()))?;
  Ok(root)
}

fn parse_skill_frontmatter(raw: &str) -> (Option<String>, Option<String>) {
  let trimmed = raw.trim();
  if let Some(frontmatter) = trimmed.strip_prefix("---") {
    if let Some((body, _)) = frontmatter.split_once("\n---") {
      let mut name = None;
      let mut description = None;
      for line in body.lines() {
        if let Some(value) = line.strip_prefix("name:") {
          name = Some(value.trim().trim_matches('"').to_string());
        }
        if let Some(value) = line.strip_prefix("description:") {
          description = Some(value.trim().trim_matches('"').to_string());
        }
      }
      return (name, description);
    }
  }

  let description = trimmed
    .lines()
    .map(str::trim)
    .find(|line| !line.is_empty() && !line.starts_with('#'))
    .map(ToString::to_string);
  (None, description)
}

fn skill_json(
  id: String,
  slug: String,
  name: String,
  summary: Option<String>,
  description: Option<String>,
  source: &str,
  version: Option<String>,
  installed: bool,
  install_source: &str,
  repo_url: Option<String>,
  homepage_url: Option<String>,
  local_path: Option<String>,
  tags: Vec<String>,
) -> Value {
  json!({
    "id": id,
    "slug": slug,
    "name": name,
    "summary": summary,
    "description": description,
    "source": source,
    "version": version,
    "installed": installed,
    "installSource": install_source,
    "repoUrl": repo_url,
    "homepageUrl": homepage_url,
    "localPath": local_path,
    "tags": tags,
  })
}

fn scan_local_skills_in_root(root: &Path, source_label: &str, query: &str) -> Vec<Value> {
  let mut results = vec![];
  let entries = match fs::read_dir(root) {
    Ok(entries) => entries,
    Err(_) => return results,
  };

  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let skill_md = path.join("SKILL.md");
    if !skill_md.exists() {
      continue;
    }
    let slug = entry.file_name().to_string_lossy().to_string();
    let raw = fs::read_to_string(&skill_md).unwrap_or_default();
    let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw);
    let name = frontmatter_name.unwrap_or_else(|| slug.clone());
    let description = frontmatter_description;
    let haystack = format!("{}\n{}\n{}", slug, name, description.clone().unwrap_or_default()).to_lowercase();
    if !query.is_empty() && !haystack.contains(query) {
      continue;
    }
    results.push(skill_json(
      format!("{source_label}:{slug}"),
      slug,
      name,
      description.clone(),
      description,
      "local",
      None,
      true,
      "local",
      None,
      None,
      Some(path.to_string_lossy().to_string()),
      vec![],
    ));
  }

  results
}

fn parse_clawhub_search_line(line: &str) -> Option<(String, String)> {
  let trimmed = line.trim();
  if trimmed.is_empty() || trimmed.starts_with('-') {
    return None;
  }
  let without_score = trimmed.split("  (").next()?.trim();
  let (slug, display_name) = without_score.split_once("  ")?;
  Some((slug.trim().to_string(), display_name.trim().to_string()))
}

fn parse_github_repo_reference(input: &str) -> Option<(String, String, String)> {
  let trimmed = input.trim().trim_end_matches('/');
  if trimmed.is_empty() {
    return None;
  }
  if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
    let mut parts = rest.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
      return None;
    }
    return Some((owner.to_string(), repo.to_string(), format!("https://github.com/{owner}/{repo}")));
  }
  let parts = trimmed.split('/').collect::<Vec<_>>();
  if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
    return Some((parts[0].to_string(), parts[1].to_string(), format!("https://github.com/{}/{}", parts[0], parts[1])));
  }
  None
}

async fn clawhub_search_skills(query: &str, limit: usize) -> Result<Vec<Value>, String> {
  let output = tokio::process::Command::new("clawhub")
    .args(["search", query, "--limit", &limit.to_string()])
    .output()
    .await
    .map_err(|error| format!("Failed to run clawhub search: {error}"))?;
  if !output.status.success() {
    return Err(format!("clawhub search failed: {}", String::from_utf8_lossy(&output.stderr)));
  }

  let mut results = vec![];
  for line in String::from_utf8_lossy(&output.stdout).lines() {
    let Some((slug, name)) = parse_clawhub_search_line(line) else {
      continue;
    };
    let inspect_output = tokio::process::Command::new("clawhub")
      .args(["inspect", &slug, "--json"])
      .output()
      .await
      .ok();

    let mut summary = None;
    let mut version = None;
    let mut tags = vec![];
    if let Some(inspect_output) = inspect_output {
      if inspect_output.status.success() {
        let stdout = String::from_utf8_lossy(&inspect_output.stdout);
        if let Some(json_start) = stdout.find('{') {
          if let Ok(payload) = serde_json::from_str::<Value>(&stdout[json_start..]) {
            summary = string_from_value(payload.get("skill").and_then(|skill| skill.get("summary")));
            version = string_from_value(payload.get("latestVersion").and_then(|latest| latest.get("version")));
            tags = payload
              .get("skill")
              .and_then(|skill| skill.get("tags"))
              .and_then(Value::as_object)
              .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
              .unwrap_or_default();
          }
        }
      }
    }

    results.push(skill_json(
      format!("clawhub:{slug}"),
      slug,
      name,
      summary.clone(),
      summary,
      "clawhub",
      version,
      false,
      "clawhub",
      None,
      Some("https://clawhub.com".to_string()),
      None,
      tags,
    ));
  }

  Ok(results)
}

async fn probe_github_skill(query: &str) -> Result<Option<Value>, String> {
  let Some((owner, repo, repo_url)) = parse_github_repo_reference(query) else {
    return Ok(None);
  };

  let output = tokio::process::Command::new("git")
    .args(["ls-remote", "--symref", &repo_url, "HEAD"])
    .output()
    .await
    .map_err(|error| format!("Failed to inspect GitHub repo: {error}"))?;
  if !output.status.success() {
    return Ok(None);
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let branch = stdout
    .lines()
    .find_map(|line| line.strip_prefix("ref: refs/heads/").and_then(|rest| rest.split_whitespace().next()))
    .unwrap_or("main");
  let raw_url = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/SKILL.md");
  let curl_output = tokio::process::Command::new("curl")
    .args(["-fsSL", &raw_url])
    .output()
    .await;

  let Ok(curl_output) = curl_output else {
    return Ok(None);
  };
  if !curl_output.status.success() {
    return Ok(None);
  }

  let raw_skill = String::from_utf8_lossy(&curl_output.stdout).to_string();
  let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
  let slug = repo.clone();
  Ok(Some(skill_json(
    format!("github:{owner}/{repo}"),
    slug.clone(),
    frontmatter_name.unwrap_or(slug),
    frontmatter_description.clone(),
    frontmatter_description,
    "github",
    None,
    false,
    "github",
    Some(repo_url.clone()),
    Some(repo_url),
    None,
    vec!["github".to_string(), "skill-md".to_string()],
  )))
}

fn merge_skill_results(results: Vec<Value>, limit: usize) -> Vec<Value> {
  let mut seen = HashSet::<String>::new();
  let mut merged = vec![];
  for result in results {
    let slug = result.get("slug").and_then(Value::as_str).unwrap_or_default().to_string();
    if slug.is_empty() || !seen.insert(slug) {
      continue;
    }
    merged.push(result);
    if merged.len() >= limit {
      break;
    }
  }
  merged
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
  fs::create_dir_all(to).map_err(|error| format!("Failed to create directory {}: {error}", to.display()))?;
  for entry in fs::read_dir(from).map_err(|error| format!("Failed to read directory {}: {error}", from.display()))? {
    let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
    let source_path = entry.path();
    let target_path = to.join(entry.file_name());
    if source_path.is_dir() {
      copy_dir_recursive(&source_path, &target_path)?;
    } else {
      fs::copy(&source_path, &target_path).map_err(|error| {
        format!("Failed to copy {} to {}: {error}", source_path.display(), target_path.display())
      })?;
    }
  }
  Ok(())
}

fn installed_status_for_path(path: &Path) -> &'static str {
  if path.exists() { "already-installed" } else { "installed" }
}

#[tauri::command]
pub async fn middleware_skills_discover(input: Option<SkillDiscoverInput>) -> Result<Value, String> {
  let input = input.unwrap_or(SkillDiscoverInput {
    query: None,
    limit: None,
    include_local: None,
    include_claw_hub: None,
    include_github_probe: None,
  });
  let query = input.query.unwrap_or_default().trim().to_string();
  let query_lower = query.to_lowercase();
  let limit = input.limit.unwrap_or(10).clamp(1, 20);
  let include_local = input.include_local.unwrap_or(true);
  let include_clawhub = input.include_claw_hub.unwrap_or(true);
  let include_github_probe = input.include_github_probe.unwrap_or(true);

  let mut warnings = vec![];
  let mut sources = vec![];
  let mut results = vec![];

  if include_local {
    sources.push("local");
    if let Ok(user_root) = openclaw_skill_root_for_scope("user") {
      results.extend(scan_local_skills_in_root(&user_root, "local-user", &query_lower));
    }
    if let Ok(workspace_root) = openclaw_skill_root_for_scope("workspace") {
      results.extend(scan_local_skills_in_root(&workspace_root, "local-workspace", &query_lower));
    }
  }

  if include_clawhub {
    sources.push("clawhub");
    if query.is_empty() {
      warnings.push("ClawHub search needs a query, so discovery returned local matches only.".to_string());
    } else {
      match clawhub_search_skills(&query, limit).await {
        Ok(items) => results.extend(items),
        Err(error) => warnings.push(error),
      }
    }
  }

  if include_github_probe {
    if let Some(probed) = probe_github_skill(&query).await? {
      if !sources.contains(&"github") {
        sources.push("github");
      }
      results.push(probed);
    }
  }

  Ok(json!({
    "query": query,
    "results": merge_skill_results(results, limit),
    "warnings": warnings,
    "sources": sources,
  }))
}

#[tauri::command]
pub async fn middleware_skills_install(input: SkillInstallInput) -> Result<Value, String> {
  let scope = input.scope.as_deref().unwrap_or("user");
  let force = input.force.unwrap_or(false);
  let root = openclaw_skill_root_for_scope(scope)?;
  let mut actions = vec![];
  let mut warnings = vec![];

  let (skill, location_path, status) = match input.source.as_str() {
    "clawhub" => {
      let slug = input.slug.clone().ok_or_else(|| "slug is required for ClawHub installs".to_string())?;
      let install_path = root.join(&slug);
      let status = installed_status_for_path(&install_path).to_string();
      let workdir = if scope == "workspace" { openclaw_user_root()?.join("workspace") } else { openclaw_user_root()? };
      let mut command = tokio::process::Command::new("clawhub");
      command.arg("install").arg(&slug).arg("--workdir").arg(&workdir).arg("--dir").arg("skills");
      if let Some(version) = input.version.as_deref() {
        command.arg("--version").arg(version);
      }
      if force {
        command.arg("--force");
      }
      let output = command.output().await.map_err(|error| format!("Failed to run clawhub install: {error}"))?;
      if !output.status.success() {
        return Err(format!("clawhub install failed: {}", String::from_utf8_lossy(&output.stderr)));
      }
      actions.push(format!("clawhub install {slug}"));
      let raw_skill = fs::read_to_string(install_path.join("SKILL.md")).unwrap_or_default();
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("clawhub:{slug}"),
          slug.clone(),
          frontmatter_name.unwrap_or_else(|| slug.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "clawhub",
          input.version.clone(),
          true,
          "clawhub",
          None,
          Some("https://clawhub.com".to_string()),
          Some(install_path.to_string_lossy().to_string()),
          vec![],
        ),
        install_path,
        status,
      )
    }
    "github" => {
      let repo_url = input.repo_url.clone().ok_or_else(|| "repoUrl is required for GitHub installs".to_string())?;
      let (_, repo, normalized_repo_url) = parse_github_repo_reference(&repo_url)
        .ok_or_else(|| "repoUrl must be a GitHub repository URL or owner/repo".to_string())?;
      let install_path = root.join(&repo);
      let status = installed_status_for_path(&install_path).to_string();
      if install_path.exists() {
        if !force {
          warnings.push("Skill already exists locally. Returning current install metadata without overwriting.".to_string());
        } else {
          fs::remove_dir_all(&install_path)
            .map_err(|error| format!("Failed to replace existing skill install {}: {error}", install_path.display()))?;
        }
      }
      if !install_path.exists() {
        let mut command = tokio::process::Command::new("git");
        command.arg("clone").arg("--depth").arg("1");
        if let Some(git_ref) = input.git_ref.as_deref() {
          command.arg("--branch").arg(git_ref);
        }
        command.arg(&normalized_repo_url).arg(&install_path);
        let output = command.output().await.map_err(|error| format!("Failed to clone skill repo: {error}"))?;
        if !output.status.success() {
          return Err(format!("Git clone failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
        actions.push(format!("git clone {} {}", normalized_repo_url, install_path.display()));
      }
      let skill_md = install_path.join("SKILL.md");
      if !skill_md.exists() {
        return Err(format!("Installed repository is missing SKILL.md: {}", install_path.display()));
      }
      let raw_skill = fs::read_to_string(&skill_md).map_err(|error| format!("Failed to read {}: {error}", skill_md.display()))?;
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("github:{repo}"),
          repo.clone(),
          frontmatter_name.unwrap_or_else(|| repo.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "github",
          None,
          true,
          "github",
          Some(normalized_repo_url.clone()),
          Some(normalized_repo_url),
          Some(install_path.to_string_lossy().to_string()),
          vec!["github".to_string(), "skill-md".to_string()],
        ),
        install_path,
        status,
      )
    }
    "local" => {
      let local_path = PathBuf::from(input.local_path.clone().ok_or_else(|| "localPath is required for local installs".to_string())?);
      let skill_md = local_path.join("SKILL.md");
      if !skill_md.exists() {
        return Err(format!("Local skill path must contain SKILL.md: {}", local_path.display()));
      }
      let slug = local_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Could not derive skill slug from {}", local_path.display()))?
        .to_string();
      let install_path = root.join(&slug);
      let status = installed_status_for_path(&install_path).to_string();
      if install_path.exists() {
        if !force {
          warnings.push("Skill already exists locally. Returning current install metadata without overwriting.".to_string());
        } else {
          fs::remove_dir_all(&install_path)
            .map_err(|error| format!("Failed to replace existing skill install {}: {error}", install_path.display()))?;
        }
      }
      if !install_path.exists() {
        copy_dir_recursive(&local_path, &install_path)?;
        actions.push(format!("copy {} {}", local_path.display(), install_path.display()));
      }
      let raw_skill = fs::read_to_string(install_path.join("SKILL.md")).unwrap_or_default();
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("local:{slug}"),
          slug.clone(),
          frontmatter_name.unwrap_or_else(|| slug.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "local",
          None,
          true,
          "local",
          None,
          None,
          Some(install_path.to_string_lossy().to_string()),
          vec![],
        ),
        install_path,
        status,
      )
    }
    other => return Err(format!("Unsupported skill install source: {other}")),
  };

  Ok(json!({
    "status": status,
    "skill": skill,
    "location": {
      "scope": scope,
      "root": root.to_string_lossy().to_string(),
      "path": location_path.to_string_lossy().to_string(),
    },
    "actions": actions,
    "warnings": warnings,
  }))
}

// ============================================================================
// SYNC ENGINE
// ============================================================================

fn snapshot_dirty_entities(conn: &Connection, device_id: &str) -> Result<LocalSnapshot, String> {
  let mut projects = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, updated_at FROM projects WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty projects: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncProject {
          id: row.get(0)?,
          name: row.get(1)?,
          profile_id: row.get(2)?,
          workspace_root: row.get(3)?,
          repo_root: row.get(4)?,
          archived: sql_to_bool(row.get::<_, i64>(5)?),
          updated_at: row.get(6)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty projects: {e}"))?;
    for row in rows {
      projects.push(row.map_err(|e| format!("Failed to decode dirty project: {e}"))?);
    }
  }

  let mut topics = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, project_id, name, archived, sort_order, updated_at FROM topics WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty topics: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncTopic {
          id: row.get(0)?,
          project_id: row.get(1)?,
          name: row.get(2)?,
          archived: sql_to_bool(row.get::<_, i64>(3)?),
          sort_order: row.get(4)?,
          updated_at: row.get(5)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty topics: {e}"))?;
    for row in rows {
      topics.push(row.map_err(|e| format!("Failed to decode dirty topic: {e}"))?);
    }
  }

  let mut session_mappings = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, pinned, hidden, source, updated_at FROM session_mappings WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty session mappings: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncSessionMapping {
          session_key: row.get(0)?,
          session_id: row.get(1)?,
          project_id: row.get(2)?,
          topic_id: row.get(3)?,
          agent_id: row.get(4)?,
          label: row.get(5)?,
          status: row.get(6)?,
          pinned: sql_to_bool(row.get::<_, i64>(7)?),
          hidden: sql_to_bool(row.get::<_, i64>(8)?),
          source: row.get(9)?,
          updated_at: row.get(10)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty session mappings: {e}"))?;
    for row in rows {
      session_mappings.push(row.map_err(|e| format!("Failed to decode dirty session mapping: {e}"))?);
    }
  }

  let mut branches = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at FROM branches WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty branches: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        let created_at: String = row.get(6)?;
        Ok(SyncBranch {
          id: row.get(0)?,
          source_session_key: row.get(1)?,
          source_message_id: row.get(2)?,
          branch_session_key: row.get(3)?,
          branch_topic_id: row.get(4)?,
          branch_reason: row.get(5)?,
          created_at: created_at.clone(),
          updated_at: created_at,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty branches: {e}"))?;
    for row in rows {
      branches.push(row.map_err(|e| format!("Failed to decode dirty branch: {e}"))?);
    }
  }

  let mut tombstones = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT entity_type, entity_id, deleted_at, deleted_by, expires_at FROM sync_tombstones WHERE expires_at > ?")
      .map_err(|e| format!("Failed to query tombstones: {e}"))?;
    let rows = stmt
      .query_map(params![now_iso()], |row| {
        Ok(SyncTombstone {
          entity_type: row.get(0)?,
          entity_id: row.get(1)?,
          deleted_at: row.get(2)?,
          deleted_by: row.get(3)?,
          expires_at: row.get(4)?,
        })
      })
      .map_err(|e| format!("Failed to read tombstones: {e}"))?;
    for row in rows {
      tombstones.push(row.map_err(|e| format!("Failed to decode tombstone: {e}"))?);
    }
  }

  Ok(LocalSnapshot { projects, topics, session_mappings, branches, tombstones })
}

fn merge_sync_states(
  local: &LocalSnapshot,
  remote: &SyncState,
  device_id: &str,
  device_name: &str,
) -> MergeResult {
  let mut merged = remote.clone();
  let mut to_upsert_locally: Vec<MergeEntity> = Vec::new();
  let mut to_delete_locally: Vec<(String, String)> = Vec::new();
  let mut pulled: usize = 0;
  let mut pushed: usize = 0;

  // Merge projects
  for lp in &local.projects {
    match merged.projects.get(&lp.id) {
      Some(rp) if rp.updated_at >= lp.updated_at => {}
      _ => {
        merged.projects.insert(lp.id.clone(), lp.clone());
        pushed += 1;
      }
    }
  }
  for (id, rp) in &remote.projects {
    if !local.projects.iter().any(|lp| lp.id == *id) {
      to_upsert_locally.push(MergeEntity::Project(rp.clone()));
      pulled += 1;
    } else {
      let lp = local.projects.iter().find(|lp| lp.id == *id).unwrap();
      if rp.updated_at > lp.updated_at {
        to_upsert_locally.push(MergeEntity::Project(rp.clone()));
        pulled += 1;
      }
    }
  }

  // Merge topics
  for lt in &local.topics {
    match merged.topics.get(&lt.id) {
      Some(rt) if rt.updated_at >= lt.updated_at => {}
      _ => {
        merged.topics.insert(lt.id.clone(), lt.clone());
        pushed += 1;
      }
    }
  }
  for (id, rt) in &remote.topics {
    if !local.topics.iter().any(|lt| lt.id == *id) {
      to_upsert_locally.push(MergeEntity::Topic(rt.clone()));
      pulled += 1;
    } else {
      let lt = local.topics.iter().find(|lt| lt.id == *id).unwrap();
      if rt.updated_at > lt.updated_at {
        to_upsert_locally.push(MergeEntity::Topic(rt.clone()));
        pulled += 1;
      }
    }
  }

  // Merge session mappings
  for ls in &local.session_mappings {
    match merged.session_mappings.get(&ls.session_key) {
      Some(rs) if rs.updated_at >= ls.updated_at => {}
      _ => {
        merged.session_mappings.insert(ls.session_key.clone(), ls.clone());
        pushed += 1;
      }
    }
  }
  for (key, rs) in &remote.session_mappings {
    if !local.session_mappings.iter().any(|ls| ls.session_key == *key) {
      to_upsert_locally.push(MergeEntity::SessionMapping(rs.clone()));
      pulled += 1;
    } else {
      let ls = local.session_mappings.iter().find(|ls| ls.session_key == *key).unwrap();
      if rs.updated_at > ls.updated_at {
        to_upsert_locally.push(MergeEntity::SessionMapping(rs.clone()));
        pulled += 1;
      }
    }
  }

  // Merge branches
  for lb in &local.branches {
    match merged.branches.get(&lb.branch_session_key) {
      Some(rb) if rb.updated_at >= lb.updated_at => {}
      _ => {
        merged.branches.insert(lb.branch_session_key.clone(), lb.clone());
        pushed += 1;
      }
    }
  }
  for (key, rb) in &remote.branches {
    if !local.branches.iter().any(|lb| lb.branch_session_key == *key) {
      to_upsert_locally.push(MergeEntity::Branch(rb.clone()));
      pulled += 1;
    } else {
      let lb = local.branches.iter().find(|lb| lb.branch_session_key == *key).unwrap();
      if rb.updated_at > lb.updated_at {
        to_upsert_locally.push(MergeEntity::Branch(rb.clone()));
        pulled += 1;
      }
    }
  }

  // Merge tombstones: combine all non-expired tombstones
  let now = now_iso();
  let mut all_tombstones: HashMap<(String, String), SyncTombstone> = HashMap::new();
  for t in &remote.tombstones {
    if t.expires_at > now {
      all_tombstones.insert((t.entity_type.clone(), t.entity_id.clone()), t.clone());
    }
  }
  for t in &local.tombstones {
    if t.expires_at > now {
      let key = (t.entity_type.clone(), t.entity_id.clone());
      match all_tombstones.get(&key) {
        Some(existing) if existing.deleted_at >= t.deleted_at => {}
        _ => { all_tombstones.insert(key, t.clone()); }
      }
    }
  }

  // Apply tombstones: remove entities that have been deleted
  for ((etype, eid), tombstone) in &all_tombstones {
    match etype.as_str() {
      "project" => {
        if let Some(p) = merged.projects.get(eid) {
          if tombstone.deleted_at > p.updated_at {
            merged.projects.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "topic" => {
        if let Some(t) = merged.topics.get(eid) {
          if tombstone.deleted_at > t.updated_at {
            merged.topics.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "session_mapping" => {
        if let Some(s) = merged.session_mappings.get(eid) {
          if tombstone.deleted_at > s.updated_at {
            merged.session_mappings.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "branch" => {
        if let Some(b) = merged.branches.get(eid) {
          if tombstone.deleted_at > b.updated_at {
            merged.branches.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      _ => {}
    }
  }

  // Remove upserts for entities that were tombstoned
  let delete_set: HashSet<(String, String)> = to_delete_locally.iter().cloned().collect();
  to_upsert_locally.retain(|entity| {
    let key = match entity {
      MergeEntity::Project(p) => ("project".to_string(), p.id.clone()),
      MergeEntity::Topic(t) => ("topic".to_string(), t.id.clone()),
      MergeEntity::SessionMapping(s) => ("session_mapping".to_string(), s.session_key.clone()),
      MergeEntity::Branch(b) => ("branch".to_string(), b.branch_session_key.clone()),
    };
    !delete_set.contains(&key)
  });

  merged.tombstones = all_tombstones.into_values().collect();
  merged.last_writer = SyncLastWriter {
    device_id: device_id.to_string(),
    device_name: device_name.to_string(),
    written_at: now_iso(),
  };

  MergeResult { to_upsert_locally, to_delete_locally, new_remote_state: merged, pulled, pushed }
}

fn apply_sync_changes(conn: &Connection, result: &MergeResult) -> Result<(), String> {
  // Apply upserts
  for entity in &result.to_upsert_locally {
    match entity {
      MergeEntity::Project(p) => {
        conn.execute(
          "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, created_at, updated_at, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0) \
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace_root=excluded.workspace_root, repo_root=excluded.repo_root, archived=excluded.archived, updated_at=excluded.updated_at, sync_dirty=0",
          params![p.id, p.name, p.profile_id, p.workspace_root, p.repo_root, bool_to_sql(p.archived), p.updated_at, p.updated_at],
        ).map_err(|e| format!("Failed to upsert synced project: {e}"))?;
      }
      MergeEntity::Topic(t) => {
        conn.execute(
          "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at, sync_dirty) \
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0) \
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, archived=excluded.archived, sort_order=excluded.sort_order, updated_at=excluded.updated_at, sync_dirty=0",
          params![t.id, t.project_id, t.name, bool_to_sql(t.archived), t.sort_order, t.updated_at, t.updated_at],
        ).map_err(|e| format!("Failed to upsert synced topic: {e}"))?;
      }
      MergeEntity::SessionMapping(s) => {
        conn.execute(
          "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) \
           ON CONFLICT(session_key) DO UPDATE SET session_id=excluded.session_id, project_id=excluded.project_id, topic_id=excluded.topic_id, label=excluded.label, status=excluded.status, pinned=excluded.pinned, hidden=excluded.hidden, updated_at=excluded.updated_at, sync_dirty=0",
          params![s.session_key, s.session_id, s.project_id, s.topic_id, s.agent_id, s.label, s.status, s.updated_at, s.updated_at, bool_to_sql(s.pinned), bool_to_sql(s.hidden), s.source],
        ).map_err(|e| format!("Failed to upsert synced session mapping: {e}"))?;
      }
      MergeEntity::Branch(b) => {
        conn.execute(
          "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0) \
           ON CONFLICT(branch_session_key) DO UPDATE SET branch_topic_id=excluded.branch_topic_id, branch_reason=excluded.branch_reason, sync_dirty=0",
          params![b.id, b.source_session_key, b.source_message_id, b.branch_session_key, b.branch_topic_id, b.branch_reason, b.created_at],
        ).map_err(|e| format!("Failed to upsert synced branch: {e}"))?;
      }
    }
  }

  // Apply deletes from tombstones
  for (etype, eid) in &result.to_delete_locally {
    match etype.as_str() {
      "project" => {
        conn.execute("DELETE FROM projects WHERE id = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced project: {e}"))?;
      }
      "topic" => {
        conn.execute("DELETE FROM topics WHERE id = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced topic: {e}"))?;
      }
      "session_mapping" => {
        conn.execute("DELETE FROM session_mappings WHERE session_key = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced session mapping: {e}"))?;
      }
      "branch" => {
        conn.execute("DELETE FROM branches WHERE branch_session_key = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced branch: {e}"))?;
      }
      _ => {}
    }
  }

  // Clear sync_dirty on entities we pushed
  conn.execute("UPDATE projects SET sync_dirty = 0 WHERE sync_dirty = 1", [])
    .map_err(|e| format!("Failed to clear project sync_dirty: {e}"))?;
  conn.execute("UPDATE topics SET sync_dirty = 0 WHERE sync_dirty = 1", [])
    .map_err(|e| format!("Failed to clear topic sync_dirty: {e}"))?;
  conn.execute("UPDATE session_mappings SET sync_dirty = 0 WHERE sync_dirty = 1", [])
    .map_err(|e| format!("Failed to clear session_mappings sync_dirty: {e}"))?;
  conn.execute("UPDATE branches SET sync_dirty = 0 WHERE sync_dirty = 1", [])
    .map_err(|e| format!("Failed to clear branches sync_dirty: {e}"))?;

  // Prune expired tombstones
  conn.execute("DELETE FROM sync_tombstones WHERE expires_at <= ?", params![now_iso()])
    .map_err(|e| format!("Failed to prune expired tombstones: {e}"))?;

  Ok(())
}

// ============================================================================
// SYNC: Dual-path I/O (local filesystem vs remote agents.files)
// ============================================================================

fn sync_file_path(workspace_root: &str) -> PathBuf {
  Path::new(workspace_root).join(".jarvis-sync.json")
}

fn read_sync_file_local(workspace_root: &str) -> Result<Option<SyncState>, String> {
  let path = sync_file_path(workspace_root);
  if !path.exists() {
    return Ok(None);
  }
  let data = fs::read_to_string(&path)
    .map_err(|e| format!("Failed to read sync file: {e}"))?;
  let state: SyncState = serde_json::from_str(&data)
    .map_err(|e| format!("Failed to parse sync file: {e}"))?;
  if state.schema_version != 1 {
    return Err(format!("Unsupported sync schema version: {}", state.schema_version));
  }
  Ok(Some(state))
}

fn write_sync_file_local(workspace_root: &str, state: &SyncState) -> Result<(), String> {
  let path = sync_file_path(workspace_root);
  let tmp_path = path.with_extension("json.tmp");
  let data = serde_json::to_string_pretty(state)
    .map_err(|e| format!("Failed to serialize sync state: {e}"))?;
  fs::write(&tmp_path, &data)
    .map_err(|e| format!("Failed to write sync temp file: {e}"))?;
  fs::rename(&tmp_path, &path)
    .map_err(|e| format!("Failed to rename sync file: {e}"))?;
  Ok(())
}

fn encode_sync_state_to_markdown(state: &SyncState) -> Result<String, String> {
  let json = serde_json::to_string_pretty(state)
    .map_err(|e| format!("Failed to serialize sync state: {e}"))?;
  Ok(format!("# Jarvis Sync State\n\nDo not edit this file manually.\n\n```json\n{json}\n```\n"))
}

fn decode_sync_state_from_markdown(markdown: &str) -> Result<Option<SyncState>, String> {
  let start = match markdown.find("```json\n") {
    Some(idx) => idx + 8,
    None => return Ok(None),
  };
  let end = match markdown[start..].find("\n```") {
    Some(idx) => start + idx,
    None => return Err("Malformed sync markdown: missing closing code fence".to_string()),
  };
  let json_str = &markdown[start..end];
  let state: SyncState = serde_json::from_str(json_str)
    .map_err(|e| format!("Failed to parse sync JSON from markdown: {e}"))?;
  if state.schema_version != 1 {
    return Err(format!("Unsupported sync schema version: {}", state.schema_version));
  }
  Ok(Some(state))
}

async fn ensure_sync_agent(socket: &mut GatewaySocket) -> Result<String, String> {
  let list_response = gateway_request(socket, "agents.list", json!({}), 10_000).await?;
  let payload = extract_ok_payload(list_response, "agents.list")?;
  if let Some(agents) = payload.get("agents").and_then(Value::as_array) {
    for agent in agents {
      if agent.get("agentId").and_then(Value::as_str) == Some("jarvis-sync") {
        return Ok("jarvis-sync".to_string());
      }
    }
  }
  let create_response = gateway_request(
    socket,
    "agents.create",
    json!({ "agentId": "jarvis-sync", "displayName": "Jarvis Sync" }),
    10_000,
  )
  .await?;
  extract_ok_payload(create_response, "agents.create")?;
  Ok("jarvis-sync".to_string())
}

async fn read_sync_file_remote(socket: &mut GatewaySocket, agent_id: &str) -> Result<Option<SyncState>, String> {
  let response = gateway_request(
    socket,
    "agents.files.get",
    json!({ "agentId": agent_id, "name": "memory.md" }),
    10_000,
  )
  .await?;
  let payload = extract_ok_payload(response, "agents.files.get")?;
  let content = payload
    .get("content")
    .and_then(Value::as_str)
    .unwrap_or("");
  if content.is_empty() {
    return Ok(None);
  }
  decode_sync_state_from_markdown(content)
}

async fn write_sync_file_remote(socket: &mut GatewaySocket, agent_id: &str, state: &SyncState) -> Result<(), String> {
  let markdown = encode_sync_state_to_markdown(state)?;
  let response = gateway_request(
    socket,
    "agents.files.set",
    json!({ "agentId": agent_id, "name": "memory.md", "content": markdown }),
    10_000,
  )
  .await?;
  extract_ok_payload(response, "agents.files.set")?;
  Ok(())
}

// ============================================================================
// SYNC: Tauri commands
// ============================================================================

#[tauri::command]
pub async fn middleware_sync_full(input: SyncFullInput) -> Result<Value, String> {
  let conn = open_db()?;

  let enabled = get_app_setting(&conn, APP_SETTING_SYNC_ENABLED)?.unwrap_or_default();
  if enabled != "true" {
    return Err("Sync is not enabled".to_string());
  }

  let device_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)?
    .unwrap_or_else(|| Uuid::new_v4().to_string());
  let device_name = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME)?
    .unwrap_or_else(|| "Unknown Device".to_string());

  // Load profile to determine sync path
  let profile: Option<(String, String, String)> = conn
    .query_row(
      "SELECT mode, gateway_url, workspace_root FROM profiles WHERE id = ?",
      params![input.profile_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to load profile: {e}"))?;
  let (mode, _gateway_url, workspace_root) = profile.ok_or("Profile not found")?;

  let local_snapshot = snapshot_dirty_entities(&conn, &device_id)?;

  let (remote_state, is_local_mode) = if mode == "local" {
    (read_sync_file_local(&workspace_root)?, true)
  } else {
    let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    let state = read_sync_file_remote(&mut socket, &agent_id).await?;
    let _ = socket.close(None).await;
    (state, false)
  };

  let remote = remote_state.unwrap_or_else(SyncState::empty);
  let merge_result = merge_sync_states(&local_snapshot, &remote, &device_id, &device_name);

  // Apply changes locally
  apply_sync_changes(&conn, &merge_result)?;

  // Write merged state back
  if is_local_mode {
    write_sync_file_local(&workspace_root, &merge_result.new_remote_state)?;
  } else {
    let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    write_sync_file_remote(&mut socket, &agent_id, &merge_result.new_remote_state).await?;
    let _ = socket.close(None).await;
  }

  set_app_setting(&conn, APP_SETTING_SYNC_LAST_SYNC_AT, &now_iso())?;

  Ok(json!({
    "ok": true,
    "pulled": merge_result.pulled,
    "pushed": merge_result.pushed,
    "conflicts": 0,
  }))
}

#[tauri::command]
pub fn middleware_sync_status() -> Result<Value, String> {
  let conn = open_db()?;
  let enabled = get_app_setting(&conn, APP_SETTING_SYNC_ENABLED)?.unwrap_or_default() == "true";
  let device_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)?;
  let device_name = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME)?;
  let last_sync_at = get_app_setting(&conn, APP_SETTING_SYNC_LAST_SYNC_AT)?;

  let dirty_count: i64 = conn
    .query_row(
      "SELECT \
        (SELECT COUNT(*) FROM projects WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM topics WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM session_mappings WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM branches WHERE sync_dirty = 1)",
      [],
      |row| row.get(0),
    )
    .map_err(|e| format!("Failed to count dirty entities: {e}"))?;

  Ok(json!({
    "enabled": enabled,
    "deviceId": device_id,
    "deviceName": device_name,
    "lastSyncAt": last_sync_at,
    "dirtyCount": dirty_count,
  }))
}

#[tauri::command]
pub fn middleware_sync_enable(input: SyncEnableInput) -> Result<Value, String> {
  let conn = open_db()?;

  if input.enabled {
    // Generate device ID if not already set
    let existing_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)?;
    if existing_id.is_none() {
      let device_id = format!("device_{}", Uuid::new_v4().simple());
      set_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID, &device_id)?;
    }
    let name = input.device_name.unwrap_or_else(|| {
      std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "Unknown Device".to_string())
    });
    set_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME, &name)?;
  }

  set_app_setting(
    &conn,
    APP_SETTING_SYNC_ENABLED,
    if input.enabled { "true" } else { "false" },
  )?;

  Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn middleware_sync_devices(input: SyncDevicesInput) -> Result<Value, String> {
  let conn = open_db()?;

  let profile: Option<(String, String)> = conn
    .query_row(
      "SELECT mode, workspace_root FROM profiles WHERE id = ?",
      params![input.profile_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to load profile: {e}"))?;
  let (mode, workspace_root) = profile.ok_or("Profile not found")?;

  let remote_state = if mode == "local" {
    read_sync_file_local(&workspace_root)?
  } else {
    let mut socket = connect_to_gateway(&["operator.read"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    let state = read_sync_file_remote(&mut socket, &agent_id).await?;
    let _ = socket.close(None).await;
    state
  };

  let mut devices: Vec<Value> = Vec::new();
  if let Some(state) = &remote_state {
    // Collect unique device IDs from all entities
    let mut seen: HashMap<String, (String, String)> = HashMap::new();
    seen.insert(
      state.last_writer.device_id.clone(),
      (state.last_writer.device_name.clone(), state.last_writer.written_at.clone()),
    );
    for p in state.projects.values() {
      seen.entry(p.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), p.updated_at.clone()));
    }
    for t in state.topics.values() {
      seen.entry(t.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), t.updated_at.clone()));
    }
    for s in state.session_mappings.values() {
      seen.entry(s.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), s.updated_at.clone()));
    }
    for b in state.branches.values() {
      seen.entry(b.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), b.updated_at.clone()));
    }
    for (did, (dname, last_seen)) in seen {
      if !did.is_empty() {
        devices.push(json!({
          "deviceId": did,
          "deviceName": dname,
          "lastSeen": last_seen,
        }));
      }
    }
  }

  Ok(json!({ "devices": devices }))
}
