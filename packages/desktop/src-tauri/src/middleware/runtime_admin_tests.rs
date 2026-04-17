use super::*;

#[test]
fn runtime_info_payload_is_stable() {
  let info = middleware_runtime_info();
  assert_eq!(info.contract_version, MIDDLEWARE_CONTRACT_VERSION);
  assert!(info.transport.contains("tauri-ipc"));
}

#[test]
fn openclaw_bot_name_payload_is_stable() {
  let payload = middleware_openclaw_bot_name();
  assert_eq!(payload.bot_name, OPENCLAW_BOT_DISPLAY_NAME);
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
