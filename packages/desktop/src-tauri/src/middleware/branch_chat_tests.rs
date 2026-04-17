use super::*;
use super::test_support::with_test_db;
use rusqlite::params;
use tempfile::tempdir;

fn seed_project(conn: &rusqlite::Connection, project_id: &str) {
  let now = now_iso();
  conn.execute(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, last_activity_at, created_at, updated_at) VALUES (?, 'Jarvis', 'prof_test', '/tmp/jarvis', '/tmp/jarvis', 0, 0, NULL, ?, ?)",
    params![project_id, now, now],
  )
  .expect("seed project");
}

fn seed_branch(conn: &rusqlite::Connection, source_session_key: &str, branch_session_key: &str, topic_id: &str) {
  let now = now_iso();
  conn.execute(
    "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    params![
      "branch_test_1",
      source_session_key,
      "msg_123",
      branch_session_key,
      topic_id,
      "manual",
      now,
      metadata_json(&json!({"history": {"messages": []}}))
    ],
  )
  .expect("seed branch");
}

#[test]
fn branch_list_get_and_delete_local_flows_work() {
  with_test_db(|| {
    let conn = open_db().expect("open db");
    seed_project(&conn, "proj_1");

    let now = now_iso();
    conn.execute(
      "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?)",
      params!["topic_branch_1", "proj_1", "Branch topic", now, now],
    )
    .expect("seed topic");

    seed_branch(&conn, "sess_source", "sess_branch", "topic_branch_1");
    drop(conn);

    let listed = middleware_branch_list(BranchListInput {
      source_session_key: "sess_source".to_string(),
    })
    .expect("list branches");
    let branches = listed.get("branches").and_then(Value::as_array).expect("branches array");
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].get("branchSessionKey").and_then(Value::as_str), Some("sess_branch"));

    let fetched = middleware_branch_get(BranchGetInput {
      branch_session_key: "sess_branch".to_string(),
    })
    .expect("get branch");
    assert_eq!(
      fetched.get("branch").and_then(|v| v.get("sourceMessageId")).and_then(Value::as_str),
      Some("msg_123")
    );

    let deleted = middleware_branch_delete(BranchGetInput {
      branch_session_key: "sess_branch".to_string(),
    })
    .expect("delete branch");
    assert_eq!(deleted.get("deleted").and_then(Value::as_bool), Some(true));

    let conn = open_db().expect("reopen db");
    let archived: i64 = conn
      .query_row(
        "SELECT archived FROM topics WHERE id = ?",
        params!["topic_branch_1"],
        |row| row.get(0),
      )
      .expect("topic archived state");
    assert_eq!(archived, 1);
  });
}

fn live_openclaw_enabled() -> bool {
  std::env::var("JARVIS_LIVE_OPENCLAW_TESTS").ok().as_deref() == Some("1")
}

#[tokio::test]
#[ignore = "requires live OpenClaw gateway/device auth and mutates real sessions plus local branch db"]
async fn branch_create_thread_roundtrip_works() {
  if !live_openclaw_enabled() {
    return;
  }

  let temp = tempdir().expect("tempdir");
  let db_path = temp.path().join("jarvis-branch-test.db");
  std::env::set_var("JARVIS_TEST_DB_PATH", &db_path);

  let cleanup = async {
    let conn = open_db().expect("open db");
    seed_project(&conn, "proj_live");
    drop(conn);

    let created = middleware_chat_create_session(ChatCreateSessionInput {
      label: Some(format!("Jarvis branch source {}", chrono::Utc::now().timestamp_millis())),
      model: None,
      agent_id: Some("main".to_string()),
      verbose_level: Some("full".to_string()),
    })
    .await
    .expect("create source session");

    let source_session_key = created
      .get("sessionKey")
      .and_then(Value::as_str)
      .expect("source session key")
      .to_string();

    let result = middleware_branch_create_thread(
      source_session_key.clone(),
      "msg_live_branch".to_string(),
      "proj_live".to_string(),
      "Thread branch".to_string(),
    )
    .await
    .expect("create thread branch");

    let branch_session_key = result
      .get("sessionKey")
      .and_then(Value::as_str)
      .expect("branch session key")
      .to_string();

    assert_eq!(
      result
        .get("branch")
        .and_then(|v| v.get("branchReason"))
        .and_then(Value::as_str),
      Some("thread")
    );

    let listed = middleware_branch_list(BranchListInput {
      source_session_key: source_session_key.clone(),
    })
    .expect("list live branches");
    assert_eq!(listed.get("branches").and_then(Value::as_array).map(|v| v.len()), Some(1));

    middleware_branch_delete(BranchGetInput {
      branch_session_key: branch_session_key.clone(),
    })
    .expect("delete branch record");

    middleware_chat_delete_session(SessionKeyInput {
      session_key: branch_session_key,
    })
    .await
    .expect("delete branch session");

    middleware_chat_delete_session(SessionKeyInput {
      session_key: source_session_key,
    })
    .await
    .expect("delete source session");
  };

  let result = cleanup.await;
  std::env::remove_var("JARVIS_TEST_DB_PATH");
  result
}
