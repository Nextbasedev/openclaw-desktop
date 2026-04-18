use super::memory::*;
use super::*;

// ── Unit tests ──────────────────────────────────────────────────────────────

#[test]
fn is_safe_memory_path_rejects_traversal() {
  assert!(!is_safe_memory_path("../etc/passwd"));
  assert!(!is_safe_memory_path("memory/../../etc/passwd"));
  assert!(!is_safe_memory_path("/absolute/path"));
}

#[test]
fn is_safe_memory_path_accepts_valid() {
  assert!(is_safe_memory_path("MEMORY.md"));
  assert!(is_safe_memory_path("memory/2026-04-18.md"));
  assert!(is_safe_memory_path("memory/topic-notes.md"));
}

#[test]
fn openclaw_workspace_root_resolves() {
  let root = openclaw_workspace_root();
  assert!(root.is_ok());
  let path = root.unwrap();
  assert!(path.to_string_lossy().contains(".openclaw"));
  assert!(path.to_string_lossy().ends_with("workspace"));
}

#[test]
fn openclaw_memory_db_path_resolves() {
  let path = openclaw_memory_db_path();
  assert!(path.is_ok());
  let p = path.unwrap();
  assert!(p.to_string_lossy().contains("memory"));
  assert!(p.to_string_lossy().ends_with("main.sqlite"));
}

#[test]
fn openclaw_dreams_dir_resolves() {
  let path = openclaw_dreams_dir();
  assert!(path.is_ok());
  let p = path.unwrap();
  assert!(p.to_string_lossy().contains(".dreams"));
}

#[test]
fn memory_path_to_absolute_joins_correctly() {
  let workspace = std::path::Path::new("/root/.openclaw/workspace");
  let abs = memory_path_to_absolute(workspace, "MEMORY.md");
  assert_eq!(abs, std::path::PathBuf::from("/root/.openclaw/workspace/MEMORY.md"));

  let abs2 = memory_path_to_absolute(workspace, "memory/2026-04-18.md");
  assert_eq!(abs2, std::path::PathBuf::from("/root/.openclaw/workspace/memory/2026-04-18.md"));
}

#[test]
fn absolute_to_memory_path_strips_prefix() {
  let workspace = std::path::Path::new("/root/.openclaw/workspace");
  let abs = std::path::Path::new("/root/.openclaw/workspace/MEMORY.md");
  assert_eq!(absolute_to_memory_path(workspace, abs), Some("MEMORY.md".to_string()));

  let abs2 = std::path::Path::new("/root/.openclaw/workspace/memory/notes.md");
  assert_eq!(absolute_to_memory_path(workspace, abs2), Some("memory/notes.md".to_string()));
}

#[test]
fn absolute_to_memory_path_returns_none_for_outside() {
  let workspace = std::path::Path::new("/root/.openclaw/workspace");
  let outside = std::path::Path::new("/etc/passwd");
  assert_eq!(absolute_to_memory_path(workspace, outside), None);
}

#[test]
fn read_lines_range_returns_correct_slice() {
  let content = "line1\nline2\nline3\nline4\nline5";
  assert_eq!(read_lines_range(content, 2, 4), "line2\nline3\nline4");
  assert_eq!(read_lines_range(content, 1, 1), "line1");
  assert_eq!(read_lines_range(content, 5, 5), "line5");
  assert_eq!(read_lines_range(content, 3, 10), "line3\nline4\nline5");
}

#[test]
fn validate_category_accepts_valid() {
  assert!(validate_category("preference").is_ok());
  assert!(validate_category("fact").is_ok());
  assert!(validate_category("decision").is_ok());
  assert!(validate_category("entity").is_ok());
  assert!(validate_category("other").is_ok());
}

#[test]
fn validate_category_rejects_invalid() {
  assert!(validate_category("invalid").is_err());
  assert!(validate_category("").is_err());
  assert!(validate_category("FACT").is_err());
}

// ── Integration tests ───────────────────────────────────────────────────────

#[tokio::test]
async fn memory_list_returns_documents() {
  let input = MemoryListInput { project_id: None };
  let result = middleware_memory_list(input).await;
  assert!(result.is_ok(), "memory_list failed: {:?}", result.err());
  let val = result.unwrap();
  let docs = val.get("documents").and_then(Value::as_array).unwrap();
  assert!(!docs.is_empty(), "Expected at least one memory document");

  let first = &docs[0];
  assert_eq!(first.get("path").and_then(Value::as_str), Some("MEMORY.md"));
  assert!(first.get("title").is_some());
  assert!(first.get("chunkCount").is_some());
}

#[tokio::test]
async fn memory_read_returns_content() {
  let input = MemoryReadInput {
    path: "MEMORY.md".to_string(),
    start_line: None,
    end_line: None,
  };
  let result = middleware_memory_read(input).await;
  assert!(result.is_ok(), "memory_read failed: {:?}", result.err());
  let val = result.unwrap();
  assert_eq!(val.get("path").and_then(Value::as_str), Some("MEMORY.md"));
  let content = val.get("content").and_then(Value::as_str).unwrap();
  assert!(!content.is_empty());
}

#[tokio::test]
async fn memory_read_chunk_returns_line_range() {
  let input = MemoryReadInput {
    path: "MEMORY.md".to_string(),
    start_line: Some(1),
    end_line: Some(5),
  };
  let result = middleware_memory_read(input).await;
  assert!(result.is_ok(), "chunk read failed: {:?}", result.err());
  let val = result.unwrap();
  assert_eq!(val.get("startLine").and_then(Value::as_u64), Some(1));
  assert_eq!(val.get("endLine").and_then(Value::as_u64), Some(5));
  assert!(val.get("totalLines").and_then(Value::as_u64).unwrap() > 0);
  let content = val.get("content").and_then(Value::as_str).unwrap();
  let line_count = content.lines().count();
  assert!(line_count <= 5, "Expected at most 5 lines, got {}", line_count);
}

#[tokio::test]
async fn memory_read_rejects_traversal() {
  let input = MemoryReadInput {
    path: "../../../etc/passwd".to_string(),
    start_line: None,
    end_line: None,
  };
  let result = middleware_memory_read(input).await;
  assert!(result.is_err());
}

#[tokio::test]
async fn memory_write_and_read_roundtrip() {
  let test_path = format!("memory/test-roundtrip-{}.md", uuid::Uuid::new_v4().simple());
  let content = "# Test Memory\n\nThis is a roundtrip test.";

  let write_result = middleware_memory_write(MemoryWriteInput {
    path: test_path.clone(),
    content: content.to_string(),
    category: None,
    importance: None,
  }).await;
  assert!(write_result.is_ok(), "write failed: {:?}", write_result.err());

  let read_result = middleware_memory_read(MemoryReadInput {
    path: test_path.clone(),
    start_line: None,
    end_line: None,
  }).await;
  assert!(read_result.is_ok(), "read failed: {:?}", read_result.err());
  let val = read_result.unwrap();
  assert_eq!(val.get("content").and_then(Value::as_str), Some(content));

  let workspace = openclaw_workspace_root().unwrap();
  let _ = std::fs::remove_file(workspace.join(&test_path));
}

#[tokio::test]
async fn memory_write_with_category_adds_frontmatter() {
  let test_path = format!("memory/test-cat-{}.md", uuid::Uuid::new_v4().simple());
  let content = "User prefers dark mode.";

  let write_result = middleware_memory_write(MemoryWriteInput {
    path: test_path.clone(),
    content: content.to_string(),
    category: Some("preference".to_string()),
    importance: Some(0.8),
  }).await;
  assert!(write_result.is_ok(), "write failed: {:?}", write_result.err());
  let val = write_result.unwrap();
  assert_eq!(val.get("category").and_then(Value::as_str), Some("preference"));

  let read_result = middleware_memory_read(MemoryReadInput {
    path: test_path.clone(),
    start_line: None,
    end_line: None,
  }).await;
  assert!(read_result.is_ok());
  let file_content = read_result.unwrap();
  let raw = file_content.get("content").and_then(Value::as_str).unwrap();
  assert!(raw.contains("category: preference"));
  assert!(raw.contains("importance: 0.8"));
  assert!(raw.contains(content));

  let workspace = openclaw_workspace_root().unwrap();
  let _ = std::fs::remove_file(workspace.join(&test_path));
}

#[tokio::test]
async fn memory_write_rejects_invalid_category() {
  let result = middleware_memory_write(MemoryWriteInput {
    path: "memory/test.md".to_string(),
    content: "test".to_string(),
    category: Some("invalid_cat".to_string()),
    importance: None,
  }).await;
  assert!(result.is_err());
  assert!(result.unwrap_err().contains("Invalid category"));
}

#[tokio::test]
async fn memory_write_rejects_invalid_importance() {
  let result = middleware_memory_write(MemoryWriteInput {
    path: "memory/test.md".to_string(),
    content: "test".to_string(),
    category: None,
    importance: Some(1.5),
  }).await;
  assert!(result.is_err());
  assert!(result.unwrap_err().contains("Importance must be"));
}

#[tokio::test]
async fn memory_write_rejects_traversal() {
  let result = middleware_memory_write(MemoryWriteInput {
    path: "../../../tmp/evil.md".to_string(),
    content: "evil".to_string(),
    category: None,
    importance: None,
  }).await;
  assert!(result.is_err());
}

#[tokio::test]
async fn memory_search_returns_chunks() {
  let db_path = openclaw_memory_db_path().unwrap();
  if !db_path.exists() {
    return;
  }

  let input = MemorySearchInput { query: "jarvis".to_string(), limit: None };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok(), "search failed: {:?}", result.err());
  let val = result.unwrap();
  let hits = val.get("hits").and_then(Value::as_array).unwrap();
  assert!(!hits.is_empty(), "Expected search hits for 'jarvis'");

  let first = &hits[0];
  assert!(first.get("path").and_then(Value::as_str).is_some());
  assert!(first.get("startLine").and_then(Value::as_i64).is_some());
  assert!(first.get("endLine").and_then(Value::as_i64).is_some());
  assert!(first.get("source").and_then(Value::as_str).is_some());
  assert!(first.get("snippet").and_then(Value::as_str).is_some());
  assert!(first.get("score").and_then(Value::as_f64).is_some());
}

#[tokio::test]
async fn memory_search_with_limit() {
  let db_path = openclaw_memory_db_path().unwrap();
  if !db_path.exists() {
    return;
  }

  let input = MemorySearchInput { query: "memory".to_string(), limit: Some(3) };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok());
  let hits = result.unwrap().get("hits").and_then(Value::as_array).unwrap().len();
  assert!(hits <= 3, "Expected at most 3 hits, got {}", hits);
}

#[tokio::test]
async fn memory_search_empty_query_returns_empty() {
  let input = MemorySearchInput { query: "   ".to_string(), limit: None };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok());
  let hits = result.unwrap().get("hits").and_then(Value::as_array).unwrap().len();
  assert_eq!(hits, 0);
}

#[tokio::test]
async fn memory_search_no_db_returns_empty() {
  let input = MemorySearchInput { query: "xyznonexistent123456".to_string(), limit: None };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok());
}

#[tokio::test]
async fn memory_store_creates_file_with_metadata() {
  let result = middleware_memory_store(MemoryStoreInput {
    content: "Test store content.".to_string(),
    category: Some("fact".to_string()),
    importance: Some(0.7),
    tags: Some(vec!["test".to_string(), "store".to_string()]),
  }).await;
  assert!(result.is_ok(), "store failed: {:?}", result.err());
  let val = result.unwrap();
  assert_eq!(val.get("ok").and_then(Value::as_bool), Some(true));
  assert_eq!(val.get("category").and_then(Value::as_str), Some("fact"));

  let path = val.get("path").and_then(Value::as_str).unwrap();
  assert!(path.starts_with("memory/"));
  assert!(path.contains("-fact-"));

  // Verify file exists and has frontmatter
  let read_result = middleware_memory_read(MemoryReadInput {
    path: path.to_string(),
    start_line: None,
    end_line: None,
  }).await;
  assert!(read_result.is_ok());
  let content = read_result.unwrap().get("content").and_then(Value::as_str).unwrap().to_string();
  assert!(content.contains("category: fact"));
  assert!(content.contains("importance: 0.7"));
  assert!(content.contains("tags: [test, store]"));
  assert!(content.contains("createdAt:"));
  assert!(content.contains("Test store content."));

  // Cleanup
  let workspace = openclaw_workspace_root().unwrap();
  let _ = std::fs::remove_file(workspace.join(path));
}

#[tokio::test]
async fn memory_store_rejects_invalid_category() {
  let result = middleware_memory_store(MemoryStoreInput {
    content: "test".to_string(),
    category: Some("bogus".to_string()),
    importance: None,
    tags: None,
  }).await;
  assert!(result.is_err());
}

#[tokio::test]
async fn memory_store_defaults_category_to_other() {
  let result = middleware_memory_store(MemoryStoreInput {
    content: "Default category test.".to_string(),
    category: None,
    importance: None,
    tags: None,
  }).await;
  assert!(result.is_ok());
  let val = result.unwrap();
  assert_eq!(val.get("category").and_then(Value::as_str), Some("other"));

  let path = val.get("path").and_then(Value::as_str).unwrap();
  let workspace = openclaw_workspace_root().unwrap();
  let _ = std::fs::remove_file(workspace.join(path));
}

#[tokio::test]
async fn memory_recall_returns_entries() {
  let dreams_dir = openclaw_dreams_dir().unwrap();
  if !dreams_dir.join("short-term-recall.json").exists() {
    return;
  }

  let result = middleware_memory_recall(MemoryRecallInput {
    path: None,
    limit: Some(5),
  }).await;
  assert!(result.is_ok(), "recall failed: {:?}", result.err());
  let val = result.unwrap();
  assert!(val.get("total").and_then(Value::as_u64).unwrap() > 0);
  let entries = val.get("entries").and_then(Value::as_array).unwrap();
  assert!(entries.len() <= 5);
  assert!(val.get("updatedAt").is_some());
}

#[tokio::test]
async fn memory_recall_filters_by_path() {
  let dreams_dir = openclaw_dreams_dir().unwrap();
  if !dreams_dir.join("short-term-recall.json").exists() {
    return;
  }

  let result = middleware_memory_recall(MemoryRecallInput {
    path: Some("MEMORY.md".to_string()),
    limit: None,
  }).await;
  assert!(result.is_ok());
  let val = result.unwrap();
  let entries = val.get("entries").and_then(Value::as_array).unwrap();
  for entry in entries {
    let key = entry.get("key").and_then(Value::as_str).unwrap_or("");
    assert!(key.contains("MEMORY.md"), "Entry key should contain MEMORY.md: {}", key);
  }
}
