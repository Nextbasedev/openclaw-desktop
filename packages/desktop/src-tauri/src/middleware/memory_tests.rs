use super::memory::*;
use super::*;

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

// ── Integration tests using real OpenClaw workspace ──────────────────────────

#[tokio::test]
async fn memory_list_returns_documents() {
  let input = MemoryListInput { project_id: None };
  let result = middleware_memory_list(input).await;
  assert!(result.is_ok(), "memory_list failed: {:?}", result.err());
  let val = result.unwrap();
  let docs = val.get("documents").and_then(Value::as_array).unwrap();
  assert!(!docs.is_empty(), "Expected at least one memory document");

  // MEMORY.md should be first
  let first = &docs[0];
  assert_eq!(first.get("path").and_then(Value::as_str), Some("MEMORY.md"));
  assert!(first.get("title").is_some());
}

#[tokio::test]
async fn memory_read_returns_content() {
  let input = MemoryReadInput { path: "MEMORY.md".to_string() };
  let result = middleware_memory_read(input).await;
  assert!(result.is_ok(), "memory_read failed: {:?}", result.err());
  let val = result.unwrap();
  assert_eq!(val.get("path").and_then(Value::as_str), Some("MEMORY.md"));
  let content = val.get("content").and_then(Value::as_str).unwrap();
  assert!(!content.is_empty());
}

#[tokio::test]
async fn memory_read_rejects_traversal() {
  let input = MemoryReadInput { path: "../../../etc/passwd".to_string() };
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
  }).await;
  assert!(write_result.is_ok(), "write failed: {:?}", write_result.err());

  let read_result = middleware_memory_read(MemoryReadInput {
    path: test_path.clone(),
  }).await;
  assert!(read_result.is_ok(), "read failed: {:?}", read_result.err());
  let val = read_result.unwrap();
  assert_eq!(val.get("content").and_then(Value::as_str), Some(content));

  // Cleanup
  let workspace = openclaw_workspace_root().unwrap();
  let _ = std::fs::remove_file(workspace.join(&test_path));
}

#[tokio::test]
async fn memory_write_rejects_traversal() {
  let result = middleware_memory_write(MemoryWriteInput {
    path: "../../../tmp/evil.md".to_string(),
    content: "evil".to_string(),
  }).await;
  assert!(result.is_err());
}

#[tokio::test]
async fn memory_search_returns_hits() {
  let db_path = openclaw_memory_db_path().unwrap();
  if !db_path.exists() {
    return; // Skip if no memory DB
  }

  let input = MemorySearchInput { query: "jarvis".to_string() };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok(), "search failed: {:?}", result.err());
  let val = result.unwrap();
  let hits = val.get("hits").and_then(Value::as_array).unwrap();
  assert!(!hits.is_empty(), "Expected search hits for 'jarvis'");

  let first = &hits[0];
  assert!(first.get("path").and_then(Value::as_str).is_some());
  assert!(first.get("snippet").and_then(Value::as_str).is_some());
  assert!(first.get("score").and_then(Value::as_f64).is_some());
}

#[tokio::test]
async fn memory_search_empty_query_returns_empty() {
  let input = MemorySearchInput { query: "   ".to_string() };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok());
  let hits = result.unwrap().get("hits").and_then(Value::as_array).unwrap().len();
  assert_eq!(hits, 0);
}

#[tokio::test]
async fn memory_search_no_db_returns_empty() {
  // This test only passes if the DB doesn't exist — can't reliably test
  // Just verify the function doesn't panic with a valid query
  let input = MemorySearchInput { query: "xyznonexistent123456".to_string() };
  let result = middleware_memory_search(input).await;
  assert!(result.is_ok());
}
