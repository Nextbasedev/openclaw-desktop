use super::*;
use super::test_support::{path_string, with_locked_env_async, with_test_db};
use rusqlite::params;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::tempdir;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::accept_async;

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

#[test]
fn onboarding_recommendation_prioritizes_core_prerequisites() {
  assert_eq!(onboarding_recommendation(false, false, false, false), "install_node");
  assert_eq!(onboarding_recommendation(true, false, false, false), "install_npm");
  assert_eq!(onboarding_recommendation(true, true, false, false), "install_openclaw");
  assert_eq!(onboarding_recommendation(true, true, true, false), "start_gateway");
  assert_eq!(onboarding_recommendation(true, true, true, true), "ready");
}

fn write_executable(path: &Path, content: &str) {
  fs::write(path, content).expect("write executable");
  let mut permissions = fs::metadata(path).expect("metadata").permissions();
  permissions.set_mode(0o755);
  fs::set_permissions(path, permissions).expect("chmod");
}

fn fake_bin_path(temp: &Path) -> PathBuf {
  let bin = temp.join("bin");
  fs::create_dir_all(&bin).expect("create bin dir");
  bin
}

fn write_fake_node(bin: &Path) {
  write_executable(
    &bin.join("node"),
    "#!/bin/sh\necho v22.22.0\n",
  );
}

fn write_fake_npm(bin: &Path) {
  let marker = bin.join(".openclaw_installed");
  let script = format!(
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 10.9.3\n  exit 0\nfi\nif [ \"$1\" = \"i\" ] && [ \"$2\" = \"-g\" ] && [ \"$3\" = \"openclaw\" ]; then\n  : > '{marker}'\n  echo installed\n  exit 0\nfi\nexit 1\n",
    marker = marker.display()
  );
  write_executable(&bin.join("npm"), &script);
}

fn write_fake_openclaw(bin: &Path) {
  write_executable(
    &bin.join("openclaw"),
    &format!(
      "#!/bin/sh\nMARKER='{marker}'\nif [ ! -f \"$MARKER\" ]; then\n  exit 1\nfi\nif [ \"$1\" = \"--version\" ]; then\n  echo openclaw 0.1.0-test\n  exit 0\nfi\nif [ \"$1\" = \"gateway\" ] && [ \"$2\" = \"start\" ]; then\n  echo gateway started\n  exit 0\nfi\nexit 1\n",
      marker = bin.join(".openclaw_installed").display()
    ),
  );
}

fn mark_fake_openclaw_installed(bin: &Path) {
  fs::write(bin.join(".openclaw_installed"), "installed\n").expect("mark installed");
}

async fn spawn_fake_gateway() -> (String, oneshot::Sender<()>) {
  let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind gateway");
  let addr = listener.local_addr().expect("local addr");
  let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

  tokio::spawn(async move {
    loop {
      tokio::select! {
        _ = &mut stop_rx => break,
        accepted = listener.accept() => {
          if let Ok((stream, _)) = accepted {
            tokio::spawn(async move {
              let _ = accept_async(stream).await;
            });
          } else {
            break;
          }
        }
      }
    }
  });

  (format!("ws://{}", addr), stop_tx)
}

#[tokio::test]
async fn onboarding_core_reports_complete_status_shape() {
  let result = middleware_onboarding_core(OnboardingCoreInput {
    action: Some("check".to_string()),
    gateway_url: None,
  })
  .await
  .expect("onboarding core");

  assert!(result.get("status").is_some());
  assert!(result.get("status").and_then(|v| v.get("node")).is_some());
  assert!(result.get("status").and_then(|v| v.get("npm")).is_some());
  assert!(result.get("status").and_then(|v| v.get("openclaw")).is_some());
  assert!(result.get("status").and_then(|v| v.get("gateway")).is_some());
  assert!(matches!(
    result.get("status").and_then(|v| v.get("recommendation")).and_then(Value::as_str),
    Some("install_node") | Some("install_npm") | Some("install_openclaw") | Some("start_gateway") | Some("ready")
  ));
}

#[tokio::test]
async fn onboarding_core_apply_returns_manual_step_when_node_missing() {
  with_locked_env_async(|| async {
    let temp = tempdir().expect("tempdir");
    let bin = fake_bin_path(temp.path());
    let original_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", &bin);

    let result = middleware_onboarding_core(OnboardingCoreInput {
      action: Some("apply".to_string()),
      gateway_url: Some("ws://127.0.0.1:65534".to_string()),
    })
    .await
    .expect("apply onboarding");

    std::env::set_var("PATH", original_path);

    assert_eq!(result.get("applied").and_then(Value::as_bool), Some(false));
    assert_eq!(result.get("canAutoFix").and_then(Value::as_bool), Some(false));
    assert_eq!(result.get("manualAction").and_then(Value::as_str), Some("install_node"));
  }).await;
}

#[tokio::test]
async fn onboarding_core_apply_installs_openclaw_inside_sandbox() {
  with_locked_env_async(|| async {
    let temp = tempdir().expect("tempdir");
    let bin = fake_bin_path(temp.path());
    write_fake_node(&bin);
    write_fake_npm(&bin);
    write_fake_openclaw(&bin);
    let original_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", &bin);

    let (gateway_url, stop_tx) = spawn_fake_gateway().await;

    let result = middleware_onboarding_core(OnboardingCoreInput {
      action: Some("apply".to_string()),
      gateway_url: Some(gateway_url),
    })
    .await
    .expect("apply onboarding");

    let _ = stop_tx.send(());
    std::env::set_var("PATH", original_path);

    assert_eq!(result.get("applied").and_then(Value::as_bool), Some(true));
    assert!(result
      .get("actionsRun")
      .and_then(Value::as_array)
      .map(|arr| arr.iter().any(|v| v.as_str() == Some("npm i -g openclaw")))
      .unwrap_or(false));
    assert_eq!(
      result.get("status").and_then(|v| v.get("openclaw")).and_then(|v| v.get("installed")).and_then(Value::as_bool),
      Some(true)
    );
    assert_eq!(
      result.get("status").and_then(|v| v.get("recommendation")).and_then(Value::as_str),
      Some("ready")
    );
  }).await;
}

#[tokio::test]
async fn onboarding_core_check_reports_ready_in_sandbox_when_all_prereqs_exist() {
  with_locked_env_async(|| async {
    let temp = tempdir().expect("tempdir");
    let bin = fake_bin_path(temp.path());
    write_fake_node(&bin);
    write_fake_npm(&bin);
    write_fake_openclaw(&bin);
    mark_fake_openclaw_installed(&bin);
    let original_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", &bin);

    let (gateway_url, stop_tx) = spawn_fake_gateway().await;
    let result = middleware_onboarding_core(OnboardingCoreInput {
      action: Some("check".to_string()),
      gateway_url: Some(gateway_url),
    })
    .await
    .expect("check onboarding");

    let _ = stop_tx.send(());
    std::env::set_var("PATH", original_path);

    assert_eq!(result.get("status").and_then(|v| v.get("recommendation")).and_then(Value::as_str), Some("ready"));
    assert_eq!(result.get("status").and_then(|v| v.get("node")).and_then(|v| v.get("installed")).and_then(Value::as_bool), Some(true));
    assert_eq!(result.get("status").and_then(|v| v.get("npm")).and_then(|v| v.get("installed")).and_then(Value::as_bool), Some(true));
    assert_eq!(result.get("status").and_then(|v| v.get("openclaw")).and_then(|v| v.get("installed")).and_then(Value::as_bool), Some(true));
    assert_eq!(result.get("status").and_then(|v| v.get("gateway")).and_then(|v| v.get("running")).and_then(Value::as_bool), Some(true));
  }).await;
}

#[tokio::test]
async fn openclaw_check_reports_install_state() {
  let result = middleware_openclaw_check(OpenClawCheckInput { gateway_url: None })
    .await
    .expect("openclaw check");

  assert!(result.get("installed").and_then(Value::as_bool).is_some());
  assert!(result.get("running").and_then(Value::as_bool).is_some());
  assert!(result.get("core").is_some());
  assert!(matches!(
    result.get("recommendation").and_then(Value::as_str),
    Some("install") | Some("start") | Some("ready")
  ));
}
