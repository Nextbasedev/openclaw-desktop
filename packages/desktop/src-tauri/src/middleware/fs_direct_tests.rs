use super::*;
use super::test_support::path_string;
use tempfile::tempdir;

#[tokio::test]
async fn file_ops_end_to_end_flow_works() {
  let temp = tempdir().expect("create temp dir");
  let base = temp.path();
  let dir = base.join("alpha");
  let file = dir.join("note.txt");
  let renamed = dir.join("note-renamed.txt");

  middleware_fs_create_dir(FsCreateDirInput { path: path_string(&dir), recursive: Some(true) }).await.expect("mkdir should succeed");
  middleware_fs_write_file(FsWriteFileInput { path: path_string(&file), content: "hello jarvis".to_string() }).await.expect("write should succeed");

  let read = middleware_fs_read_file(FsReadFileInput { path: path_string(&file) }).await.expect("read should succeed");
  assert_eq!(read.get("content").and_then(Value::as_str), Some("hello jarvis"));
  assert_eq!(read.get("encoding").and_then(Value::as_str), Some("utf-8"));

  let tree = middleware_fs_read_dir(FsReadDirInput { path: path_string(&dir) }).await.expect("tree should succeed");
  let entries = tree.get("entries").and_then(Value::as_array).expect("entries array");
  assert!(entries.iter().any(|entry| entry.get("name").and_then(Value::as_str) == Some("note.txt")));

  let metadata = middleware_fs_metadata(FsReadFileInput { path: path_string(&file) }).await.expect("metadata should succeed");
  assert_eq!(metadata.get("isFile").and_then(Value::as_bool), Some(true));

  middleware_fs_rename(FsRenameInput { old_path: path_string(&file), new_path: path_string(&renamed) }).await.expect("rename should succeed");
  assert!(renamed.exists());

  let search = middleware_fs_search(FsSearchInput { path: path_string(base), query: "renamed".to_string(), max_results: Some(20) }).await.expect("search should succeed");
  let results = search.get("results").and_then(Value::as_array).expect("results array");
  assert!(results.iter().any(|result| result.get("name").and_then(Value::as_str) == Some("note-renamed.txt")));

  middleware_fs_remove(FsRemoveInput { path: path_string(&renamed), recursive: Some(false) }).await.expect("delete should succeed");
  assert!(!renamed.exists());
}

#[tokio::test]
async fn file_search_respects_max_results() {
  let temp = tempdir().expect("create temp dir");
  let base = temp.path();
  for i in 0..3 {
    let path = base.join(format!("match-{i}.txt"));
    tokio::fs::write(path, b"x").await.expect("seed file");
  }

  let search = middleware_fs_search(FsSearchInput { path: path_string(base), query: "match".to_string(), max_results: Some(2) }).await.expect("search should succeed");
  let results = search.get("results").and_then(Value::as_array).expect("results array");
  assert_eq!(results.len(), 2);
  assert_eq!(search.get("count").and_then(Value::as_u64), Some(2));
}
