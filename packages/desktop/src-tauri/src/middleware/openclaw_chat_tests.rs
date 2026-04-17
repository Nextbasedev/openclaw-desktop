use super::*;

fn live_openclaw_enabled() -> bool {
  std::env::var("JARVIS_LIVE_OPENCLAW_TESTS").ok().as_deref() == Some("1")
}

#[tokio::test]
#[ignore = "requires live OpenClaw gateway/device auth and mutates real sessions"]
async fn openclaw_chat_session_roundtrip_works() {
  if !live_openclaw_enabled() {
    return;
  }

  let created = middleware_chat_create_session(ChatCreateSessionInput {
    label: Some("Jarvis live test session".to_string()),
    model: None,
    agent_id: Some("main".to_string()),
    verbose_level: Some("full".to_string()),
  })
  .await
  .expect("create live session");

  let session_key = created
    .get("sessionKey")
    .and_then(Value::as_str)
    .expect("session key")
    .to_string();

  let history = middleware_chat_history(SessionKeyInput {
    session_key: session_key.clone(),
  })
  .await
  .expect("history should succeed");
  assert_eq!(history.get("sessionKey").and_then(Value::as_str), Some(session_key.as_str()));

  let send = middleware_chat_send(ChatSendInput {
    session_key: session_key.clone(),
    text: "Reply with the word pong".to_string(),
    timeout_ms: Some(30_000),
  })
  .await
  .expect("send should succeed");
  assert_eq!(send.get("accepted").and_then(Value::as_bool), Some(true));

  let _ = middleware_chat_delete_session(SessionKeyInput {
    session_key,
  })
  .await
  .expect("delete live session");
}
