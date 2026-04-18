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
  pub(crate) start_line: Option<usize>,
  pub(crate) end_line: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWriteInput {
  pub(crate) path: String,
  pub(crate) content: String,
  pub(crate) category: Option<String>,
  pub(crate) importance: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchInput {
  pub(crate) query: String,
  pub(crate) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStoreInput {
  pub(crate) content: String,
  pub(crate) category: Option<String>,
  pub(crate) importance: Option<f64>,
  pub(crate) tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecallInput {
  pub(crate) path: Option<String>,
  pub(crate) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReindexInput {}

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_CATEGORIES: &[&str] = &["preference", "fact", "decision", "entity", "other"];

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn openclaw_workspace_root() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("workspace"))
}

pub(crate) fn openclaw_memory_db_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("memory").join("main.sqlite"))
}

pub(crate) fn openclaw_dreams_dir() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw").join("workspace").join("memory").join(".dreams"))
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

pub(crate) fn validate_category(cat: &str) -> Result<(), String> {
  if VALID_CATEGORIES.contains(&cat) {
    Ok(())
  } else {
    Err(format!(
      "Invalid category '{}'. Valid: {}",
      cat,
      VALID_CATEGORIES.join(", ")
    ))
  }
}

pub(crate) fn read_lines_range(content: &str, start: usize, end: usize) -> String {
  content
    .lines()
    .enumerate()
    .filter(|(i, _)| {
      let line_num = i + 1;
      line_num >= start && line_num <= end
    })
    .map(|(_, line)| line)
    .collect::<Vec<_>>()
    .join("\n")
}

fn update_dreams_recall(hits: &[Value]) {
  let dreams_dir = match openclaw_dreams_dir() {
    Ok(d) => d,
    Err(_) => return,
  };

  let recall_path = dreams_dir.join("short-term-recall.json");
  if !recall_path.exists() {
    return;
  }

  let raw = match fs::read_to_string(&recall_path) {
    Ok(r) => r,
    Err(_) => return,
  };

  let mut recall: Value = match serde_json::from_str(&raw) {
    Ok(v) => v,
    Err(_) => return,
  };

  let entries = match recall.get_mut("entries").and_then(Value::as_object_mut) {
    Some(e) => e,
    None => return,
  };

  let now = Utc::now().to_rfc3339();
  let today = Utc::now().format("%Y-%m-%d").to_string();

  for hit in hits {
    let path = hit.get("path").and_then(Value::as_str).unwrap_or("");
    let start_line = hit.get("startLine").and_then(Value::as_u64).unwrap_or(0);
    let end_line = hit.get("endLine").and_then(Value::as_u64).unwrap_or(0);
    let key = format!("memory:{}:{}:{}", path, start_line, end_line);

    if let Some(entry) = entries.get_mut(&key) {
      if let Some(count) = entry.get("recallCount").and_then(Value::as_u64) {
        entry["recallCount"] = json!(count + 1);
      }
      entry["lastRecalledAt"] = json!(now);
      if let Some(days) = entry.get_mut("recallDays").and_then(Value::as_array_mut) {
        let today_val = json!(today);
        if !days.contains(&today_val) {
          days.push(today_val);
        }
      }
    }
  }

  recall["updatedAt"] = json!(now);
  if let Ok(serialized) = serde_json::to_string_pretty(&recall) {
    let _ = fs::write(&recall_path, serialized);
  }

  let events_path = dreams_dir.join("events.jsonl");
  let event = json!({
    "type": "search_recall",
    "timestamp": now,
    "hitCount": hits.len(),
  });
  if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&events_path) {
    let _ = writeln!(f, "{}", event);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn middleware_memory_list(input: MemoryListInput) -> Result<Value, String> {
  let workspace = openclaw_workspace_root()?;
  let db_path = openclaw_memory_db_path()?;

  let mut documents = Vec::new();

  // MEMORY.md at workspace root
  let memory_md = workspace.join("MEMORY.md");
  if memory_md.exists() {
    let meta = fs::metadata(&memory_md).ok();
    let chunk_count = chunk_count_for_path(&db_path, "MEMORY.md");
    documents.push(json!({
      "path": "MEMORY.md",
      "title": "Main Memory",
      "chunkCount": chunk_count,
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
      let chunk_count = chunk_count_for_path(&db_path, &rel_path);
      documents.push(json!({
        "path": rel_path,
        "title": title,
        "chunkCount": chunk_count,
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

  // Chunk-based read: return only specified line range
  if let (Some(start), Some(end)) = (input.start_line, input.end_line) {
    let chunk = read_lines_range(&content, start, end);
    let total_lines = content.lines().count();
    return Ok(json!({
      "path": input.path,
      "content": chunk,
      "startLine": start,
      "endLine": end,
      "totalLines": total_lines,
    }));
  }

  Ok(json!({ "path": input.path, "content": content }))
}

#[tauri::command]
pub async fn middleware_memory_write(input: MemoryWriteInput) -> Result<Value, String> {
  if !is_safe_memory_path(&input.path) {
    return Err(format!("Invalid memory path: {}", input.path));
  }

  if let Some(ref cat) = input.category {
    validate_category(cat)?;
  }

  if let Some(importance) = input.importance {
    if !(0.0..=1.0).contains(&importance) {
      return Err("Importance must be between 0.0 and 1.0".to_string());
    }
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

  // Build content with optional frontmatter for category/importance
  let final_content = if input.category.is_some() || input.importance.is_some() {
    let mut fm = String::from("---\n");
    if let Some(ref cat) = input.category {
      fm.push_str(&format!("category: {}\n", cat));
    }
    if let Some(importance) = input.importance {
      fm.push_str(&format!("importance: {}\n", importance));
    }
    fm.push_str("---\n\n");
    fm.push_str(&input.content);
    fm
  } else {
    input.content.clone()
  };

  tokio::fs::write(&abs_path, &final_content)
    .await
    .map_err(|e| format!("Failed to write {}: {e}", input.path))?;

  Ok(json!({
    "ok": true,
    "path": input.path,
    "category": input.category,
    "importance": input.importance,
  }))
}

#[tauri::command]
pub async fn middleware_memory_search(input: MemorySearchInput) -> Result<Value, String> {
  let db_path = openclaw_memory_db_path()?;
  if !db_path.exists() {
    return Ok(json!({ "hits": [] }));
  }

  let query = input.query.clone();
  let limit = input.limit.unwrap_or(20).min(100);
  let hits = tokio::task::spawn_blocking(move || -> Result<Vec<Value>, String> {
    let conn = Connection::open(&db_path)
      .map_err(|e| format!("Failed to open memory DB: {e}"))?;

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
      r#"SELECT path, start_line, end_line, source,
                snippet(chunks_fts, 0, '', '', '…', 64) as snippet,
                rank
         FROM chunks_fts
         WHERE chunks_fts MATCH ?1
         ORDER BY rank
         LIMIT ?2"#,
    ).map_err(|e| format!("Failed to prepare FTS query: {e}"))?;

    let rows: Vec<Value> = stmt.query_map(params![fts_query, limit as i64], |row| {
      let path: String = row.get(0)?;
      let start_line: f64 = row.get(1)?;
      let end_line: f64 = row.get(2)?;
      let source: String = row.get(3)?;
      let snippet: String = row.get(4)?;
      let rank: f64 = row.get(5)?;
      Ok(json!({
        "path": path,
        "startLine": start_line as i64,
        "endLine": end_line as i64,
        "source": source,
        "snippet": snippet,
        "score": -rank,
      }))
    })
    .map_err(|e| format!("FTS query failed: {e}"))?
    .filter_map(|r| r.ok())
    .collect();

    Ok(rows)
  })
  .await
  .map_err(|e| format!("Search task failed: {e}"))??;

  // Best-effort dreams recall tracking
  if !hits.is_empty() {
    let hits_clone = hits.clone();
    tokio::task::spawn_blocking(move || update_dreams_recall(&hits_clone));
  }

  Ok(json!({ "hits": hits }))
}

#[tauri::command]
pub async fn middleware_memory_store(input: MemoryStoreInput) -> Result<Value, String> {
  let category = input.category.as_deref().unwrap_or("other");
  validate_category(category)?;

  let importance = input.importance.unwrap_or(0.5);
  if !(0.0..=1.0).contains(&importance) {
    return Err("Importance must be between 0.0 and 1.0".to_string());
  }

  let workspace = openclaw_workspace_root()?;
  let memory_dir = workspace.join("memory");
  tokio::fs::create_dir_all(&memory_dir)
    .await
    .map_err(|e| format!("Failed to create memory dir: {e}"))?;

  // Generate unique filename: {date}-{category}-{uuid}.md
  let date = Utc::now().format("%Y-%m-%d");
  let short_id = &Uuid::new_v4().simple().to_string()[..8];
  let file_name = format!("{}-{}-{}.md", date, category, short_id);
  let rel_path = format!("memory/{}", file_name);
  let abs_path = memory_dir.join(&file_name);

  let mut fm = String::from("---\n");
  fm.push_str(&format!("category: {}\n", category));
  fm.push_str(&format!("importance: {}\n", importance));
  if let Some(ref tags) = input.tags {
    fm.push_str(&format!("tags: [{}]\n", tags.join(", ")));
  }
  fm.push_str(&format!("createdAt: {}\n", Utc::now().to_rfc3339()));
  fm.push_str("---\n\n");
  fm.push_str(&input.content);

  tokio::fs::write(&abs_path, &fm)
    .await
    .map_err(|e| format!("Failed to write memory: {e}"))?;

  // Append to dreams events log
  let dreams_event = json!({
    "type": "memory_store",
    "timestamp": Utc::now().to_rfc3339(),
    "path": rel_path,
    "category": category,
    "importance": importance,
    "tags": input.tags,
  });
  if let Ok(dreams_dir) = openclaw_dreams_dir() {
    let _ = tokio::fs::create_dir_all(&dreams_dir).await;
    let events_path = dreams_dir.join("events.jsonl");
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&events_path) {
      let _ = writeln!(f, "{}", dreams_event);
    }
  }

  Ok(json!({
    "ok": true,
    "path": rel_path,
    "category": category,
    "importance": importance,
  }))
}

#[tauri::command]
pub async fn middleware_memory_recall(input: MemoryRecallInput) -> Result<Value, String> {
  let dreams_dir = openclaw_dreams_dir()?;
  let recall_path = dreams_dir.join("short-term-recall.json");

  if !recall_path.exists() {
    return Ok(json!({ "entries": [], "total": 0 }));
  }

  let raw = tokio::fs::read_to_string(&recall_path)
    .await
    .map_err(|e| format!("Failed to read recall data: {e}"))?;

  let recall: Value = serde_json::from_str(&raw)
    .map_err(|e| format!("Failed to parse recall data: {e}"))?;

  let entries_map = recall.get("entries").and_then(Value::as_object);
  let entries_map = match entries_map {
    Some(m) => m,
    None => return Ok(json!({ "entries": [], "total": 0 })),
  };

  let limit = input.limit.unwrap_or(50).min(200);
  let mut entries: Vec<Value> = entries_map
    .iter()
    .filter(|(key, _)| {
      if let Some(ref filter_path) = input.path {
        key.contains(filter_path)
      } else {
        true
      }
    })
    .map(|(key, val)| {
      let mut entry = val.clone();
      entry["key"] = json!(key);
      entry
    })
    .collect();

  // Sort by totalScore descending
  entries.sort_by(|a, b| {
    let sa = a.get("totalScore").and_then(Value::as_f64).unwrap_or(0.0);
    let sb = b.get("totalScore").and_then(Value::as_f64).unwrap_or(0.0);
    sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
  });

  let total = entries.len();
  entries.truncate(limit);

  Ok(json!({
    "entries": entries,
    "total": total,
    "updatedAt": recall.get("updatedAt"),
  }))
}

#[tauri::command]
pub async fn middleware_memory_reindex(_input: MemoryReindexInput) -> Result<Value, String> {
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
      Ok(json!({ "ok": true, "queued": false }))
    }
  }
}

// ── SQLite helpers ──────────────────────────────────────────────────────────

fn chunk_count_for_path(db_path: &Path, path: &str) -> i64 {
  if !db_path.exists() {
    return 0;
  }
  let conn = match Connection::open(db_path) {
    Ok(c) => c,
    Err(_) => return 0,
  };
  conn
    .query_row("SELECT count(*) FROM chunks WHERE path = ?1", params![path], |row| {
      row.get(0)
    })
    .unwrap_or(0)
}
