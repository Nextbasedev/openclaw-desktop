use super::*;

// ── Input structs ────────────────────────────────────────────────────────────

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContextInput {
  pub(crate) project_id: String,
  pub(crate) topic_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSwitchBranchInput {
  pub(crate) project_id: String,
  pub(crate) branch_name: String,
  pub(crate) create: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesInput {
  pub(crate) project_id: String,
}

// ── Git detection helpers (called from chat.rs stream loop) ──────────────────

const GIT_SUBCOMMANDS_WITH_BRANCH: &[&str] = &[
  "checkout", "switch", "branch", "merge", "rebase", "cherry-pick",
  "pull", "push", "fetch",
];

pub(crate) fn detect_git_tool_call(data: &Value) -> Option<(String, String)> {
  let name = data.get("name").and_then(Value::as_str)?;
  if name != "Bash" && name != "bash" && name != "Terminal" && name != "terminal" {
    return None;
  }
  let phase = data.get("phase").and_then(Value::as_str)?;
  if phase != "invoke" {
    return None;
  }
  let command = data
    .get("args")
    .and_then(|a| a.get("command"))
    .and_then(Value::as_str)?;
  if !command.contains("git ") && !command.starts_with("git\t") {
    return None;
  }
  let parts: Vec<&str> = command.split_whitespace().collect();
  let git_idx = parts.iter().position(|&p| p == "git")?;
  let subcommand = parts.get(git_idx + 1).copied()?;
  if GIT_SUBCOMMANDS_WITH_BRANCH.contains(&subcommand) {
    if let Some(branch) = extract_branch_from_command(subcommand, &parts[git_idx..]) {
      return Some((branch, command.to_string()));
    }
  }
  Some(("__detect_from_repo__".to_string(), command.to_string()))
}

pub(crate) fn extract_branch_from_command(subcommand: &str, parts: &[&str]) -> Option<String> {
  let args: Vec<&&str> = parts.iter().skip(2).filter(|p| !p.starts_with('-')).collect();
  match subcommand {
    "checkout" | "switch" => {
      // git checkout <branch> or git switch <branch>
      // skip if it looks like a file path (contains / with extension)
      let candidate = args.first().copied().copied()?;
      if candidate.contains('.') && candidate.contains('/') {
        return None;
      }
      Some(candidate.to_string())
    }
    "branch" => {
      // git branch <new-branch> — creating a branch
      if parts.contains(&"-d") || parts.contains(&"-D") || parts.contains(&"--delete") {
        return None;
      }
      args.first().copied().copied().map(|s| s.to_string())
    }
    "merge" | "rebase" | "cherry-pick" => {
      args.first().copied().copied().map(|s| s.to_string())
    }
    "pull" | "push" | "fetch" => {
      // git pull origin main → branch is the second non-flag arg
      args.get(1).copied().copied().map(|s| s.to_string())
    }
    _ => None,
  }
}

pub(crate) fn store_git_context_for_session(
  session_key: &str,
  branch_name: &str,
  command: &str,
) -> Result<(), String> {
  let conn = open_db()?;
  let mapping: Option<(Option<String>, Option<String>)> = conn
    .query_row(
      "SELECT topic_id, project_id FROM session_mappings WHERE session_key = ?",
      params![session_key],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to look up session mapping: {e}"))?;

  let (topic_id, project_id) = match mapping {
    Some((Some(t), Some(p))) => (t, p),
    _ => return Ok(()),
  };

  let repo_root = match project_repo_root(&project_id) {
    Ok(r) => r.to_string_lossy().to_string(),
    Err(_) => return Ok(()),
  };

  let now = now_iso();
  let id = Uuid::new_v4().to_string();
  conn.execute(
    r#"INSERT INTO topic_git_context (id, topic_id, project_id, branch_name, repo_root, detected_command, detected_at, session_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(topic_id, branch_name) DO UPDATE SET
         detected_command = excluded.detected_command,
         detected_at = excluded.detected_at,
         session_key = excluded.session_key"#,
    params![id, topic_id, project_id, branch_name, repo_root, command, now, session_key],
  )
  .map_err(|e| format!("Failed to store git context: {e}"))?;

  Ok(())
}

pub(crate) async fn detect_current_branch(repo_root: &Path) -> Option<String> {
  let output = tokio::process::Command::new("git")
    .args(&["rev-parse", "--abbrev-ref", "HEAD"])
    .current_dir(repo_root)
    .output()
    .await
    .ok()?;
  if !output.status.success() {
    return None;
  }
  let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if branch.is_empty() || branch == "HEAD" {
    return None;
  }
  Some(branch)
}

// ── Existing remote commands ─────────────────────────────────────────────────

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

// ── New git context commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn middleware_git_context(input: GitContextInput) -> Result<Value, String> {
  let repo_root = project_repo_root(&input.project_id)?;
  let git_dir = repo_root.join(".git");
  if !git_dir.exists() {
    return Ok(json!({
      "hasGit": false,
      "projectId": input.project_id,
    }));
  }

  let current_branch = detect_current_branch(&repo_root).await;

  // git status --porcelain for uncommitted changes
  let status_output = tokio::process::Command::new("git")
    .args(&["status", "--porcelain"])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to run git status: {e}"))?;

  let changes: Vec<Value> = if status_output.status.success() {
    String::from_utf8_lossy(&status_output.stdout)
      .lines()
      .filter(|l| !l.is_empty())
      .map(|line| {
        let status_code = line.get(..2).unwrap_or("??").trim().to_string();
        let file_path = line.get(3..).unwrap_or("").to_string();
        json!({ "status": status_code, "path": file_path })
      })
      .collect()
  } else {
    vec![]
  };

  // recent commits (last 10)
  let log_output = tokio::process::Command::new("git")
    .args(&["log", "--oneline", "-10", "--no-decorate"])
    .current_dir(&repo_root)
    .output()
    .await
    .ok();

  let commits: Vec<Value> = log_output
    .filter(|o| o.status.success())
    .map(|o| {
      String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter_map(|line| {
          let (hash, msg) = line.split_once(' ')?;
          Some(json!({ "hash": hash, "message": msg }))
        })
        .collect()
    })
    .unwrap_or_default();

  // tracked branches from DB for this topic
  let tracked_branches: Vec<Value> = if let Some(ref topic_id) = input.topic_id {
    let conn = open_db()?;
    let mut stmt = conn
      .prepare(
        "SELECT branch_name, detected_command, detected_at FROM topic_git_context WHERE topic_id = ? ORDER BY detected_at DESC",
      )
      .map_err(|e| format!("Failed to query git context: {e}"))?;
    let rows: Vec<Value> = stmt
      .query_map(params![topic_id], |row| {
        Ok(json!({
          "branchName": row.get::<_, String>(0)?,
          "detectedCommand": row.get::<_, Option<String>>(1)?,
          "detectedAt": row.get::<_, String>(2)?,
        }))
      })
      .map_err(|e| format!("Failed to read git context rows: {e}"))?
      .filter_map(|r| r.ok())
      .collect();
    rows
  } else {
    vec![]
  };

  Ok(json!({
    "hasGit": true,
    "projectId": input.project_id,
    "topicId": input.topic_id,
    "currentBranch": current_branch,
    "uncommittedChanges": changes,
    "uncommittedCount": changes.len(),
    "recentCommits": commits,
    "trackedBranches": tracked_branches,
    "repoRoot": repo_root.to_string_lossy(),
  }))
}

#[tauri::command]
pub async fn middleware_git_switch_branch(input: GitSwitchBranchInput) -> Result<Value, String> {
  let repo_root = project_repo_root(&input.project_id)?;
  let git_dir = repo_root.join(".git");
  if !git_dir.exists() {
    return Err("Project has no git repository".to_string());
  }

  // Check for uncommitted changes first
  let status_output = tokio::process::Command::new("git")
    .args(&["status", "--porcelain"])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to check git status: {e}"))?;

  let has_changes = status_output.status.success()
    && !String::from_utf8_lossy(&status_output.stdout).trim().is_empty();

  let mut args = vec!["switch".to_string()];
  if input.create.unwrap_or(false) {
    args.push("-c".to_string());
  }
  args.push(input.branch_name.clone());

  let output = tokio::process::Command::new("git")
    .args(&args)
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to switch branch: {e}"))?;

  if output.status.success() {
    let new_branch = detect_current_branch(&repo_root).await;
    Ok(json!({
      "switched": true,
      "branch": new_branch.unwrap_or_else(|| input.branch_name.clone()),
      "projectId": input.project_id,
      "hadUncommittedChanges": has_changes,
    }))
  } else {
    // If `git switch` fails, try `git checkout` as fallback (older git)
    let mut fallback_args = vec!["checkout".to_string()];
    if input.create.unwrap_or(false) {
      fallback_args.push("-b".to_string());
    }
    fallback_args.push(input.branch_name.clone());

    let fallback = tokio::process::Command::new("git")
      .args(&fallback_args)
      .current_dir(&repo_root)
      .output()
      .await
      .map_err(|e| format!("Failed to checkout branch: {e}"))?;

    if fallback.status.success() {
      let new_branch = detect_current_branch(&repo_root).await;
      Ok(json!({
        "switched": true,
        "branch": new_branch.unwrap_or_else(|| input.branch_name.clone()),
        "projectId": input.project_id,
        "hadUncommittedChanges": has_changes,
      }))
    } else {
      Err(format!(
        "Failed to switch branch: {}",
        String::from_utf8_lossy(&fallback.stderr)
      ))
    }
  }
}

#[tauri::command]
pub async fn middleware_git_branches(input: GitBranchesInput) -> Result<Value, String> {
  let repo_root = project_repo_root(&input.project_id)?;
  let git_dir = repo_root.join(".git");
  if !git_dir.exists() {
    return Ok(json!({
      "hasGit": false,
      "branches": [],
      "current": null,
    }));
  }

  let current_branch = detect_current_branch(&repo_root).await;

  // Local branches
  let local_output = tokio::process::Command::new("git")
    .args(&["branch", "--format=%(refname:short)"])
    .current_dir(&repo_root)
    .output()
    .await
    .map_err(|e| format!("Failed to list branches: {e}"))?;

  let local_branches: Vec<String> = if local_output.status.success() {
    String::from_utf8_lossy(&local_output.stdout)
      .lines()
      .filter(|l| !l.is_empty())
      .map(|l| l.to_string())
      .collect()
  } else {
    vec![]
  };

  // Remote branches
  let remote_output = tokio::process::Command::new("git")
    .args(&["branch", "-r", "--format=%(refname:short)"])
    .current_dir(&repo_root)
    .output()
    .await
    .ok();

  let remote_branches: Vec<String> = remote_output
    .filter(|o| o.status.success())
    .map(|o| {
      String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter(|l| !l.is_empty() && !l.contains("HEAD"))
        .map(|l| l.to_string())
        .collect()
    })
    .unwrap_or_default();

  Ok(json!({
    "hasGit": true,
    "current": current_branch,
    "local": local_branches,
    "remote": remote_branches,
    "projectId": input.project_id,
  }))
}
