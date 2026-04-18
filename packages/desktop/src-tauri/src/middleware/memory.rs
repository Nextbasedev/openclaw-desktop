use super::*;

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListInput {
  pub(crate) project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReadInput {
  pub(crate) path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWriteInput {
  pub(crate) path: String,
  pub(crate) content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchInput {
  pub(crate) query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReindexInput {}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn openclaw_workspace_root() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("workspace"))
}

pub(crate) fn openclaw_memory_db_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("memory").join("main.sqlite"))
}

pub(crate) fn memory_path_to_absolute(workspace: &Path, rel_path: &str) -> PathBuf {
  workspace.join(rel_path)
}

pub(crate) fn absolute_to_memory_path(workspace: &Path, abs_path: &Path) -> Option<String> {
  abs_path.strip_prefix(workspace).ok().map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn is_safe_memory_path(path: &str) -> bool {
  !path.contains("..") && !path.starts_with('/')
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn middleware_memory_list(input: MemoryListInput) -> Result<Value, String> {
  let workspace = openclaw_workspace_root()?;

  let mut documents = Vec::new();

  // MEMORY.md at workspace root
  let memory_md = workspace.join("MEMORY.md");
  if memory_md.exists() {
    let meta = fs::metadata(&memory_md).ok();
    documents.push(json!({
      "path": "MEMORY.md",
      "title": "Main Memory",
      "updatedAt": meta.and_then(|m| m.modified().ok())
        .map(|t| {
          let dt: chrono::DateTime<chrono::Utc> = t.into();
          dt.to_rfc3339()
        }),
    }));
  }

  // memory/ directory
  let memory_dir = workspace.join("memory");
  if memory_dir.is_dir() {
    let mut entries: Vec<_> = fs::read_dir(&memory_dir)
      .map_err(|e| format!("Failed to read memory dir: {e}"))?
      .filter_map(|entry| entry.ok())
      .filter(|entry| {
        entry.path().extension().and_then(|e| e.to_str()) == Some("md")
      })
      .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
      let file_name = entry.file_name().to_string_lossy().to_string();
      let rel_path = format!("memory/{}", file_name);
      let meta = entry.metadata().ok();
      let title = file_name.trim_end_matches(".md").to_string();
      documents.push(json!({
        "path": rel_path,
        "title": title,
        "updatedAt": meta.and_then(|m| m.modified().ok())
          .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.to_rfc3339()
          }),
      }));
    }
  }

  // If projectId provided, also check project-level CLAUDE.md
  if let Some(ref project_id) = input.project_id {
    if let Ok(root) = project_repo_root(project_id) {
      let claude_md = root.join("CLAUDE.md");
      if claude_md.exists() {
        let meta = fs::metadata(&claude_md).ok();
        documents.push(json!({
          "path": format!("project:{}:CLAUDE.md", project_id),
          "projectId": project_id,
          "title": "Project Instructions (CLAUDE.md)",
          "updatedAt": meta.and_then(|m| m.modified().ok())
            .map(|t| {
              let dt: chrono::DateTime<chrono::Utc> = t.into();
              dt.to_rfc3339()
            }),
        }));
      }
    }
  }

  Ok(json!({ "documents": documents }))
}

#[tauri::command]
pub async fn middleware_memory_read(input: MemoryReadInput) -> Result<Value, String> {
  // Handle project-scoped paths like "project:proj_id:CLAUDE.md"
  if input.path.starts_with("project:") {
    let parts: Vec<&str> = input.path.splitn(3, ':').collect();
    if parts.len() == 3 {
      let project_id = parts[1];
      let file_name = parts[2];
      let root = project_repo_root(project_id)?;
      let abs_path = root.join(file_name);
      if !abs_path.starts_with(&root) {
        return Err("Path escapes project root".to_string());
      }
      let content = tokio::fs::read_to_string(&abs_path)
        .await
        .map_err(|e| format!("Failed to read {}: {e}", abs_path.display()))?;
      return Ok(json!({ "path": input.path, "content": content }));
    }
  }

  if !is_safe_memory_path(&input.path) {
    return Err(format!("Invalid memory path: {}", input.path));
  }

  let workspace = openclaw_workspace_root()?;
  let abs_path = memory_path_to_absolute(&workspace, &input.path);
  if !abs_path.starts_with(&workspace) {
    return Err("Path escapes workspace root".to_string());
  }

  let content = tokio::fs::read_to_string(&abs_path)
    .await
    .map_err(|e| format!("Failed to read {}: {e}", input.path))?;
  Ok(json!({ "path": input.path, "content": content }))
}

#[tauri::command]
pub async fn middleware_memory_write(input: MemoryWriteInput) -> Result<Value, String> {
  if !is_safe_memory_path(&input.path) {
    return Err(format!("Invalid memory path: {}", input.path));
  }

  let workspace = openclaw_workspace_root()?;
  let abs_path = memory_path_to_absolute(&workspace, &input.path);
  if !abs_path.starts_with(&workspace) {
    return Err("Path escapes workspace root".to_string());
  }

  if let Some(parent) = abs_path.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| format!("Failed to create parent dir: {e}"))?;
  }

  tokio::fs::write(&abs_path, &input.content)
    .await
    .map_err(|e| format!("Failed to write {}: {e}", input.path))?;

  Ok(json!({ "ok": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_memory_search(input: MemorySearchInput) -> Result<Value, String> {
  let db_path = openclaw_memory_db_path()?;
  if !db_path.exists() {
    return Ok(json!({ "hits": [] }));
  }

  let query = input.query.clone();
  let hits = tokio::task::spawn_blocking(move || -> Result<Vec<Value>, String> {
    let conn = Connection::open(&db_path)
      .map_err(|e| format!("Failed to open memory DB: {e}"))?;

    // FTS5 query — escape special characters for safety
    let fts_query = query
      .replace('"', "\"\"")
      .split_whitespace()
      .filter(|w| !w.is_empty())
      .map(|w| format!("\"{}\"", w))
      .collect::<Vec<_>>()
      .join(" OR ");

    if fts_query.is_empty() {
      return Ok(vec![]);
    }

    let mut stmt = conn.prepare(
      r#"SELECT path, snippet(chunks_fts, 0, '', '', '…', 40) as snippet, rank
         FROM chunks_fts
         WHERE chunks_fts MATCH ?1
         ORDER BY rank
         LIMIT 20"#,
    ).map_err(|e| format!("Failed to prepare FTS query: {e}"))?;

    let rows: Vec<Value> = stmt.query_map(params![fts_query], |row| {
      let path: String = row.get(0)?;
      let snippet: String = row.get(1)?;
      let rank: f64 = row.get(2)?;
      Ok(json!({
        "path": path,
        "snippet": snippet,
        "score": -rank, // FTS5 rank is negative (lower = better), invert for score
      }))
    })
    .map_err(|e| format!("FTS query failed: {e}"))?
    .filter_map(|r| r.ok())
    .collect();

    Ok(rows)
  })
  .await
  .map_err(|e| format!("Search task failed: {e}"))??;

  Ok(json!({ "hits": hits }))
}

#[tauri::command]
pub async fn middleware_memory_reindex(_input: MemoryReindexInput) -> Result<Value, String> {
  // Call doctor.memory.status via gateway to check/trigger reindex
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let result = gateway_request(
    &mut socket,
    "doctor.memory.status",
    json!({}),
    15_000,
  )
  .await;
  let _ = socket.close(None).await;

  match result {
    Ok(payload) => {
      Ok(json!({
        "ok": true,
        "queued": true,
        "status": payload,
      }))
    }
    Err(_) => {
      // Gateway may not support this method — still return success
      Ok(json!({ "ok": true, "queued": false }))
    }
  }
}
