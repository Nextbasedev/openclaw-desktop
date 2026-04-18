use super::*;
use super::test_support::with_test_db;
use rusqlite::{params, Connection};

fn seed_session_mapping(conn: &Connection, project_id: &str, topic_id: Option<&str>, session_key: &str) {
  let now = now_iso();
  conn.execute(
    "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source) VALUES (?, NULL, ?, ?, 'main', 'Test Session', 'idle', ?, ?, 0, 0, 'jarvis')",
    params![session_key, project_id, topic_id, now, now],
  ).expect("seed session mapping");
}

#[test]
fn sqlite_projects_topics_and_sessions_local_flows_work() {
  with_test_db(|| {
    let project = middleware_projects_create(ProjectCreateInput {
      name: "Jarvis".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/jarvis".to_string(),
      repo_root: Some("/tmp/jarvis".to_string()),
    }).expect("create project");
    let project_id = project.get("project").and_then(|p| p.get("id")).and_then(Value::as_str).expect("project id").to_string();

    let listed = middleware_projects_list().expect("list projects");
    assert_eq!(listed.get("projects").and_then(Value::as_array).map(|v| v.len()), Some(1));

    let fetched = middleware_projects_get(ProjectIdInput { project_id: project_id.clone() }).expect("get project");
    assert_eq!(fetched.get("project").and_then(|p| p.get("name")).and_then(Value::as_str), Some("Jarvis"));

    let updated = middleware_projects_update(ProjectUpdateInput {
      project_id: project_id.clone(),
      name: Some("Jarvis Updated".to_string()),
      workspace_root: None,
      repo_root: None,
      archived: None,
    }).expect("update project");
    assert_eq!(updated.get("project").and_then(|p| p.get("name")).and_then(Value::as_str), Some("Jarvis Updated"));

    let topic = middleware_topics_create(TopicCreateInput {
      project_id: project_id.clone(),
      name: "Inbox".to_string(),
    }).expect("create topic");
    let topic_id = topic.get("topic").and_then(|t| t.get("id")).and_then(Value::as_str).expect("topic id").to_string();

    let topics = middleware_topics_list(TopicListInput { project_id: project_id.clone() }).expect("list topics");
    assert_eq!(topics.get("topics").and_then(Value::as_array).map(|v| v.len()), Some(1));

    let topic_updated = middleware_topics_update(TopicUpdateInput {
      topic_id: topic_id.clone(),
      name: Some("Backlog".to_string()),
      sort_order: Some(2),
    }).expect("update topic");
    assert_eq!(topic_updated.get("topic").and_then(|t| t.get("name")).and_then(Value::as_str), Some("Backlog"));

    let conn = open_db().expect("open db");
    seed_session_mapping(&conn, &project_id, None, "sess_1");
    drop(conn);

    middleware_topics_attach_session(TopicSessionInput { topic_id: topic_id.clone(), session_key: "sess_1".to_string() }).expect("attach session");
    let sidebar = middleware_projects_sidebar(ProjectIdInput { project_id: project_id.clone() }).expect("sidebar");
    assert_eq!(sidebar.get("topics").and_then(Value::as_array).map(|v| v.len()), Some(1));
    assert_eq!(sidebar.get("sessions").and_then(Value::as_array).map(|v| v.len()), Some(1));

    let sessions = middleware_sessions_list(Some(SessionListInput { project_id: Some(project_id.clone()), topic_id: Some(topic_id.clone()), include_existing: Some(false) })).expect("list sessions");
    assert_eq!(sessions.get("sessions").and_then(Value::as_array).map(|v| v.len()), Some(1));

    let updated_session = middleware_sessions_update(SessionUpdateMappingInput {
      session_key: "sess_1".to_string(),
      label: Some("Updated Session".to_string()),
      pinned: Some(true),
      hidden: Some(false),
      topic_id: Some(Some(topic_id.clone())),
    }).expect("update session");
    assert_eq!(updated_session.get("session").and_then(|s| s.get("label")).and_then(Value::as_str), Some("Updated Session"));

    middleware_topics_detach_session(TopicSessionInput { topic_id: topic_id.clone(), session_key: "sess_1".to_string() }).expect("detach session");
    middleware_topics_archive(TopicArchiveInput { topic_id: topic_id.clone(), archived: Some(true) }).expect("archive topic");
    middleware_projects_archive(ProjectUpdateInput {
      project_id: project_id.clone(),
      name: None,
      workspace_root: None,
      repo_root: None,
      archived: Some(true),
    }).expect("archive project");

    let final_projects = middleware_projects_list().expect("final projects list");
    assert_eq!(final_projects.get("projects").and_then(Value::as_array).map(|v| v.len()), Some(1));
  });
}

#[test]
fn sqlite_project_pin_and_unpin() {
  with_test_db(|| {
    let p1 = middleware_projects_create(ProjectCreateInput {
      name: "Alpha".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/alpha".to_string(),
      repo_root: None,
    }).expect("create alpha");
    let p1_id = p1.get("project").and_then(|p| p.get("id")).and_then(Value::as_str).unwrap().to_string();
    assert_eq!(p1.get("project").and_then(|p| p.get("pinned")).and_then(Value::as_bool), Some(false));

    let p2 = middleware_projects_create(ProjectCreateInput {
      name: "Beta".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/beta".to_string(),
      repo_root: None,
    }).expect("create beta");
    let p2_id = p2.get("project").and_then(|p| p.get("id")).and_then(Value::as_str).unwrap().to_string();

    // Pin Alpha
    let pin_result = middleware_projects_pin(ProjectPinInput { project_id: p1_id.clone(), pinned: Some(true) }).expect("pin alpha");
    assert_eq!(pin_result.get("pinned").and_then(Value::as_bool), Some(true));

    // Verify pinned project appears first in list
    let listed = middleware_projects_list().expect("list projects");
    let projects = listed.get("projects").and_then(Value::as_array).unwrap();
    assert_eq!(projects[0].get("id").and_then(Value::as_str), Some(p1_id.as_str()));
    assert_eq!(projects[0].get("pinned").and_then(Value::as_bool), Some(true));

    // Unpin Alpha
    let unpin_result = middleware_projects_pin(ProjectPinInput { project_id: p1_id.clone(), pinned: Some(false) }).expect("unpin alpha");
    assert_eq!(unpin_result.get("pinned").and_then(Value::as_bool), Some(false));

    // Pin on nonexistent project fails
    let bad = middleware_projects_pin(ProjectPinInput { project_id: "proj_nonexistent".to_string(), pinned: None });
    assert!(bad.is_err());

    drop(p2_id);
  });
}

#[test]
fn sqlite_project_delete_cascades() {
  with_test_db(|| {
    let project = middleware_projects_create(ProjectCreateInput {
      name: "ToDelete".to_string(),
      profile_id: "prof_test".to_string(),
      workspace_root: "/tmp/delete_me".to_string(),
      repo_root: None,
    }).expect("create project");
    let project_id = project.get("project").and_then(|p| p.get("id")).and_then(Value::as_str).unwrap().to_string();

    // Add a topic and session
    let topic = middleware_topics_create(TopicCreateInput {
      project_id: project_id.clone(),
      name: "Will be deleted".to_string(),
    }).expect("create topic");
    let topic_id = topic.get("topic").and_then(|t| t.get("id")).and_then(Value::as_str).unwrap().to_string();

    let conn = open_db().expect("open db");
    seed_session_mapping(&conn, &project_id, Some(&topic_id), "sess_del");
    drop(conn);

    // Delete the project
    let del_result = middleware_projects_delete(ProjectIdInput { project_id: project_id.clone() }).expect("delete project");
    assert_eq!(del_result.get("ok").and_then(Value::as_bool), Some(true));

    // Verify project is gone
    let listed = middleware_projects_list().expect("list projects");
    assert_eq!(listed.get("projects").and_then(Value::as_array).map(|v| v.len()), Some(0));

    // Verify topics are gone
    let topics = middleware_topics_list(TopicListInput { project_id: project_id.clone() }).expect("list topics");
    assert_eq!(topics.get("topics").and_then(Value::as_array).map(|v| v.len()), Some(0));

    // Delete nonexistent project fails
    let bad = middleware_projects_delete(ProjectIdInput { project_id: "proj_nonexistent".to_string() });
    assert!(bad.is_err());
  });
}
