use std::{
  collections::{HashMap, HashSet},
  path::PathBuf,
  sync::Arc,
  time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{pkcs8::DecodePrivateKey, Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
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

const MIDDLEWARE_CONTRACT_VERSION: &str = "2026-04-17";
const DEFAULT_GATEWAY_PORT: u16 = 18789;
const PROTOCOL_VERSION: u8 = 3;
const DEFAULT_GATEWAY_ORIGIN: &str = "http://127.0.0.1:3000";
const DEFAULT_MODEL: &str = "openai-codex/gpt-5.4";
const DEFAULT_AGENT_ID: &str = "main";
const STREAM_EVENT_NAME: &str = "middleware://chat-event";

#[derive(Default)]
pub struct MiddlewareState {
  streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
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

  let signed_at = chrono::Utc::now().timestamp_millis();
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
          .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
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

fn emit_stream_event(app: &AppHandle, stream_id: &str, event: Value) {
  let _ = app.emit(
    STREAM_EVENT_NAME,
    json!({
      "streamId": stream_id,
      "event": event,
    }),
  );
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
            emit_stream_event(&app, &stream_id, json!({
              "type": "chat.error",
              "sessionKey": session_key,
              "message": error,
            }));
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
              emit_stream_event(&app, &stream_id, json!({
                "type": "chat.status",
                "sessionKey": session_key,
                "state": "tool_running",
              }));
              continue;
            }

            let text = content_blocks_to_text(chat_message.get("content"));
            emit_stream_event(&app, &stream_id, json!({
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
            emit_stream_event(&app, &stream_id, json!({
              "type": "chat.status",
              "sessionKey": session_key,
              "state": if text.is_empty() { "streaming" } else { "done" },
            }));
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
            emit_stream_event(&app, &stream_id, json!({
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
            emit_stream_event(&app, &stream_id, json!({
              "type": "chat.status",
              "sessionKey": session_key,
              "state": match data.get("phase").and_then(Value::as_str) {
                Some("error") => "error",
                Some("result") => "thinking",
                _ => "tool_running",
              },
              "label": string_from_value(data.get("name")),
            }));
          }
          _ => {}
        }
      }
    }
  }
}

#[tauri::command]
pub fn middleware_runtime_info() -> MiddlewareRuntimeInfo {
  MiddlewareRuntimeInfo {
    contract_version: MIDDLEWARE_CONTRACT_VERSION,
    transport: "tauri-ipc+gateway-ws",
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
pub async fn middleware_chat_create_session(input: ChatCreateSessionInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.write", "operator.approvals", "operator.admin"]).await?;
  let payload = extract_ok_payload(
    gateway_request(
      &mut socket,
      "sessions.create",
      json!({
        "agentId": input.agent_id.unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
        "label": input.label.unwrap_or_else(|| format!("Jarvis desktop session {}", chrono::Utc::now().to_rfc3339())),
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

  emit_stream_event(&app, &stream_id, json!({
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
  emit_stream_event(&app, &stream_id, json!({
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
