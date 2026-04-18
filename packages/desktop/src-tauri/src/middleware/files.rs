use super::*;

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


