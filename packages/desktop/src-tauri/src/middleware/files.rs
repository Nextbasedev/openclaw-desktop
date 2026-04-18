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
  let resolved = resolve_project_path(&input.project_id, &input.path)?;
  const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50MB
  let metadata = fs::metadata(&resolved).map_err(|e| format!("Failed to read file metadata: {e}"))?;
  if metadata.len() > MAX_FILE_SIZE {
    return Err(format!("File too large ({} bytes, max {})", metadata.len(), MAX_FILE_SIZE));
  }
  let content = fs::read_to_string(&resolved).map_err(|error| format!("Failed to read file: {error}"))?;
  Ok(json!({ "file": { "path": input.path, "content": content, "encoding": "utf8" } }))
}

#[tauri::command]
pub fn middleware_files_prepare_attachment(input: FilePathInput) -> Result<Value, String> {
  let resolved = resolve_project_path(&input.project_id, &input.path)?;
  const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
  let metadata = fs::metadata(&resolved).map_err(|e| format!("Failed to read file metadata: {e}"))?;
  if metadata.len() > MAX_FILE_SIZE {
    return Err(format!("File too large ({} bytes, max {})", metadata.len(), MAX_FILE_SIZE));
  }
  let file_name = resolved.file_name()
    .map(|n| n.to_string_lossy().to_string())
    .unwrap_or_else(|| "unnamed".to_string());
  let content = fs::read(&resolved).map_err(|e| format!("Failed to read file: {e}"))?;
  let mime_type = mime_from_extension(&file_name);
  match String::from_utf8(content.clone()) {
    Ok(text) => Ok(json!({
      "name": file_name,
      "mimeType": mime_type,
      "content": text,
      "encoding": "utf-8",
      "size": metadata.len(),
    })),
    Err(_) => Ok(json!({
      "name": file_name,
      "mimeType": mime_type,
      "content": URL_SAFE_NO_PAD.encode(&content),
      "encoding": "base64",
      "size": metadata.len(),
    })),
  }
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
  const MAX_RESULTS: usize = 500;
  for entry in WalkDir::new(&root)
    .max_depth(6)
    .into_iter()
    .filter_map(|entry| entry.ok())
  {
    if results.len() >= MAX_RESULTS {
      break;
    }
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


