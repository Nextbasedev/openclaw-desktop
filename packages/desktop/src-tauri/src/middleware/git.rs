use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteAddInput {
  pub(crate) project_id: String,
  pub(crate) remote_name: String,
  pub(crate) remote_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRemoveInput {
  pub(crate) project_id: String,
  pub(crate) remote_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteListInput {
  pub(crate) project_id: String,
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


