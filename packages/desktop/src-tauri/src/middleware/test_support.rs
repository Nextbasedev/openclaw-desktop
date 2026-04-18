use std::future::Future;
use std::sync::{Mutex, OnceLock};
use tempfile::tempdir;

pub fn path_string(path: &std::path::Path) -> String {
  path.to_string_lossy().to_string()
}

fn db_test_lock() -> &'static Mutex<()> {
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  LOCK.get_or_init(|| Mutex::new(()))
}

fn env_test_lock() -> &'static Mutex<()> {
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  LOCK.get_or_init(|| Mutex::new(()))
}

pub fn with_test_db<T>(test_fn: impl FnOnce() -> T) -> T {
  let _guard = db_test_lock().lock().unwrap_or_else(|err| err.into_inner());
  let temp = tempdir().expect("create temp dir");
  let db_path = temp.path().join("jarvis-test.db");
  std::env::set_var("JARVIS_TEST_DB_PATH", &db_path);
  let result = test_fn();
  std::env::remove_var("JARVIS_TEST_DB_PATH");
  result
}

pub fn with_locked_env<T>(test_fn: impl FnOnce() -> T) -> T {
  let _guard = env_test_lock().lock().unwrap_or_else(|err| err.into_inner());
  test_fn()
}

pub async fn with_locked_env_async<T, F>(test_fn: impl FnOnce() -> F) -> T
where
  F: Future<Output = T>,
{
  let _guard = env_test_lock().lock().unwrap_or_else(|err| err.into_inner());
  test_fn().await
}
