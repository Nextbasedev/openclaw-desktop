use super::*;
use super::test_support::with_test_db;

#[test]
fn runtime_info_payload_is_stable() {
  let info = middleware_runtime_info();
  assert_eq!(info.contract_version, MIDDLEWARE_CONTRACT_VERSION);
  assert!(info.transport.contains("tauri-ipc"));
}

#[test]
fn openclaw_bot_name_get_returns_null_when_unset() {
  with_test_db(|| {
    let payload = middleware_openclaw_bot_name_get().expect("get bot name");
    assert_eq!(payload.bot_name, None);
  });
}

#[test]
fn openclaw_bot_name_can_be_set_and_read_back() {
  with_test_db(|| {
    let saved = middleware_openclaw_bot_name_set(MiddlewareBotNameSetInput {
      bot_name: "My Telegram Bot".to_string(),
    })
    .expect("set bot name");
    assert_eq!(saved.bot_name, Some("My Telegram Bot".to_string()));

    let payload = middleware_openclaw_bot_name_get().expect("get bot name");
    assert_eq!(payload.bot_name, Some("My Telegram Bot".to_string()));
  });
}

#[test]
fn openclaw_bot_name_rejects_empty_input() {
  with_test_db(|| {
    let error = middleware_openclaw_bot_name_set(MiddlewareBotNameSetInput {
      bot_name: "   ".to_string(),
    })
    .expect_err("empty bot name should fail");
    assert!(error.contains("cannot be empty"));
  });
}

#[test]
fn admin_access_request_and_approval_payloads_are_correct() {
  let request = middleware_request_admin_access(AdminAccessRequestInput {
    action_id: "sessions.delete".to_string(),
    action_label: Some("delete the current session".to_string()),
  });
  assert_eq!(request.status, "needs_admin");
  assert_eq!(request.retry.gateway_method, "sessions.delete");
  assert!(request.message.contains("needs extra permission"));
  assert_eq!(request.title, "Admin access needed");

  let approval = middleware_approve_admin_access(AdminAccessApproveInput {
    action_id: "sessions.delete".to_string(),
  });
  assert_eq!(approval.status, "approved");
  assert!(approval.approved);
  assert_eq!(approval.retry.gateway_method, "sessions.delete");
}
