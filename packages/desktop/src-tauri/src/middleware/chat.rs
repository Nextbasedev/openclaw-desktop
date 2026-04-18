use super::*;

pub(crate) fn normalize_history(payload: &Value, session_key: &str) -> Value {
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


pub(crate) fn detect_capabilities_for_workspace(workspace_root: &str) -> Value {
  let exists = Path::new(workspace_root).exists();
  json!({
    "openclaw": true,
    "files": exists,
    "git": exists,
    "terminal": exists,
    "bootstrap": false,
  })
}


pub(crate) fn repo_summary_for_root(root: &str) -> Option<Value> {
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


