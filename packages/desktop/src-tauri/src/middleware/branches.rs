use super::*;

// ============================================================================
// BRANCH CHAT MIDDLEWARE COMMANDS
// ============================================================================
// Conversation branching/forking - creates new topic from message point

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateInput {
  pub(crate) source_session_key: String,
  pub(crate) source_message_id: String,
  pub(crate) project_id: String,
  pub(crate) branch_name: String,
  pub(crate) branch_reason: Option<String>, // 'regenerate', 'edit', 'manual', 'thread'
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchListInput {
  pub(crate) source_session_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchGetInput {
  pub(crate) branch_session_key: String,
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
  let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {e}"))?;
  let topic_id = format!("topic_{}", Uuid::new_v4().simple());
  let now = now_iso();
  let sort_order: i64 = tx.query_row(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM topics WHERE project_id = ?",
    params![input.project_id],
    |row| row.get(0),
  ).map_err(|error| format!("Failed to compute topic sort order: {error}"))?;

  tx.execute(
    "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
    params![topic_id, input.project_id, input.branch_name, sort_order, now, now],
  ).map_err(|error| format!("Failed to create branch topic: {error}"))?;

  tx.execute(
    "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, 'main', ?, 'idle', ?, ?, 0, 0, 'jarvis')",
    params![branch_session_key, input.project_id, topic_id, input.branch_name, now, now],
  ).map_err(|error| format!("Failed to store branch session mapping: {error}"))?;

  let branch_id = format!("branch_{}", Uuid::new_v4().simple());
  tx.execute(
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

  let mut stmt = tx.prepare("SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json FROM branches WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created branch: {error}"))?;
  let branch = stmt.query_row(params![branch_id], branch_row_to_json)
    .map_err(|error| format!("Failed to decode created branch: {error}"))?;
  drop(stmt);
  tx.commit().map_err(|e| format!("Failed to commit branch create: {e}"))?;

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

  let now = now_iso();
  conn.execute(
    "UPDATE topics SET archived = 1, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![now, topic_id],
  ).map_err(|error| format!("Failed to archive branch topic: {error}"))?;

  conn.execute(
    "UPDATE session_mappings SET hidden = 1, updated_at = ?, sync_dirty = 1 WHERE session_key = ?",
    params![now, input.branch_session_key],
  ).ok(); // ok() since the session might not exist locally

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


