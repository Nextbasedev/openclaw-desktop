use super::*;

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
    params![now, metadata_json(&capabilities), now, input.profile_id],
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
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at, pinned FROM projects ORDER BY pinned DESC, updated_at DESC")
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
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at, pinned FROM projects WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created project: {error}"))?;
  let project = stmt.query_row(params![id], project_row_to_json).map_err(|error| format!("Failed to decode created project: {error}"))?;
  Ok(json!({ "project": project }))
}

#[tauri::command]
pub fn middleware_projects_get(input: ProjectIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at, pinned FROM projects WHERE id = ?")
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
  let mut stmt = conn.prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at, pinned FROM projects WHERE id = ?")
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
pub fn middleware_projects_pin(input: ProjectPinInput) -> Result<Value, String> {
  let pinned = input.pinned.unwrap_or(true);
  let conn = open_db()?;
  let changed = conn.execute(
    "UPDATE projects SET pinned = ?, updated_at = ?, sync_dirty = 1 WHERE id = ?",
    params![bool_to_sql(pinned), now_iso(), input.project_id],
  ).map_err(|error| format!("Failed to pin project: {error}"))?;
  if changed == 0 {
    return Err(format!("Project not found: {}", input.project_id));
  }
  Ok(json!({ "ok": true, "projectId": input.project_id, "pinned": pinned }))
}

#[tauri::command]
pub fn middleware_projects_delete(input: ProjectIdInput) -> Result<Value, String> {
  let conn = open_db()?;
  let exists: bool = conn.query_row(
    "SELECT COUNT(*) FROM projects WHERE id = ?",
    params![input.project_id],
    |row| row.get::<_, i64>(0),
  ).map_err(|error| format!("Failed to check project existence: {error}"))? > 0;
  if !exists {
    return Err(format!("Project not found: {}", input.project_id));
  }
  conn.execute("DELETE FROM session_mappings WHERE project_id = ?", params![input.project_id])
    .map_err(|error| format!("Failed to delete project sessions: {error}"))?;
  conn.execute("DELETE FROM topics WHERE project_id = ?", params![input.project_id])
    .map_err(|error| format!("Failed to delete project topics: {error}"))?;
  conn.execute("DELETE FROM projects WHERE id = ?", params![input.project_id])
    .map_err(|error| format!("Failed to delete project: {error}"))?;
  Ok(json!({ "ok": true, "projectId": input.project_id }))
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


