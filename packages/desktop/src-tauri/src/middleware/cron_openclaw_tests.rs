use super::*;
use serde_json::{json, Value};

#[test]
fn normalizes_legacy_cron_job_shape() {
  let normalized = normalize_cron_job(&json!({
    "id": "job-1",
    "name": "Legacy job",
    "schedule": "0 7 * * *",
    "enabled": true,
    "task": "session.message",
    "params": {
      "key": "agent:main:session:abc",
      "message": "hello"
    },
    "createdAt": "2026-04-17T00:00:00Z",
    "updatedAt": "2026-04-17T00:00:00Z",
    "status": "idle",
    "runCount": 3,
    "failCount": 1
  }));

  assert_eq!(normalized.get("task").and_then(Value::as_str), Some("session.message"));
  assert_eq!(normalized.get("schedule").and_then(Value::as_str), Some("0 7 * * *"));
  assert_eq!(normalized.get("params").and_then(|v| v.get("message")).and_then(Value::as_str), Some("hello"));
}

#[test]
fn detects_invalid_cron_params_error_messages() {
  assert!(is_invalid_cron_params_error(
    "cron.add failed: invalid cron.add params: at root: unexpected property 'payload'",
    "cron.add"
  ));
  assert!(!is_invalid_cron_params_error("cron.add failed: permission denied", "cron.add"));
}

fn live_openclaw_enabled() -> bool {
  std::env::var("JARVIS_LIVE_OPENCLAW_TESTS").ok().as_deref() == Some("1")
}

#[tokio::test]
#[ignore = "requires live OpenClaw gateway/device auth and mutates real cron jobs and sessions"]
async fn openclaw_cron_notification_roundtrip_works() {
  if !live_openclaw_enabled() {
    return;
  }

  let created_session = middleware_chat_create_session(ChatCreateSessionInput {
    label: Some(format!("Jarvis cron live test session {}", chrono::Utc::now().timestamp_millis())),
    model: None,
    agent_id: Some("main".to_string()),
    verbose_level: Some("full".to_string()),
  })
  .await
  .expect("create live session");

  let session_key = created_session
    .get("sessionKey")
    .and_then(Value::as_str)
    .expect("session key")
    .to_string();

  let created_job = middleware_cron_create_notification_job(CronCreateNotificationJobInput {
    name: format!("Jarvis Cron Test {}", chrono::Utc::now().timestamp()),
    schedule: "0 0 1 1 *".to_string(),
    notification_message: "hello from cron test".to_string(),
    session_key: session_key.clone(),
  })
  .await
  .expect("create cron notification job");

  let job = created_job.get("job").cloned().expect("job payload");
  let job_id = job.get("id").and_then(Value::as_str).expect("job id").to_string();
  assert_eq!(job.get("task").and_then(Value::as_str), Some("session.message"));

  let listed = middleware_cron_list_jobs(CronListJobsInput {})
    .await
    .expect("list cron jobs");
  let jobs = listed.get("jobs").and_then(Value::as_array).expect("jobs array");
  assert!(jobs.iter().any(|entry| entry.get("id").and_then(Value::as_str) == Some(job_id.as_str())));

  let fetched = middleware_cron_get_job(CronGetJobInput {
    job_id: job_id.clone(),
  })
  .await
  .expect("get cron job");
  assert_eq!(fetched.get("job").and_then(|v| v.get("id")).and_then(Value::as_str), Some(job_id.as_str()));

  let paused = middleware_cron_pause_job(CronPauseJobInput {
    job_id: job_id.clone(),
    paused: true,
  })
  .await
  .expect("pause cron job");
  assert_eq!(paused.get("job").and_then(|v| v.get("enabled")).and_then(Value::as_bool), Some(false));

  let runs = middleware_cron_list_runs(CronListRunsInput {
    job_id: job_id.clone(),
    limit: Some(5),
    sort_dir: Some("desc".to_string()),
    after_ts: None,
  })
  .await
  .expect("list cron runs");
  assert_eq!(runs.get("jobId").and_then(Value::as_str), Some(job_id.as_str()));

  middleware_cron_delete_job(CronDeleteJobInput {
    job_id: job_id.clone(),
  })
  .await
  .expect("delete cron job");

  middleware_chat_delete_session(SessionKeyInput { session_key })
    .await
    .expect("delete live session");
}
