use super::*;
use super::test_support::{path_string, with_test_db};
use rusqlite::params;
use tempfile::tempdir;

fn seed_project(conn: &rusqlite::Connection, project_id: &str, workspace_root: &str, repo_root: &str) {
  let now = now_iso();
  conn.execute(
    "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, remotes_json, archived, unread_count, last_activity_at, created_at, updated_at) VALUES (?, 'Jarvis', 'prof_test', ?, ?, '{}', 0, 0, NULL, ?, ?)",
    params![project_id, workspace_root, repo_root, now, now],
  )
  .expect("seed project");
}

#[test]
fn git_remote_add_list_remove_local_flow_works() {
  with_test_db(|| {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path().join("repo");
    std::fs::create_dir_all(&repo_root).expect("create repo root");

    let conn = open_db().expect("open db");
    seed_project(&conn, "proj_1", &path_string(&repo_root), &path_string(&repo_root));
    drop(conn);

    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async {
      let added = middleware_git_remote_add(GitRemoteAddInput {
        project_id: "proj_1".to_string(),
        remote_name: "origin".to_string(),
        remote_url: "https://github.com/example/repo.git".to_string(),
      })
      .await
      .expect("add remote");
      assert_eq!(added.get("added").and_then(Value::as_bool), Some(true));

      let listed = middleware_git_remote_list(GitRemoteListInput {
        project_id: "proj_1".to_string(),
      })
      .await
      .expect("list remotes");
      let remotes = listed.get("remotes").and_then(Value::as_array).expect("remotes array");
      assert!(remotes.iter().any(|remote| {
        remote.get("name").and_then(Value::as_str) == Some("origin")
          && remote.get("url").and_then(Value::as_str) == Some("https://github.com/example/repo.git")
      }));

      let removed = middleware_git_remote_remove(GitRemoteRemoveInput {
        project_id: "proj_1".to_string(),
        remote_name: "origin".to_string(),
      })
      .await
      .expect("remove remote");
      assert_eq!(removed.get("removed").and_then(Value::as_bool), Some(true));

      let listed_after = middleware_git_remote_list(GitRemoteListInput {
        project_id: "proj_1".to_string(),
      })
      .await
      .expect("list remotes after remove");
      assert_eq!(listed_after.get("remotes").and_then(Value::as_array).map(|v| v.len()), Some(0));
    });

    let conn = open_db().expect("reopen db");
    let remotes_json: String = conn
      .query_row(
        "SELECT COALESCE(remotes_json, '{}') FROM projects WHERE id = ?",
        params!["proj_1"],
        |row| row.get(0),
      )
      .expect("remotes json");
    assert_eq!(remotes_json, "{}");
  });
}

#[tokio::test]
async fn openclaw_check_reports_install_state() {
  let result = middleware_openclaw_check(OpenClawCheckInput { gateway_url: None })
    .await
    .expect("openclaw check");

  assert!(result.get("installed").and_then(Value::as_bool).is_some());
  assert!(result.get("running").and_then(Value::as_bool).is_some());
  assert!(matches!(
    result.get("recommendation").and_then(Value::as_str),
    Some("install") | Some("start") | Some("ready")
  ));
}
