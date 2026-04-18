use super::git::*;
use super::*;
use serde_json::json;

// ── detect_git_tool_call ─────────────────────────────────────────────────────

#[test]
fn detect_git_checkout_branch() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git checkout feature/auth" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("feature/auth".to_string(), "git checkout feature/auth".to_string())));
}

#[test]
fn detect_git_switch_branch() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git switch main" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("main".to_string(), "git switch main".to_string())));
}

#[test]
fn detect_git_checkout_with_create_flag() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git checkout -b new-feature" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("new-feature".to_string(), "git checkout -b new-feature".to_string())));
}

#[test]
fn detect_git_merge() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git merge develop" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("develop".to_string(), "git merge develop".to_string())));
}

#[test]
fn detect_git_pull_with_remote_and_branch() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git pull origin main" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("main".to_string(), "git pull origin main".to_string())));
}

#[test]
fn detect_git_push_with_remote_and_branch() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git push origin feature/xyz" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("feature/xyz".to_string(), "git push origin feature/xyz".to_string())));
}

#[test]
fn detect_git_rebase() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git rebase main" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("main".to_string(), "git rebase main".to_string())));
}

#[test]
fn detect_non_git_bash_command_returns_none() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "ls -la" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, None);
}

#[test]
fn detect_git_status_returns_detect_from_repo() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git status" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("__detect_from_repo__".to_string(), "git status".to_string())));
}

#[test]
fn detect_git_commit_returns_detect_from_repo() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git commit -m 'fix: resolve issue'" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("__detect_from_repo__".to_string(), "git commit -m 'fix: resolve issue'".to_string())));
}

#[test]
fn detect_non_bash_tool_returns_none() {
  let data = json!({
    "name": "Read",
    "phase": "invoke",
    "args": { "path": "/some/file" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, None);
}

#[test]
fn detect_result_phase_returns_none() {
  let data = json!({
    "name": "Bash",
    "phase": "result",
    "args": { "command": "git checkout main" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, None);
}

#[test]
fn detect_terminal_tool_with_git() {
  let data = json!({
    "name": "Terminal",
    "phase": "invoke",
    "args": { "command": "git checkout develop" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("develop".to_string(), "git checkout develop".to_string())));
}

#[test]
fn detect_git_branch_create() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git branch new-branch" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("new-branch".to_string(), "git branch new-branch".to_string())));
}

#[test]
fn detect_git_branch_delete_returns_no_branch() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "git branch -d old-branch" }
  });
  let result = detect_git_tool_call(&data);
  // branch delete doesn't extract a branch name, falls through to __detect_from_repo__
  assert_eq!(result, Some(("__detect_from_repo__".to_string(), "git branch -d old-branch".to_string())));
}

#[test]
fn detect_piped_git_command() {
  let data = json!({
    "name": "Bash",
    "phase": "invoke",
    "args": { "command": "cd /workspace && git checkout feature/test" }
  });
  let result = detect_git_tool_call(&data);
  assert_eq!(result, Some(("feature/test".to_string(), "cd /workspace && git checkout feature/test".to_string())));
}

// ── extract_branch_from_command ──────────────────────────────────────────────

#[test]
fn extract_checkout_simple() {
  let parts = vec!["git", "checkout", "main"];
  assert_eq!(extract_branch_from_command("checkout", &parts), Some("main".to_string()));
}

#[test]
fn extract_checkout_with_flag() {
  let parts = vec!["git", "checkout", "-b", "new-feature"];
  assert_eq!(extract_branch_from_command("checkout", &parts), Some("new-feature".to_string()));
}

#[test]
fn extract_switch_simple() {
  let parts = vec!["git", "switch", "develop"];
  assert_eq!(extract_branch_from_command("switch", &parts), Some("develop".to_string()));
}

#[test]
fn extract_merge_simple() {
  let parts = vec!["git", "merge", "feature/x"];
  assert_eq!(extract_branch_from_command("merge", &parts), Some("feature/x".to_string()));
}

#[test]
fn extract_pull_remote_branch() {
  let parts = vec!["git", "pull", "origin", "main"];
  assert_eq!(extract_branch_from_command("pull", &parts), Some("main".to_string()));
}

#[test]
fn extract_push_remote_branch() {
  let parts = vec!["git", "push", "origin", "feature/deploy"];
  assert_eq!(extract_branch_from_command("push", &parts), Some("feature/deploy".to_string()));
}

#[test]
fn extract_pull_no_branch() {
  let parts = vec!["git", "pull"];
  assert_eq!(extract_branch_from_command("pull", &parts), None);
}

#[test]
fn extract_unknown_subcommand() {
  let parts = vec!["git", "stash"];
  assert_eq!(extract_branch_from_command("stash", &parts), None);
}

// ── Integration tests with real git repos ────────────────────────────────────

#[tokio::test]
async fn detect_current_branch_on_temp_repo() {
  let tmp = tempfile::tempdir().unwrap();
  let repo = tmp.path();

  // Init repo and create initial commit
  std::process::Command::new("git").args(&["init"]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["config", "user.email", "test@test.com"]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["config", "user.name", "Test"]).current_dir(repo).output().unwrap();
  std::fs::write(repo.join("README.md"), "hello").unwrap();
  std::process::Command::new("git").args(&["add", "."]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["commit", "-m", "init"]).current_dir(repo).output().unwrap();

  let branch = detect_current_branch(repo).await;
  assert!(branch.is_some());
  let name = branch.unwrap();
  assert!(name == "main" || name == "master", "Expected main or master, got: {}", name);
}

#[tokio::test]
async fn detect_current_branch_after_checkout() {
  let tmp = tempfile::tempdir().unwrap();
  let repo = tmp.path();

  std::process::Command::new("git").args(&["init"]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["config", "user.email", "test@test.com"]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["config", "user.name", "Test"]).current_dir(repo).output().unwrap();
  std::fs::write(repo.join("README.md"), "hello").unwrap();
  std::process::Command::new("git").args(&["add", "."]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["commit", "-m", "init"]).current_dir(repo).output().unwrap();
  std::process::Command::new("git").args(&["checkout", "-b", "feature/test-branch"]).current_dir(repo).output().unwrap();

  let branch = detect_current_branch(repo).await;
  assert_eq!(branch, Some("feature/test-branch".to_string()));
}

#[tokio::test]
async fn detect_current_branch_no_git_dir_returns_none() {
  let tmp = tempfile::tempdir().unwrap();
  let branch = detect_current_branch(tmp.path()).await;
  assert_eq!(branch, None);
}

#[test]
fn store_git_context_creates_entry_in_db() {
  let conn = open_db().unwrap();
  init_db(&conn).unwrap();

  let project_id = uuid::Uuid::new_v4().to_string();
  let topic_id = uuid::Uuid::new_v4().to_string();
  let session_key = format!("test-session-{}", uuid::Uuid::new_v4());

  // Create a project with a workspace_root
  conn.execute(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, created_at, updated_at) VALUES (?, 'Test Project', 'p1', '/tmp/test', '/tmp/test', ?, ?)",
    params![project_id, now_iso(), now_iso()],
  ).unwrap();

  // Create topic
  conn.execute(
    "INSERT INTO topics (id, name, project_id, created_at, updated_at) VALUES (?, 'Test Topic', ?, ?, ?)",
    params![topic_id, project_id, now_iso(), now_iso()],
  ).unwrap();

  // Create session mapping
  conn.execute(
    "INSERT INTO session_mappings (session_key, project_id, topic_id, agent_id, label, status, created_at, updated_at, source) VALUES (?, ?, ?, 'main', 'test', 'running', ?, ?, 'test')",
    params![session_key, project_id, topic_id, now_iso(), now_iso()],
  ).unwrap();

  let result = store_git_context_for_session(&session_key, "feature/my-branch", "git checkout feature/my-branch");
  assert!(result.is_ok());

  // Verify stored
  let stored: Option<String> = conn.query_row(
    "SELECT branch_name FROM topic_git_context WHERE topic_id = ?",
    params![topic_id],
    |row| row.get(0),
  ).optional().unwrap();
  assert_eq!(stored, Some("feature/my-branch".to_string()));
}

#[test]
fn store_git_context_upserts_on_same_branch() {
  let conn = open_db().unwrap();
  init_db(&conn).unwrap();

  let project_id = uuid::Uuid::new_v4().to_string();
  let topic_id = uuid::Uuid::new_v4().to_string();
  let session_key = format!("test-session-{}", uuid::Uuid::new_v4());

  conn.execute(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, created_at, updated_at) VALUES (?, 'Test', 'p1', '/tmp/test', '/tmp/test', ?, ?)",
    params![project_id, now_iso(), now_iso()],
  ).unwrap();

  conn.execute(
    "INSERT INTO topics (id, name, project_id, created_at, updated_at) VALUES (?, 'Test', ?, ?, ?)",
    params![topic_id, project_id, now_iso(), now_iso()],
  ).unwrap();

  conn.execute(
    "INSERT INTO session_mappings (session_key, project_id, topic_id, agent_id, label, status, created_at, updated_at, source) VALUES (?, ?, ?, 'main', 'test', 'running', ?, ?, 'test')",
    params![session_key, project_id, topic_id, now_iso(), now_iso()],
  ).unwrap();

  store_git_context_for_session(&session_key, "main", "git checkout main").unwrap();
  store_git_context_for_session(&session_key, "main", "git merge develop").unwrap();

  // Should still be only one row for this topic+branch
  let count: i64 = conn.query_row(
    "SELECT COUNT(*) FROM topic_git_context WHERE topic_id = ? AND branch_name = 'main'",
    params![topic_id],
    |row| row.get(0),
  ).unwrap();
  assert_eq!(count, 1);

  // Command should be the latest one
  let cmd: String = conn.query_row(
    "SELECT detected_command FROM topic_git_context WHERE topic_id = ? AND branch_name = 'main'",
    params![topic_id],
    |row| row.get(0),
  ).unwrap();
  assert_eq!(cmd, "git merge develop");
}
