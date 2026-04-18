use super::*;

#[tauri::command]
pub async fn middleware_fs_read_dir(input: FsReadDirInput) -> Result<Value, String> {
  let path = PathBuf::from(&input.path);
  let mut entries = Vec::new();
  let mut dir = tokio::fs::read_dir(&path).await.map_err(|e| format!("Failed to read directory: {e}"))?;
  while let Some(entry) = dir.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
    let name = entry.file_name().to_string_lossy().to_string();
    let entry_path = entry.path().to_string_lossy().to_string();
    let metadata = entry.metadata().await.ok();
    entries.push(FsDirEntry {
      name,
      path: entry_path,
      is_file: metadata.as_ref().map(|m| m.is_file()).unwrap_or(false),
      is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
      size: metadata.as_ref().map(|m| m.len()),
      modified_at: metadata.as_ref().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
    });
  }
  Ok(json!({ "entries": entries }))
}

#[tauri::command]
pub async fn middleware_fs_read_file(input: FsReadFileInput) -> Result<Value, String> {
  const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50MB
  let metadata = tokio::fs::metadata(&input.path).await.map_err(|e| format!("Failed to read file metadata: {e}"))?;
  if metadata.len() > MAX_FILE_SIZE {
    return Err(format!("File too large ({} bytes, max {})", metadata.len(), MAX_FILE_SIZE));
  }
  let content = tokio::fs::read(&input.path).await.map_err(|e| format!("Failed to read file: {e}"))?;
  match String::from_utf8(content.clone()) {
    Ok(text) => Ok(json!({ "content": text, "encoding": "utf-8" })),
    Err(_) => Ok(json!({ "content": URL_SAFE_NO_PAD.encode(&content), "encoding": "base64" })),
  }
}

#[tauri::command]
pub async fn middleware_fs_write_file(input: FsWriteFileInput) -> Result<Value, String> {
  if let Some(parent) = PathBuf::from(&input.path).parent() {
    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Failed to create parent directory: {e}"))?;
  }
  tokio::fs::write(&input.path, input.content.as_bytes()).await.map_err(|e| format!("Failed to write file: {e}"))?;
  Ok(json!({ "written": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_create_dir(input: FsCreateDirInput) -> Result<Value, String> {
  if input.recursive.unwrap_or(false) {
    tokio::fs::create_dir_all(&input.path).await.map_err(|e| format!("Failed to create directory: {e}"))?;
  } else {
    tokio::fs::create_dir(&input.path).await.map_err(|e| format!("Failed to create directory: {e}"))?;
  }
  Ok(json!({ "created": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_remove(input: FsRemoveInput) -> Result<Value, String> {
  let metadata = tokio::fs::metadata(&input.path).await.map_err(|e| format!("Failed to get metadata: {e}"))?;
  if metadata.is_dir() {
    if input.recursive.unwrap_or(false) {
      tokio::fs::remove_dir_all(&input.path).await.map_err(|e| format!("Failed to remove directory: {e}"))?;
    } else {
      tokio::fs::remove_dir(&input.path).await.map_err(|e| format!("Failed to remove directory: {e}"))?;
    }
  } else {
    tokio::fs::remove_file(&input.path).await.map_err(|e| format!("Failed to remove file: {e}"))?;
  }
  Ok(json!({ "removed": true, "path": input.path }))
}

#[tauri::command]
pub async fn middleware_fs_rename(input: FsRenameInput) -> Result<Value, String> {
  tokio::fs::rename(&input.old_path, &input.new_path).await.map_err(|e| format!("Failed to rename: {e}"))?;
  Ok(json!({ "renamed": true, "oldPath": input.old_path, "newPath": input.new_path }))
}

#[tauri::command]
pub async fn middleware_fs_metadata(input: FsReadFileInput) -> Result<Value, String> {
  let metadata = tokio::fs::metadata(&input.path).await.map_err(|e| format!("Failed to get metadata: {e}"))?;
  Ok(json!({
    "path": input.path,
    "isFile": metadata.is_file(),
    "isDir": metadata.is_dir(),
    "size": metadata.len(),
    "modifiedAt": metadata.modified().ok().map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
    "createdAt": metadata.created().ok().map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339()),
  }))
}

#[tauri::command]
pub async fn middleware_fs_search(input: FsSearchInput) -> Result<Value, String> {
  let root = PathBuf::from(&input.path);
  let query = input.query.to_lowercase();
  let max_results = input.max_results.unwrap_or(100);
  let mut results = Vec::new();

  async fn search_recursive(dir: &std::path::Path, query: &str, results: &mut Vec<FsSearchResult>, max_results: usize, depth: u32) -> Result<(), String> {
    if depth > 10 || results.len() >= max_results { return Ok(()); }
    let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| format!("Failed to read directory: {e}"))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
      if results.len() >= max_results { return Ok(()); }
      let name = entry.file_name().to_string_lossy().to_string();
      let path = entry.path();
      let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
      if name.to_lowercase().contains(query) {
        results.push(FsSearchResult { path: path.to_string_lossy().to_string(), name, is_dir });
      }
      if is_dir {
        Box::pin(search_recursive(&path, query, results, max_results, depth + 1)).await?;
      }
    }
    Ok(())
  }

  if root.is_dir() {
    search_recursive(&root, &query, &mut results, max_results, 0).await?;
  }

  Ok(json!({ "results": results, "query": input.query, "count": results.len() }))
}


