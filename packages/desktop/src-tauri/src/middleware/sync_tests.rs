use super::*;
use super::test_support::with_test_db;
use rusqlite::params;
use std::collections::HashMap;

fn make_project(id: &str, name: &str, updated_at: &str, device: &str) -> SyncProject {
  SyncProject {
    id: id.to_string(),
    name: name.to_string(),
    profile_id: "prof_test".to_string(),
    workspace_root: "/tmp/test".to_string(),
    repo_root: None,
    archived: false,
    updated_at: updated_at.to_string(),
    updated_by: device.to_string(),
  }
}

fn make_topic(id: &str, project_id: &str, name: &str, updated_at: &str, device: &str) -> SyncTopic {
  SyncTopic {
    id: id.to_string(),
    project_id: project_id.to_string(),
    name: name.to_string(),
    archived: false,
    sort_order: 0,
    updated_at: updated_at.to_string(),
    updated_by: device.to_string(),
  }
}

fn make_tombstone(entity_type: &str, entity_id: &str, deleted_at: &str) -> SyncTombstone {
  SyncTombstone {
    entity_type: entity_type.to_string(),
    entity_id: entity_id.to_string(),
    deleted_at: deleted_at.to_string(),
    deleted_by: "device_a".to_string(),
    expires_at: "2099-01-01T00:00:00Z".to_string(),
  }
}

fn empty_snapshot() -> LocalSnapshot {
  LocalSnapshot {
    projects: Vec::new(),
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: Vec::new(),
  }
}

// ============================================================================
// Merge engine tests
// ============================================================================

#[test]
fn merge_empty_local_with_remote_pulls_all() {
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "Proj1", "2026-01-01T00:00:00Z", "b"))]),
    topics: HashMap::from([("t1".into(), make_topic("t1", "p1", "Topic1", "2026-01-01T00:00:00Z", "b"))]),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&empty_snapshot(), &remote, "a", "A");
  assert_eq!(result.pulled, 2);
  assert_eq!(result.pushed, 0);
  assert_eq!(result.to_upsert_locally.len(), 2);
}

#[test]
fn merge_local_with_empty_remote_pushes_all() {
  let local = LocalSnapshot {
    projects: vec![make_project("p1", "Proj1", "2026-01-01T00:00:00Z", "a")],
    topics: vec![make_topic("t1", "p1", "Topic1", "2026-01-01T00:00:00Z", "a")],
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: Vec::new(),
  };
  let remote = SyncState::empty();

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert_eq!(result.pushed, 2);
  assert_eq!(result.pulled, 0);
  assert!(result.new_remote_state.projects.contains_key("p1"));
  assert!(result.new_remote_state.topics.contains_key("t1"));
}

#[test]
fn merge_same_entity_local_newer_wins() {
  let local = LocalSnapshot {
    projects: vec![make_project("p1", "LocalName", "2026-06-01T00:00:00Z", "a")],
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: Vec::new(),
  };
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "RemoteName", "2026-01-01T00:00:00Z", "b"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert_eq!(result.new_remote_state.projects["p1"].name, "LocalName");
  assert_eq!(result.pushed, 1);
  assert_eq!(result.to_upsert_locally.len(), 0);
}

#[test]
fn merge_same_entity_remote_newer_wins() {
  let local = LocalSnapshot {
    projects: vec![make_project("p1", "LocalName", "2026-01-01T00:00:00Z", "a")],
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: Vec::new(),
  };
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-06-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "RemoteName", "2026-06-01T00:00:00Z", "b"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert_eq!(result.new_remote_state.projects["p1"].name, "RemoteName");
  assert_eq!(result.pulled, 1);
  assert!(result.to_upsert_locally.iter().any(|e| matches!(e, MergeEntity::Project(p) if p.name == "RemoteName")));
}

#[test]
fn merge_both_populated_no_conflict_produces_union() {
  let local = LocalSnapshot {
    projects: vec![make_project("p1", "Local", "2026-01-01T00:00:00Z", "a")],
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: Vec::new(),
  };
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p2".into(), make_project("p2", "Remote", "2026-01-01T00:00:00Z", "b"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert_eq!(result.new_remote_state.projects.len(), 2);
  assert_eq!(result.pushed, 1);
  assert_eq!(result.pulled, 1);
}

#[test]
fn merge_tombstone_newer_than_entity_deletes() {
  let local = LocalSnapshot {
    projects: Vec::new(),
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: vec![make_tombstone("project", "p1", "2026-06-01T00:00:00Z")],
  };
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "Old", "2026-01-01T00:00:00Z", "b"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert!(!result.new_remote_state.projects.contains_key("p1"));
  assert!(result.to_delete_locally.contains(&("project".to_string(), "p1".to_string())));
}

#[test]
fn merge_tombstone_older_than_entity_survives() {
  let local = LocalSnapshot {
    projects: Vec::new(),
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: vec![make_tombstone("project", "p1", "2025-01-01T00:00:00Z")],
  };
  let remote = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "b".into(), device_name: "B".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "New", "2026-01-01T00:00:00Z", "b"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert!(result.new_remote_state.projects.contains_key("p1"));
  assert!(!result.to_delete_locally.contains(&("project".to_string(), "p1".to_string())));
}

#[test]
fn merge_expired_tombstones_pruned() {
  let local = LocalSnapshot {
    projects: Vec::new(),
    topics: Vec::new(),
    session_mappings: Vec::new(),
    branches: Vec::new(),
    tombstones: vec![SyncTombstone {
      entity_type: "project".to_string(),
      entity_id: "p1".to_string(),
      deleted_at: "2020-01-01T00:00:00Z".to_string(),
      deleted_by: "a".to_string(),
      expires_at: "2020-02-01T00:00:00Z".to_string(),
    }],
  };
  let remote = SyncState::empty();

  let result = merge_sync_states(&local, &remote, "a", "A");
  assert!(result.new_remote_state.tombstones.is_empty());
}

#[test]
fn serialize_deserialize_roundtrip() {
  let state = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "a".into(), device_name: "A".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "Test", "2026-01-01T00:00:00Z", "a"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };
  let json = serde_json::to_string(&state).expect("serialize");
  let deserialized: SyncState = serde_json::from_str(&json).expect("deserialize");
  assert_eq!(deserialized.projects["p1"].name, "Test");
  assert_eq!(deserialized.schema_version, 1);
}

// ============================================================================
// Markdown encoding tests
// ============================================================================

#[test]
fn encode_sync_state_to_markdown_and_back() {
  let state = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "a".into(), device_name: "A".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "Test", "2026-01-01T00:00:00Z", "a"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };
  let md = encode_sync_state_to_markdown(&state).expect("encode");
  assert!(md.contains("```json"));
  let decoded = decode_sync_state_from_markdown(&md).expect("decode").expect("some");
  assert_eq!(decoded.projects["p1"].name, "Test");
}

#[test]
fn decode_empty_markdown_returns_none() {
  let result = decode_sync_state_from_markdown("# Empty file\n\nNo sync data here.").expect("decode");
  assert!(result.is_none());
}

#[test]
fn decode_invalid_json_in_markdown_returns_error() {
  let md = "# Sync\n\n```json\n{bad json}\n```\n";
  assert!(decode_sync_state_from_markdown(md).is_err());
}

// ============================================================================
// SQLite sync integration tests
// ============================================================================

#[test]
fn init_db_creates_sync_dirty_columns() {
  with_test_db(|| {
    let conn = open_db().expect("open db");
    let has_col: bool = conn
      .query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('projects') WHERE name = 'sync_dirty'",
        [],
        |row| row.get(0),
      )
      .expect("check sync_dirty column");
    assert!(has_col);
  });
}

#[test]
fn new_project_defaults_to_sync_dirty() {
  with_test_db(|| {
    middleware_projects_create(ProjectCreateInput {
      name: "Test".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/test".to_string(),
      repo_root: None,
    })
    .expect("create project");

    let conn = open_db().expect("open db");
    let dirty: i64 = conn
      .query_row("SELECT sync_dirty FROM projects LIMIT 1", [], |row| row.get(0))
      .expect("read sync_dirty");
    assert_eq!(dirty, 1);
  });
}

#[test]
fn update_project_sets_sync_dirty() {
  with_test_db(|| {
    let result = middleware_projects_create(ProjectCreateInput {
      name: "Test".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/test".to_string(),
      repo_root: None,
    })
    .expect("create");
    let pid = result["project"]["id"].as_str().unwrap().to_string();

    let conn = open_db().expect("open db");
    conn.execute("UPDATE projects SET sync_dirty = 0 WHERE id = ?", params![pid]).expect("clear dirty");
    drop(conn);

    middleware_projects_update(ProjectUpdateInput {
      project_id: pid.clone(),
      name: Some("Updated".to_string()),
      workspace_root: None,
      repo_root: None,
      archived: None,
    })
    .expect("update");

    let conn = open_db().expect("open db");
    let dirty: i64 = conn
      .query_row("SELECT sync_dirty FROM projects WHERE id = ?", params![pid], |row| row.get(0))
      .expect("read dirty");
    assert_eq!(dirty, 1);
  });
}

#[test]
fn snapshot_dirty_entities_returns_only_dirty() {
  with_test_db(|| {
    let r1 = middleware_projects_create(ProjectCreateInput {
      name: "Dirty".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/test".to_string(),
      repo_root: None,
    })
    .expect("create p1");
    let p1 = r1["project"]["id"].as_str().unwrap().to_string();

    let r2 = middleware_projects_create(ProjectCreateInput {
      name: "Clean".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/test2".to_string(),
      repo_root: None,
    })
    .expect("create p2");
    let p2 = r2["project"]["id"].as_str().unwrap().to_string();

    let conn = open_db().expect("open db");
    conn.execute("UPDATE projects SET sync_dirty = 0 WHERE id = ?", params![p2]).expect("clear dirty");

    let snapshot = snapshot_dirty_entities(&conn, "device_test").expect("snapshot");
    assert_eq!(snapshot.projects.len(), 1);
    assert_eq!(snapshot.projects[0].id, p1);
  });
}

#[test]
fn apply_sync_changes_upserts_and_clears_dirty() {
  with_test_db(|| {
    let conn = open_db().expect("open db");

    let merge_result = MergeResult {
      to_upsert_locally: vec![MergeEntity::Project(make_project("synced_p1", "FromRemote", "2026-01-01T00:00:00Z", "b"))],
      to_delete_locally: Vec::new(),
      new_remote_state: SyncState::empty(),
      pulled: 1,
      pushed: 0,
      pushed_project_ids: Vec::new(),
      pushed_topic_ids: Vec::new(),
      pushed_session_keys: Vec::new(),
      pushed_branch_ids: Vec::new(),
    };
    apply_sync_changes(&conn, &merge_result).expect("apply changes");

    let name: String = conn
      .query_row("SELECT name FROM projects WHERE id = 'synced_p1'", [], |row| row.get(0))
      .expect("read upserted project");
    assert_eq!(name, "FromRemote");

    let dirty: i64 = conn
      .query_row("SELECT sync_dirty FROM projects WHERE id = 'synced_p1'", [], |row| row.get(0))
      .expect("read dirty");
    assert_eq!(dirty, 0);
  });
}

#[test]
fn record_and_read_tombstone() {
  with_test_db(|| {
    let conn = open_db().expect("open db");
    set_app_setting(&conn, "sync.device_id", "device_test").expect("set device id");
    record_sync_tombstone(&conn, "project", "p1").expect("record tombstone");

    let count: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM sync_tombstones WHERE entity_type = 'project' AND entity_id = 'p1'",
        [],
        |row| row.get(0),
      )
      .expect("count tombstones");
    assert_eq!(count, 1);
  });
}

#[test]
fn sync_enable_stores_settings() {
  with_test_db(|| {
    middleware_sync_enable(SyncEnableInput { enabled: true, device_name: Some("TestDevice".to_string()) }).expect("enable sync");

    let conn = open_db().expect("open db");
    let enabled = get_app_setting(&conn, APP_SETTING_SYNC_ENABLED).expect("read").unwrap_or_default();
    assert_eq!(enabled, "true");

    let name = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME).expect("read").unwrap_or_default();
    assert_eq!(name, "TestDevice");

    let device_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID).expect("read");
    assert!(device_id.is_some());
    assert!(device_id.unwrap().starts_with("device_"));
  });
}

#[test]
fn sync_status_returns_dirty_count() {
  with_test_db(|| {
    middleware_projects_create(ProjectCreateInput {
      name: "P1".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/t1".to_string(),
      repo_root: None,
    })
    .expect("create p1");
    middleware_projects_create(ProjectCreateInput {
      name: "P2".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/t2".to_string(),
      repo_root: None,
    })
    .expect("create p2");

    let status = middleware_sync_status().expect("status");
    assert_eq!(status["dirtyCount"].as_i64(), Some(2));
    assert_eq!(status["enabled"].as_bool(), Some(false));
  });
}

// ============================================================================
// File I/O tests (local path)
// ============================================================================

#[test]
fn write_and_read_sync_file_local_roundtrip() {
  let temp = tempfile::tempdir().expect("create temp dir");
  let ws = temp.path().to_string_lossy().to_string();

  let state = SyncState {
    schema_version: 1,
    last_writer: SyncLastWriter { device_id: "a".into(), device_name: "A".into(), written_at: "2026-01-01T00:00:00Z".into() },
    projects: HashMap::from([("p1".into(), make_project("p1", "Test", "2026-01-01T00:00:00Z", "a"))]),
    topics: HashMap::new(),
    session_mappings: HashMap::new(),
    branches: HashMap::new(),
    tombstones: Vec::new(),
  };

  write_sync_file_local(&ws, &state).expect("write");
  let read_back = read_sync_file_local(&ws).expect("read").expect("some");
  assert_eq!(read_back.projects["p1"].name, "Test");
}

#[test]
fn read_nonexistent_sync_file_returns_none() {
  let temp = tempfile::tempdir().expect("create temp dir");
  let ws = temp.path().to_string_lossy().to_string();
  let result = read_sync_file_local(&ws).expect("read");
  assert!(result.is_none());
}

#[test]
fn corrupted_sync_file_returns_error() {
  let temp = tempfile::tempdir().expect("create temp dir");
  let path = temp.path().join(".jarvis-sync.json");
  std::fs::write(&path, "not valid json").expect("write bad file");
  let ws = temp.path().to_string_lossy().to_string();
  assert!(read_sync_file_local(&ws).is_err());
}
