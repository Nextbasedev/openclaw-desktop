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
    "#,
  )
  .map_err(|error| format!("Failed to initialize SQLite schema: {error}"))?;
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
    "UPDATE projects SET name = ?, workspace_root = ?, repo_root = ?, archived = ?, updated_at = ? WHERE id = ?",
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
    "UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?",
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
    "UPDATE topics SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?",
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
    "UPDATE topics SET archived = ?, updated_at = ? WHERE id = ?",
    params![bool_to_sql(archived), now_iso(), input.topic_id],
  ).map_err(|error| format!("Failed to archive topic: {error}"))?;
  Ok(json!({ "ok": true, "topicId": input.topic_id, "archived": archived }))
}

#[tauri::command]
pub fn middleware_topics_attach_session(input: TopicSessionInput) -> Result<Value, String> {
  let conn = open_db()?;
  conn.execute(
    "UPDATE session_mappings SET topic_id = ?, updated_at = ? WHERE session_key = ?",
    params![input.topic_id, now_iso(), input.session_key],
  ).map_err(|error| format!("Failed to attach session to topic: {error}"))?;
  Ok(json!({ "ok": true, "topicId": input.topic_id, "sessionKey": input.session_key }))
}

#[tauri::command]
pub fn middleware_topics_detach_session(input: TopicSessionInput) -> Result<Value, String> {
  let conn = open_db()?;
  conn.execute(
    "UPDATE session_mappings SET topic_id = NULL, updated_at = ? WHERE session_key = ?",
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
    "UPDATE session_mappings SET label = ?, pinned = ?, hidden = ?, topic_id = ?, updated_at = ? WHERE session_key = ?",
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

// Helper to normalize cron job from gateway response
fn normalize_cron_job(value: &Value) -> Value {
  json!({
    "id": string_from_value(value.get("id")),
    "name": string_from_value(value.get("name")).unwrap_or_default(),
    "schedule": string_from_value(value.get("schedule")).unwrap_or_default(),
    "enabled": value.get("enabled").and_then(Value::as_bool).unwrap_or(true),
    "task": string_from_value(value.get("task")).unwrap_or_default(),
    "params": value.get("params").cloned(),
    "lastRunAt": timestamp_to_string(value.get("lastRunAt")),
    "nextRunAt": timestamp_to_string(value.get("nextRunAt")),
    "createdAt": timestamp_to_string(value.get("createdAt")).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "updatedAt": timestamp_to_string(value.get("updatedAt")).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "status": string_from_value(value.get("status")).unwrap_or_else(|| "idle".to_string()),
    "runCount": value.get("runCount").and_then(Value::as_i64).unwrap_or(0),
    "failCount": value.get("failCount").and_then(Value::as_i64).unwrap_or(0),
    "metadata": value.get("metadata").cloned(),
  })
}

// Helper to normalize cron run from gateway response
fn normalize_cron_run(value: &Value) -> Value {
  json!({
    "id": string_from_value(value.get("id")),
    "jobId": string_from_value(value.get("jobId")),
    "status": string_from_value(value.get("status")).unwrap_or_else(|| "unknown".to_string()),
    "startedAt": timestamp_to_string(value.get("startedAt")),
    "completedAt": timestamp_to_string(value.get("completedAt")),
    "summary": string_from_value(value.get("summary")),
    "error": string_from_value(value.get("error")),
    "output": string_from_value(value.get("output")),
    "deliveryStatus": string_from_value(value.get("deliveryStatus")),
    "metadata": value.get("metadata").cloned(),
  })
}

#[tauri::command]
pub async fn middleware_cron_list_jobs(_input: CronListJobsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let payload = extract_ok_payload(
    gateway_request(&mut socket, "cron.list", json!({}), 30_000).await?,
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
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let payload = extract_ok_payload(
    gateway_request(&mut socket, "cron.status", json!({ "id": input.job_id }), 30_000).await?,
    "cron.status",
  )?;
  let _ = socket.close(None).await;

  let job = payload.get("job").map(normalize_cron_job).ok_or("Job not found")?;
  let current_run = payload.get("currentRun").map(normalize_cron_run);

  Ok(json!({
    "job": job,
    "currentRun": current_run,
  }))
}

#[tauri::command]
pub async fn middleware_cron_create_job(input: CronCreateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "cron.add",
      json!({
        "name": input.name,
        "schedule": input.schedule,
        "task": input.task,
        "params": input.params,
        "enabled": input.enabled.unwrap_or(true),
        "metadata": input.metadata,
      }),
      30_000,
    )
    .await?,
    "cron.add",
  )?;
  let _ = socket.close(None).await;

  let job = payload.get("job").map(normalize_cron_job).ok_or("Failed to create job")?;
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_update_job(input: CronUpdateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
  
  let mut update_params = json!({ "id": input.job_id });
  if let Some(name) = input.name {
    update_params["name"] = json!(name);
  }
  if let Some(schedule) = input.schedule {
    update_params["schedule"] = json!(schedule);
  }
  if let Some(task) = input.task {
    update_params["task"] = json!(task);
  }
  if let Some(params) = input.params {
    update_params["params"] = params;
  }
  if let Some(enabled) = input.enabled {
    update_params["enabled"] = json!(enabled);
  }
  if let Some(metadata) = input.metadata {
    update_params["metadata"] = metadata;
  }

  let payload = extract_ok_payload(
    gateway_request(&mut socket, "cron.update", update_params, 30_000).await?,
    "cron.update",
  )?;
  let _ = socket.close(None).await;

  let job = payload.get("job").map(normalize_cron_job).ok_or("Failed to update job")?;
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_delete_job(input: CronDeleteJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
  extract_ok_payload(
    gateway_request(&mut socket, "cron.remove", json!({ "id": input.job_id }), 30_000).await?,
    "cron.remove",
  )?;
  let _ = socket.close(None).await;

  Ok(json!({ "ok": true, "jobId": input.job_id }))
}

#[tauri::command]
pub async fn middleware_cron_run_job(input: CronRunJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "cron.run",
      json!({
        "id": input.job_id,
        "params": input.params,
      }),
      60_000,
    )
    .await?,
    "cron.run",
  )?;
  let _ = socket.close(None).await;

  Ok(json!({
    "runId": string_from_value(payload.get("runId")),
    "jobId": input.job_id,
    "status": string_from_value(payload.get("status")).unwrap_or_else(|| "started".to_string()),
  }))
}

#[tauri::command]
pub async fn middleware_cron_job_status(input: CronJobStatusInput) -> Result<Value, String> {
  middleware_cron_get_job(CronGetJobInput { job_id: input.job_id }).await
}

#[tauri::command]
pub async fn middleware_cron_list_runs(input: CronListRunsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "cron.runs",
      json!({
        "id": input.job_id,
        "limit": input.limit.unwrap_or(20),
        "sortDir": input.sort_dir.as_deref().unwrap_or("desc"),
        "afterTs": input.after_ts,
      }),
      30_000,
    )
    .await?,
    "cron.runs",
  )?;
  let _ = socket.close(None).await;

  let runs = payload
    .get("entries")
    .and_then(Value::as_array)
    .map(|arr| arr.iter().map(normalize_cron_run).collect::<Vec<_>>())
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
  // 1. Get chat history up to the source message
  let history = middleware_chat_history(SessionKeyInput { session_key: input.source_session_key.clone() }).await?;
  
  // 2. Create new session for the branch
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
  
  // 3. Create new topic for the branch
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
  
  // 4. Create session mapping for the branch
  conn.execute(
    "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, 'main', ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    params![branch_session_key, input.project_id, topic_id, input.branch_name, now, now],
  ).map_err(|error| format!("Failed to store branch session mapping: {error}"))?;
  
  // 5. Store branch relationship in database
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
  
  // 6. Return branch info
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
  
  // Get branch info first
  let branch_topic_id: Option<String> = conn.query_row(
    "SELECT branch_topic_id FROM branches WHERE branch_session_key = ?",
    params![input.branch_session_key],
    |row| row.get(0),
  ).optional().map_err(|error| format!("Failed to find branch: {error}"))?;
  
  let topic_id = branch_topic_id.ok_or("Branch not found")?;
  
  // Delete branch record
  conn.execute(
    "DELETE FROM branches WHERE branch_session_key = ?",
    params![input.branch_session_key],
  ).map_err(|error| format!("Failed to delete branch: {error}"))?;
  
  // Archive the topic (don't delete, preserve history)
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
  
  // Send the edited message in the new branch
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
